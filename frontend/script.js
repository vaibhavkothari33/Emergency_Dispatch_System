// Configuration
const API_BASE_URL = 'http://localhost:3000/api';

// DOM Elements
const zipCodeSelect = document.getElementById('zipCode');
const vehicleTypeSelect = document.getElementById('vehicleType');
const emergencyForm = document.getElementById('emergencyForm');
const dispatchResult = document.getElementById('dispatchResult');
const pathResult = document.getElementById('pathResult');
const availabilityTable = document.getElementById('availabilityTable').querySelector('tbody');

// State
let zipCodes = [];
let availability = [];
let distanceGraph = {}; // Graph representation of ZIP code connections

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await Promise.all([
            loadZipCodes(),
            loadAvailability(),
            loadDistances() // Load distances between connected ZIP codes
        ]);
        
        // Set up event listeners
        emergencyForm.addEventListener('submit', handleDispatch);
    } catch (error) {
        console.error('Error initializing app:', error);
        showError('Failed to initialize the application. Please check your connection to the API server.');
    }
});

// Load ZIP Codes for dropdown
async function loadZipCodes() {
    try {
        const response = await fetchWithRetry(`${API_BASE_URL}/zipcodes`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        zipCodes = await response.json();
        
        // Clear existing options
        zipCodeSelect.innerHTML = '<option value="">Select ZIP Code</option>';
        
        // Populate dropdown
        zipCodes.forEach(zip => {
            const option = document.createElement('option');
            option.value = zip.zip_code;
            option.textContent = `${zip.zip_code} - ${zip.location_name}`;
            zipCodeSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading ZIP codes:', error);
        showError(`Failed to load ZIP codes: ${error.message}. Please refresh the page.`);
        throw error;
    }
}

// Load distances between ZIP codes to build the graph
async function loadDistances() {
    try {
        const response = await fetchWithRetry(`${API_BASE_URL}/distances`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        const distances = await response.json();
        buildDistanceGraph(distances);
        console.log('Distance graph built successfully:', distanceGraph);
    } catch (error) {
        console.error('Error loading distances:', error);
        showError('Failed to load distance data. Optimal routing may not be available.');
    }
}

// Build the distance graph from the API response
function buildDistanceGraph(distances) {
    distanceGraph = {};
    
    // Initialize empty arrays for each ZIP code
    zipCodes.forEach(zip => {
        distanceGraph[zip.zip_code] = [];
    });
    
    // Add connections between ZIP codes
    distances.forEach(connection => {
        // Add bidirectional edges (assuming connections work both ways)
        distanceGraph[connection.from_zip].push({
            zipCode: connection.to_zip,
            distance: connection.distance
        });
        
        // If distances are directional, you might want to comment out this part
        distanceGraph[connection.to_zip].push({
            zipCode: connection.from_zip,
            distance: connection.distance
        });
    });
}

// Load vehicle availability data
async function loadAvailability() {
    try {
        const response = await fetchWithRetry(`${API_BASE_URL}/availability`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        availability = await response.json();
        updateAvailabilityTable();
    } catch (error) {
        console.error('Error loading availability data:', error);
        showError('Failed to load availability data. Please refresh the page.');
        throw error;
    }
}

// Update the availability table
function updateAvailabilityTable() {
    // Clear existing rows
    availabilityTable.innerHTML = '';
    
    // Add new rows
    availability.forEach(item => {
        const row = document.createElement('tr');
        
        // ZIP Code
        const zipCell = document.createElement('td');
        zipCell.textContent = item.zip_code;
        row.appendChild(zipCell);
        
        // Location name
        const locationCell = document.createElement('td');
        locationCell.textContent = item.location_name;
        row.appendChild(locationCell);
        
        // Ambulance count
        const ambulanceCell = document.createElement('td');
        ambulanceCell.textContent = item.ambulance_count;
        ambulanceCell.className = getCountClass(item.ambulance_count);
        row.appendChild(ambulanceCell);
        
        // Fire truck count
        const fireCell = document.createElement('td');
        fireCell.textContent = item.fire_truck_count;
        fireCell.className = getCountClass(item.fire_truck_count);
        row.appendChild(fireCell);
        
        // Police count
        const policeCell = document.createElement('td');
        policeCell.textContent = item.police_count;
        policeCell.className = getCountClass(item.police_count);
        row.appendChild(policeCell);
        
        availabilityTable.appendChild(row);
    });
}

// Get CSS class based on count
function getCountClass(count) {
    if (count === 0) return 'count-low';
    if (count === 1) return 'count-medium';
    return 'count-high';
}

// Handle dispatch form submission
async function handleDispatch(event) {
    event.preventDefault();
    
    const zipCode = zipCodeSelect.value;
    const vehicleType = vehicleTypeSelect.value;
    
    if (!zipCode || !vehicleType) {
        showError('Please select both a ZIP code and a vehicle type.');
        return;
    }
    
    // Show loading state
    dispatchResult.innerHTML = '<p class="info">Processing dispatch request...</p>';
    pathResult.style.display = 'none';
    
    try {
        // Check if the vehicle is available at the requested ZIP code
        const vehicleProperty = getVehicleProperty(vehicleType);
        const localAvailability = availability.find(item => item.zip_code === zipCode);
        
        if (localAvailability && localAvailability[vehicleProperty] > 0) {
            // Local dispatch logic - no changes needed
            const response = await fetch(`${API_BASE_URL}/dispatch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ zipCode, vehicleType })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to dispatch vehicle');
            }
            
            displayDispatchResult(result);
        } else {
            // Find nearest available vehicle
            console.log(`No ${vehicleType} available at ${zipCode}, searching nearby locations...`);
            const nearestResult = await findNearestVehicle(zipCode, vehicleType);
            
            if (!nearestResult) {
                throw new Error(`No ${vehicleType} is available in any location.`);
            }
            
            // Send dispatch request with the nearest vehicle's information
            const response = await fetch(`${API_BASE_URL}/dispatch-from-nearest`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    destinationZipCode: zipCode,
                    sourceZipCode: nearestResult.sourceZipCode,
                    vehicleType: vehicleType,
                    path: nearestResult.path
                })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to dispatch vehicle from nearest location');
            }
            
            displayDispatchResult({
                message: `${vehicleType} dispatched from ${nearestResult.sourceLocationName} to ${nearestResult.destinationLocationName}`,
                path: nearestResult.pathDetails,
                distance: nearestResult.totalDistance
            });
        }
        
        // Refresh availability data after successful dispatch
        await loadAvailability();
    } catch (error) {
        console.error('Error dispatching vehicle:', error);
        showError(error.message || 'Failed to dispatch vehicle. Please try again.');
    }
}

// Display dispatch result
function displayDispatchResult(result) {
    // Show success message
    dispatchResult.innerHTML = `
        <p class="success">${result.message || 'Vehicle successfully dispatched!'}</p>
    `;
    
    // Show path information if available
    if (result.path) {
        pathResult.style.display = 'block';
        
        let pathDetails;
        
        if (Array.isArray(result.path)) {
            // Format path details if it's an array of objects
            pathDetails = result.path.map(point => 
                `${point.location_name || point.locationName} (${point.zip_code || point.zipCode})`
            ).join(' → ');
        } else {
            // If path is already formatted
            pathDetails = result.path;
        }
        
        pathResult.innerHTML = `
            <p><strong>Dispatch Path:</strong></p>
            <p>${pathDetails}</p>
            <p><strong>Total Distance:</strong> ${result.distance.toFixed(1)} miles</p>
            <p><strong>Estimated Arrival Time:</strong> ${calculateEstimatedArrival(result.distance)}</p>
        `;
    } else {
        pathResult.style.display = 'none';
    }
}

// Calculate estimated arrival time based on distance
function calculateEstimatedArrival(distanceMiles) {
    // Assume average speed of emergency vehicles is 35 mph
    const averageSpeed = 35; 
    const timeHours = distanceMiles / averageSpeed;
    const timeMinutes = Math.round(timeHours * 60);
    
    return `${timeMinutes} minutes`;
}

// Show error message
function showError(message) {
    dispatchResult.innerHTML = `<p class="error">${message}</p>`;
    pathResult.style.display = 'none';
}

// Get property name for the selected vehicle type
function getVehicleProperty(vehicleType) {
    switch(vehicleType) {
        case 'Ambulance':
            return 'ambulance_count';
        case 'Fire Truck':
            return 'fire_truck_count';
        case 'Police':
            return 'police_count';
        default:
            return null;
    }
}

function calculatePath(fromZip, toZip) {
    const distances = {};
    const previous = {};
    const unvisited = new Set();

    // Initialize all distances to Infinity and unvisited set
    Object.keys(distanceGraph).forEach(zip => {
        distances[zip] = Infinity;
        previous[zip] = null;
        unvisited.add(zip);
    });
    distances[fromZip] = 0;

    while (unvisited.size > 0) {
        // Find the unvisited node with the smallest distance
        let currentZip = Array.from(unvisited).reduce((minZip, zip) =>
            distances[zip] < distances[minZip] ? zip : minZip
        );

        if (distances[currentZip] === Infinity) break; // All remaining are unreachable
        if (currentZip === toZip) break; // Reached destination

        unvisited.delete(currentZip);

        // Check all neighbors of the current node
        distanceGraph[currentZip].forEach(neighbor => {
            if (unvisited.has(neighbor.zipCode)) {
                const alt = distances[currentZip] + neighbor.distance;
                if (alt < distances[neighbor.zipCode]) {
                    distances[neighbor.zipCode] = alt;
                    previous[neighbor.zipCode] = currentZip;
                }
            }
        });
    }

    // Reconstruct the path
    const path = [];
    let current = toZip;

    while (current) {
        path.unshift(current);
        current = previous[current];
    }

    // Return null if there's no path
    if (path[0] !== fromZip) {
        return null;
    }

    return {
        path,
        totalDistance: distances[toZip]
    };
}



// Update findNearestVehicle function to be async
async function findNearestVehicle(startZipCode, vehicleType) {
    console.log(`Finding nearest ${vehicleType} from ${startZipCode}`);
    
    const vehicleProperty = getVehicleProperty(vehicleType);
    if (!vehicleProperty) {
        console.error('Invalid vehicle type');
        return null;
    }
    
    // Sort all locations by availability and distance
    const availableLocations = availability
        .filter(item => item.zip_code !== startZipCode && item[vehicleProperty] > 0)
        .map(item => {
            const distance = calculateDistance(startZipCode, item.zip_code);
            return {
                ...item,
                distance
            };
        })
        .sort((a, b) => a.distance - b.distance);

    if (availableLocations.length > 0) {
        const nearest = availableLocations[0];
        const path = calculatePath(startZipCode, nearest.zip_code);
        
        return {
            sourceZipCode: nearest.zip_code,
            sourceLocationName: nearest.location_name,
            destinationZipCode: startZipCode,
            destinationLocationName: zipCodes.find(z => z.zip_code === startZipCode)?.location_name || 'Unknown',
            path: path,
            pathDetails: path.map(zip => ({
                zipCode: zip,
                locationName: zipCodes.find(z => z.zip_code === zip)?.location_name || 'Unknown'
            })),
            totalDistance: nearest.distance
        };
    }
    
    return null;
}

// Add retry logic for API calls
async function fetchWithRetry(url, options, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
            }
            return response;
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}

function calculateDistance(fromZip, toZip) {
    // Check if we have direct connection in the graph
    const directConnection = distanceGraph[fromZip]?.find(
        connection => connection.zipCode === toZip
    );
    
    if (directConnection) {
        return directConnection.distance;
    }

    // If no direct connection, use Dijkstra's algorithm to find shortest path
    const distances = {};
    const previous = {};
    const unvisited = new Set();

    // Initialize distances
    Object.keys(distanceGraph).forEach(zip => {
        distances[zip] = Infinity;
        previous[zip] = null;
        unvisited.add(zip);
    });
    distances[fromZip] = 0;

    while (unvisited.size > 0) {
        // Find the unvisited node with minimum distance
        let currentZip = Array.from(unvisited).reduce((minZip, zip) => 
            distances[zip] < distances[minZip] ? zip : minZip
        );

        if (currentZip === toZip) {
            break; // Found the destination
        }

        unvisited.delete(currentZip);

        // Update distances to neighbors
        distanceGraph[currentZip].forEach(neighbor => {
            if (unvisited.has(neighbor.zipCode)) {
                const alt = distances[currentZip] + neighbor.distance;
                if (alt < distances[neighbor.zipCode]) {
                    distances[neighbor.zipCode] = alt;
                    previous[neighbor.zipCode] = currentZip;
                }
            }
        });
    }

    return distances[toZip] === Infinity ? null : distances[toZip];
}