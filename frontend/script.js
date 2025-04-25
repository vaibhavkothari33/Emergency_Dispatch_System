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

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await Promise.all([
            loadZipCodes(),
            loadAvailability()
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
        const response = await fetch(`${API_BASE_URL}/zipcodes`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
        }
        
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
        showError('Failed to load ZIP codes. Please refresh the page.');
        throw error;
    }
}

// Load vehicle availability data
async function loadAvailability() {
    try {
        const response = await fetch(`${API_BASE_URL}/availability`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
        }
        
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
        
        // Show success message
        dispatchResult.innerHTML = `
            <p class="success">${result.message}</p>
        `;
        
        // Show path information if available
        if (result.path && result.distance) {
            pathResult.style.display = 'block';
            
            // Format path details
            const pathDetails = result.path.map(point => 
                `${point.location_name} (${point.zip_code})`
            ).join(' → ');
            
            pathResult.innerHTML = `
                <p><strong>Dispatch Path:</strong></p>
                <p>${pathDetails}</p>
                <p><strong>Total Distance:</strong> ${result.distance.toFixed(1)} miles</p>
            `;
        } else {
            pathResult.style.display = 'none';
        }
        
        // Refresh availability data after successful dispatch
        await loadAvailability();
    } catch (error) {
        console.error('Error dispatching vehicle:', error);
        showError(error.message || 'Failed to dispatch vehicle. Please try again.');
    }
}

// Show error message
function showError(message) {
    dispatchResult.innerHTML = `<p class="error">${message}</p>`;
    pathResult.style.display = 'none';
}

// Simulate graph algorithm for finding nearest vehicle
// This is a placeholder since we're performing this calculation on the server
function findNearestVehicle(startZipCode, vehicleType) {
    // This would implement Dijkstra's algorithm to find the shortest path
    // to a node with an available vehicle of the requested type
    // Since we're using the API approach, this is handled server-side
}