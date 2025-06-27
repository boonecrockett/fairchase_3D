// js/report-logger.js
import { gameContext } from './context.js';

/**
 * Formats game time for display in reports
 */
function formatGameTime(gameTime) {
    if (!gameTime && gameTime !== 0) return 'Unknown';
    const hours = Math.floor(gameTime);
    const minutes = Math.floor((gameTime % 1) * 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Real-time report logging system that tracks events as they happen
 */

/**
 * Initializes the current day's report tracking
 */
export function initializeDayReport() {
    gameContext.currentDayEvents = [];
    gameContext.currentDayStats = {
        distanceTraveled: 0,
        trackingDistance: 0,
        timeStarted: new Date().toLocaleTimeString(),
        deerSightings: 0,
        shotsTaken: 0,
        hits: 0,
        misses: 0,
        deerKilled: false,
        deerTagged: false,
        isTracking: false,
        mapChecks: 0,
        batteryUsed: 0
    };
    
    logEvent("Hunt started", "Beginning today's hunt in the wilderness");
}

/**
 * Logs an event to the current day's events and updates statistics
 */
export function logEvent(eventType, description, data = {}) {
    const gameTime = formatGameTime(gameContext.gameTime);
    
    const event = {
        eventType,
        description,
        gameTime,
        realTime: new Date().toLocaleTimeString(),
        data
    };
    
    // Only add to events list if not hidden from report
    if (!data.hideFromReport) {
        gameContext.currentDayEvents.push(event);
    }
    
    // Always update statistics regardless of hideFromReport flag
    updateStats(eventType, data);
    
    // Update the report modal if it's open
    updateReportModal();
}

/**
 * Updates current day statistics based on event type
 */
export function updateStats(eventType, data) {
    switch (eventType) {
        case "Shot Taken":
            gameContext.currentDayStats.shotsTaken++;
            if (data.hit) {
                gameContext.currentDayStats.hits++;
            } else {
                gameContext.currentDayStats.misses++;
            }
            break;
        case "Deer Sighted":
            gameContext.currentDayStats.deerSightings++;
            break;
        case "Deer Killed":
            gameContext.currentDayStats.deerKilled = true;
            gameContext.currentDayStats.isTracking = false; // Stop tracking when deer is killed
            break;
        case "Deer Wounded":
            gameContext.currentDayStats.isTracking = true; // Start tracking wounded deer
            break;
        case "Deer Tagged":
            gameContext.currentDayStats.deerTagged = true;
            break;
        case "Map Checked":
            gameContext.currentDayStats.mapChecks++;
            break;
        case "Battery Used":
            gameContext.currentDayStats.batteryUsed += data.amount || 1;
            break;
        default:
            // Unknown event type - silently ignore
            break;
    }
}

/**
 * Updates distance traveled (called from movement system)
 */
export function updateDistanceTraveled(distance) {
    gameContext.currentDayStats.distanceTraveled += distance;
    
    // If tracking wounded deer, also update tracking distance
    if (gameContext.currentDayStats.isTracking) {
        gameContext.currentDayStats.trackingDistance += distance;
    }
}

/**
 * Generates the current real-time report content
 */
export function generateCurrentReport() {
    const stats = gameContext.currentDayStats;
    const events = gameContext.currentDayEvents;
    
    let reportHTML = `<h3>Today's Hunt - Live Report</h3>`;
    
    // Current stats
    reportHTML += `<div class="stat-section">`;
    reportHTML += `<h4>Current Statistics</h4>`;
    reportHTML += `<div class="stat-line"><span class="highlight">Hunt Started:</span> ${stats.timeStarted}</div>`;
    reportHTML += `<div class="stat-line"><span class="highlight">Distance Traveled:</span> ${stats.distanceTraveled.toFixed(2)} meters (${(stats.distanceTraveled / 1609.34).toFixed(2)} miles)</div>`;
    
    // Only show tracking distance if deer has been wounded
    if (stats.trackingDistance > 0) {
        reportHTML += `<div class="stat-line"><span class="highlight">Tracking Distance:</span> ${stats.trackingDistance.toFixed(2)} meters (${(stats.trackingDistance / 1609.34).toFixed(2)} miles)</div>`;
    }
    
    reportHTML += `<div class="stat-line"><span class="highlight">Deer Sightings:</span> ${stats.deerSightings}</div>`;
    reportHTML += `<div class="stat-line"><span class="highlight">Shots Taken:</span> ${stats.shotsTaken}</div>`;
    
    if (stats.shotsTaken > 0) {
        const accuracy = Math.round((stats.hits / stats.shotsTaken) * 100);
        reportHTML += `<div class="stat-line"><span class="highlight">Shot Accuracy:</span> ${stats.hits}/${stats.shotsTaken} (${accuracy}%)</div>`;
    }
    
    reportHTML += `<div class="stat-line"><span class="highlight">Map Checks:</span> ${stats.mapChecks}</div>`;
    
    // Get current battery level from gameContext
    const currentBattery = gameContext.batteryLevel || 100;
    reportHTML += `<div class="stat-line"><span class="highlight">Battery Level:</span> ${currentBattery}%</div>`;
    reportHTML += `<div class="stat-line"><span class="highlight">Battery Used:</span> ${stats.batteryUsed}%</div>`;
    
    if (stats.deerKilled) {
        reportHTML += `<div class="stat-line"><span class="success">✓ Deer Harvested</span></div>`;
        if (stats.deerTagged) {
            reportHTML += `<div class="stat-line"><span class="success">✓ Deer Tagged</span></div>`;
        }
    }
    reportHTML += `</div>`;
    
    // Recent events
    if (events.length > 0) {
        reportHTML += `<div class="events-section">`;
        reportHTML += `<h4>Recent Events</h4>`;
        
        // Show last 10 events in chronological order (oldest at bottom)
        const recentEvents = events.slice(-10);
        
        recentEvents.forEach(event => {
            const eventClass = getEventClass(event.eventType);
            reportHTML += `<div class="event-line ${eventClass}">`;
            reportHTML += `<span class="event-time">[${event.gameTime}]</span> `;
            reportHTML += `<span class="event-type">${event.eventType}:</span> `;
            reportHTML += `<span class="event-desc">${event.description}</span>`;
            reportHTML += `</div>`;
        });
        
        reportHTML += `</div>`;
    }
    
    // Hunt status
    reportHTML += `<div class="status-section">`;
    reportHTML += `<h4>Hunt Status</h4>`;
    
    if (stats.deerKilled && stats.deerTagged) {
        reportHTML += `<div class="stat-line"><span class="success">✓ Successful hunt completed</span></div>`;
    } else if (stats.deerKilled && !stats.deerTagged) {
        reportHTML += `<div class="stat-line"><span class="warning">⚠ Deer harvested but not yet tagged</span></div>`;
    } else if (stats.isTracking) {
        reportHTML += `<div class="stat-line"><span class="warning">🩸 Tracking wounded deer - ${(stats.trackingDistance / 1609.34).toFixed(2)} miles tracked</span></div>`;
    } else if (stats.shotsTaken > 0 && stats.hits > 0) {
        reportHTML += `<div class="stat-line"><span class="warning">⚠ Deer wounded - continue tracking</span></div>`;
    } else if (stats.deerSightings > 0) {
        reportHTML += `<div class="stat-line"><span class="info">🦌 Deer spotted - hunt in progress</span></div>`;
    } else {
        reportHTML += `<div class="stat-line"><span class="info">🔍 Searching for deer</span></div>`;
    }
    
    reportHTML += `</div>`;
    
    return reportHTML;
}

/**
 * Gets CSS class for event type styling
 */
function getEventClass(eventType) {
    switch (eventType) {
        case "Shot Taken":
        case "Deer Killed":
        case "Deer Tagged":
            return "event-important";
        case "Deer Sighted":
            return "event-sighting";
        case "Map Checked":
        case "Battery Used":
            return "event-utility";
        default:
            return "event-normal";
    }
}

/**
 * Updates the report modal if it's currently open
 */
export function updateReportModal() {
    if (gameContext.reportModalBackdrop && gameContext.reportModalBackdrop.style.display === 'flex') {
        const currentReportHTML = generateCurrentReport();
        gameContext.reportContent.innerHTML = currentReportHTML;
    }
}
