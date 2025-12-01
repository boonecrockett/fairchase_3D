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
    console.log('📝 REPORT INIT: Cleared daily events');
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
    // if (!data.hideFromReport) {
        gameContext.currentDayEvents.push(event);
        console.log('📝 LOG EVENT:', eventType, 'Total events:', gameContext.currentDayEvents.length);
    // }
    
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
        case "Deer Spooked":
            gameContext.currentDayStats.deerSpooked = (gameContext.currentDayStats.deerSpooked || 0) + 1;
            break;
        case "Excessive Shots":
            gameContext.currentDayStats.excessiveShots = (gameContext.currentDayStats.excessiveShots || 0) + 1;
            break;
        case "Tracking Bonus":
            gameContext.currentDayStats.trackingBonusAwarded = true;
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
    const events = gameContext.currentDayEvents || [];
    
    // Calculate itemized scores
    let bonusItems = [];
    let penaltyItems = [];
    let totalBonuses = 0;
    let totalPenalties = 0;
    
    // Bonuses
    if (gameContext.killInfo) {
        const killScore = gameContext.killInfo.score || 0;
        if (killScore > 0) {
            bonusItems.push({ name: 'Kill Shot', value: killScore });
            totalBonuses += killScore;
        }
    }
    // Scouting no longer awards points
    if (gameContext.trackingBonusAwarded) {
        bonusItems.push({ name: 'Tracking', value: 2 });
        totalBonuses += 2;
    }
    if (stats.deerTagged) {
        bonusItems.push({ name: 'Tagged Deer', value: 25 });
        totalBonuses += 25;
    }
    
    // Penalties
    // GPS map usage no longer penalized
    if (gameContext.spookingPenaltyApplied) {
        penaltyItems.push({ name: 'Spooked', value: 5 });
        totalPenalties += 5;
    }
    const missedShots = stats.shotsTaken - stats.hits;
    if (missedShots > 0) {
        const penalty = missedShots * 5;
        penaltyItems.push({ name: `Missed (${missedShots}x)`, value: penalty });
        totalPenalties += penalty;
    }
    if (stats.shotsTaken > 3) {
        const excessiveShots = stats.shotsTaken - 3;
        const penalty = excessiveShots * 10;
        penaltyItems.push({ name: `Excess Shots (${excessiveShots}x)`, value: penalty });
        totalPenalties += penalty;
    }
    // Bad shot penalties (gut, rear, shoulder)
    if (gameContext.badShotPenalties && gameContext.badShotPenalties.length > 0) {
        const shotNames = { 'gut': 'Gut Shot', 'rear': 'Rear Shot', 'shoulderLeft': 'Shoulder', 'shoulderRight': 'Shoulder' };
        gameContext.badShotPenalties.forEach(shot => {
            const name = shotNames[shot.hitZone] || shot.hitZone;
            penaltyItems.push({ name: name, value: shot.penalty });
            totalPenalties += shot.penalty;
        });
    }
    
    const finalScore = totalBonuses - totalPenalties;
    
    // Build compact report
    let reportHTML = `<div class="report-compact">`;
    
    // Top row: Hunt Stats, Shot Info, and Score Summary
    reportHTML += `<div class="report-top-row">`;
    
    // Hunt Stats (left)
    reportHTML += `<div class="hunt-stats">`;
    reportHTML += `<div class="stat-row"><span>Started</span><span>${stats.timeStarted}</span></div>`;
    reportHTML += `<div class="stat-row"><span>Hiked</span><span>${(stats.distanceTraveled * 1.09361).toFixed(0)} yds</span></div>`;
    if (stats.trackingDistance > 0) {
        reportHTML += `<div class="stat-row"><span>Tracked</span><span>${(stats.trackingDistance * 1.09361).toFixed(0)} yds</span></div>`;
    }
    reportHTML += `<div class="stat-row"><span>Shots</span><span>${stats.shotsTaken}${stats.shotsTaken > 0 ? ` (${Math.round((stats.hits / stats.shotsTaken) * 100)}%)` : ''}</span></div>`;
    
    // Status
    let statusText = '';
    let statusClass = '';
    if (stats.deerKilled && stats.deerTagged) {
        statusText = '✓ Hunt Complete';
        statusClass = 'success';
    } else if (stats.deerKilled && !stats.deerTagged) {
        statusText = '⚠ Tag Deer';
        statusClass = 'warning';
    } else if (stats.isTracking || (stats.shotsTaken > 0 && stats.hits > 0)) {
        statusText = '🩸 Tracking';
        statusClass = 'warning';
    } else if (stats.deerSightings > 0) {
        statusText = '🦌 Hunting';
        statusClass = 'info';
    } else {
        statusText = '🔍 Scouting';
        statusClass = 'info';
    }
    reportHTML += `<div class="stat-row status"><span class="${statusClass}">${statusText}</span></div>`;
    reportHTML += `</div>`;
    
    // Shot/Wound Info (center) - only show if deer was hit
    if (stats.hits > 0 && gameContext.deer && gameContext.deer.woundState) {
        const woundState = gameContext.deer.woundState;
        const woundType = woundState.woundType;
        reportHTML += `<div class="shot-info">`;
        reportHTML += `<div class="shot-info-header">Shot Placement</div>`;
        if (woundType) {
            reportHTML += `<div class="wound-type">${woundType.displayName || woundType.name}</div>`;
            if (gameContext.killInfo) {
                const shotDist = gameContext.killInfo.distance || 0;
                reportHTML += `<div class="shot-detail">${shotDist.toFixed(0)} yds</div>`;
            }
        }
        if (stats.deerKilled) {
            reportHTML += `<div class="harvest-status success">✓ Harvested</div>`;
        } else if (woundType && woundType.survivalChance > 0.5) {
            reportHTML += `<div class="harvest-status warning">May Recover</div>`;
        }
        reportHTML += `</div>`;
    }
    
    // Score Summary (right)
    const scoreClass = finalScore >= 0 ? 'positive' : 'negative';
    reportHTML += `<div class="score-summary">`;
    reportHTML += `<div class="final-score ${scoreClass}">${finalScore >= 0 ? '+' : ''}${finalScore}</div>`;
    reportHTML += `<div class="score-label">Ethics Score</div>`;
    reportHTML += `</div>`;
    
    reportHTML += `</div>`; // End top row
    
    // Score Breakdown - horizontal layout
    reportHTML += `<div class="score-breakdown-row">`;
    
    // Bonuses column
    reportHTML += `<div class="score-col bonuses-col">`;
    reportHTML += `<div class="col-header">Bonuses</div>`;
    if (bonusItems.length > 0) {
        bonusItems.forEach(item => {
            reportHTML += `<div class="score-item positive"><span>${item.name}</span><span>+${item.value}</span></div>`;
        });
    } else {
        reportHTML += `<div class="score-item muted">None yet</div>`;
    }
    reportHTML += `<div class="col-total positive">+${totalBonuses}</div>`;
    reportHTML += `</div>`;
    
    // Penalties column
    reportHTML += `<div class="score-col penalties-col">`;
    reportHTML += `<div class="col-header">Deductions</div>`;
    if (penaltyItems.length > 0) {
        penaltyItems.forEach(item => {
            reportHTML += `<div class="score-item negative"><span>${item.name}</span><span>-${item.value}</span></div>`;
        });
    } else {
        reportHTML += `<div class="score-item muted">None</div>`;
    }
    reportHTML += `<div class="col-total negative">-${totalPenalties}</div>`;
    reportHTML += `</div>`;
    
    // Final column
    reportHTML += `<div class="score-col final-col">`;
    reportHTML += `<div class="col-header">Total</div>`;
    reportHTML += `<div class="final-calc">`;
    reportHTML += `<div class="calc-row"><span>Bonuses</span><span>+${totalBonuses}</span></div>`;
    reportHTML += `<div class="calc-row"><span>Deductions</span><span>-${totalPenalties}</span></div>`;
    reportHTML += `<div class="calc-total ${scoreClass}"><span>Final</span><span>${finalScore >= 0 ? '+' : ''}${finalScore}</span></div>`;
    reportHTML += `</div>`;
    reportHTML += `</div>`;
    
    reportHTML += `</div>`; // End score breakdown row
    
    // Hunter's Log toggle button and collapsible log
    reportHTML += `<div class="hunters-log-section">`;
    reportHTML += `<button class="hunters-log-toggle" onclick="document.getElementById('hunters-log-content').classList.toggle('expanded')">`;
    reportHTML += `<span>Hunter's Log</span><span class="log-count">${events.length} entries</span>`;
    reportHTML += `</button>`;
    
    reportHTML += `<div id="hunters-log-content" class="hunters-log-content">`;
    if (events.length > 0) {
        events.forEach(event => {
            const eventClass = getEventClass(event.eventType);
            reportHTML += `<div class="log-entry ${eventClass}">`;
            reportHTML += `<span class="log-time">[${event.gameTime}]</span>`;
            reportHTML += `<span class="log-type">${event.eventType}</span>`;
            reportHTML += `<span class="log-desc">${event.description}</span>`;
            reportHTML += `</div>`;
        });
    } else {
        reportHTML += `<div class="log-entry muted">No events recorded yet</div>`;
    }
    reportHTML += `</div>`;
    reportHTML += `</div>`;
    
    reportHTML += `</div>`; // End report-compact
    
    return reportHTML;
}

/**
 * Gets CSS class for event type styling
 */
function getEventClass(eventType) {
    switch (eventType) {
        case "Shot Taken":
        case "Deer Killed":
        case "Deer Wounded":
        case "Deer Tagged":
            return "event-important";
        case "Deer Sighted":
        case "Tracking Bonus":
            return "event-sighting";
        case "Map Checked":
        case "Battery Used":
            return "event-utility";
        case "Deer Spooked":
        case "Excessive Shots":
            return "event-penalty";
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
