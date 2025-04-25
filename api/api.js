const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const app = express();
const port = 3000;

// Enable CORS for browser requests
app.use(cors());
app.use(express.json());

// Database connection
const db = mysql.createConnection({
    host: 'localhost',
    user: '',
    password: '',
    database: 'emergencyDispatch',
    // Add these options for better connection handling
    reconnect: true,
    connectTimeout: 10000,
    waitForConnections: true
});

// Add connection error handling
db.on('error', (err) => {
    console.error('Database error:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        handleDisconnect();
    } else {
        throw err;
    }
});

function handleDisconnect() {
    db.connect((err) => {
        if (err) {
            console.error('Error reconnecting:', err);
            setTimeout(handleDisconnect, 2000);
        }
    });
}

// GET all zip codes
app.get('/api/zipcodes', (req, res) => {
    if (!db || !db.state || db.state === 'disconnected') {
        return res.status(500).json({ 
            error: "Database connection not available",
            details: "Please check database connectivity"
        });
    }

    const query = 'SELECT * FROM zip_codes';
    db.query(query, (err, results) => {
        if (err) {
            console.error('Database query error:', err);
            return res.status(500).json({ 
                error: "Database error",
                details: err.message 
            });
        }
        res.json(results);
    });
});

// GET vehicle availability
app.get('/api/availability', (req, res) => {
    const query = `
        SELECT z.zip_id, z.zip_code, z.location_name, 
            MAX(CASE WHEN v.vehicle_type = 'Ambulance' THEN v.available_count ELSE 0 END) AS ambulance_count,
            MAX(CASE WHEN v.vehicle_type = 'Fire Truck' THEN v.available_count ELSE 0 END) AS fire_truck_count,
            MAX(CASE WHEN v.vehicle_type = 'Police' THEN v.available_count ELSE 0 END) AS police_count
        FROM zip_codes z
        LEFT JOIN vehicles v ON z.zip_id = v.zip_id
        GROUP BY z.zip_id, z.zip_code, z.location_name
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// POST dispatch vehicle
app.post('/api/dispatch', (req, res) => {
    const { zipCode, vehicleType } = req.body;
    
    if (!zipCode || !vehicleType) {
        return res.status(400).json({ error: "ZIP code and vehicle type are required" });
    }
    
    // First check if vehicle is available at the requested zip code
    const checkQuery = `
        SELECT v.id, v.available_count, z.zip_code, z.location_name
        FROM vehicles v
        JOIN zip_codes z ON v.zip_id = z.zip_id
        WHERE z.zip_code = ? AND v.vehicle_type = ?
    `;
    
    db.query(checkQuery, [zipCode, vehicleType], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (results.length > 0 && results[0].available_count > 0) {
            // Vehicle is available at requested location
            const updateQuery = 'UPDATE vehicles SET available_count = available_count - 1 WHERE id = ?';
            db.query(updateQuery, [results[0].id], (updateErr) => {
                if (updateErr) {
                    return res.status(500).json({ error: updateErr.message });
                }
                
                res.json({
                    success: true,
                    message: `${vehicleType} dispatched from ${results[0].location_name} (${results[0].zip_code})`,
                    fromRequested: true
                });
            });
        } else {
            // Need to find nearest neighbor with available vehicle
            findNearestWithVehicle(zipCode, vehicleType, (err, result) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                
                if (!result) {
                    return res.status(404).json({ 
                        success: false, 
                        message: `No ${vehicleType} available in any nearby location` 
                    });
                }
                
                // Update the vehicle count at the neighbor location
                const updateQuery = 'UPDATE vehicles SET available_count = available_count - 1 WHERE id = ?';
                db.query(updateQuery, [result.vehicle_id], (updateErr) => {
                    if (updateErr) {
                        return res.status(500).json({ error: updateErr.message });
                    }
                    
                    res.json({
                        success: true,
                        message: `${vehicleType} dispatched from ${result.location_name} (${result.zip_code})`,
                        fromRequested: false,
                        path: result.path,
                        distance: result.total_distance
                    });
                });
            });
        }
    });
});

// Function to find nearest neighbor with available vehicle
function findNearestWithVehicle(startZipCode, vehicleType, callback) {
    // Get the ID of the starting zip code
    db.query('SELECT zip_id FROM zip_codes WHERE zip_code = ?', [startZipCode], (err, results) => {
        if (err) return callback(err);
        if (results.length === 0) return callback(new Error('Invalid ZIP code'));
        
        const startZipId = results[0].zip_id;
        
        // Use Dijkstra's algorithm to find shortest path to a location with available vehicle
        const visited = new Set();
        const distances = {};
        const previous = {};
        const queue = [];
        
        // Initialize distances
        db.query('SELECT zip_id FROM zip_codes', (err, results) => {
            if (err) return callback(err);
            
            results.forEach(row => {
                const id = row.zip_id;
                distances[id] = id === startZipId ? 0 : Infinity;
                queue.push(id);
            });
            
            while (queue.length > 0) {
                // Find zip with minimum distance
                queue.sort((a, b) => distances[a] - distances[b]);
                const current = queue.shift();
                
                // Skip if we've visited this node
                if (visited.has(current)) continue;
                visited.add(current);
                
                // Check if this location has the vehicle available
                db.query(
                    `SELECT v.id, v.available_count, z.zip_code, z.location_name 
                     FROM vehicles v 
                     JOIN zip_codes z ON v.zip_id = z.zip_id 
                     WHERE v.zip_id = ? AND v.vehicle_type = ? AND v.available_count > 0`,
                    [current, vehicleType],
                    (err, results) => {
                        if (err) return callback(err);
                        
                        if (results.length > 0) {
                            // Found a location with available vehicle
                            // Reconstruct the path
                            const path = [];
                            let u = current;
                            
                            if (previous[u]) {
                                while (u) {
                                    path.unshift(u);
                                    u = previous[u];
                                }
                            }
                            
                            // Get details for all zip codes in the path
                            const zipIds = path.join(',');
                            db.query(
                                `SELECT zip_id, zip_code, location_name FROM zip_codes WHERE zip_id IN (${zipIds})`,
                                (err, pathDetails) => {
                                    if (err) return callback(err);
                                    
                                    callback(null, {
                                        vehicle_id: results[0].id,
                                        zip_code: results[0].zip_code,
                                        location_name: results[0].location_name,
                                        path: pathDetails,
                                        total_distance: distances[current]
                                    });
                                }
                            );
                            return;
                        }
                        
                        // Get all neighbors of the current node
                        db.query(
                            'SELECT neighbor_zip_id, distance FROM neighbors WHERE zip_id = ?',
                            [current],
                            (err, neighbors) => {
                                if (err) return callback(err);
                                
                                neighbors.forEach(neighbor => {
                                    const alt = distances[current] + neighbor.distance;
                                    if (alt < distances[neighbor.neighbor_zip_id]) {
                                        distances[neighbor.neighbor_zip_id] = alt;
                                        previous[neighbor.neighbor_zip_id] = current;
                                    }
                                });
                                
                                processNextNode();
                            }
                        );
                    }
                );
            }
            
            // No path found
            callback(null, null);
        });
    });
}

// GET distances between ZIP codes
app.get('/api/distances', (req, res) => {
    const query = `
        SELECT 
            n.zip_id as from_zip,
            n.neighbor_zip_id as to_zip,
            z1.zip_code as from_zip_code,
            z2.zip_code as to_zip_code,
            n.distance
        FROM neighbors n
        JOIN zip_codes z1 ON n.zip_id = z1.zip_id
        JOIN zip_codes z2 ON n.neighbor_zip_id = z2.zip_id
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            console.error('Database query error:', err);
            return res.status(500).json({ 
                error: "Database error",
                details: err.message 
            });
        }
        res.json(results);
    });
});

app.listen(port, () => {
    console.log(`API server running on port ${port}`);
});