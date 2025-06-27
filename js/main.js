import * as THREE from 'three';
import { setupScene, updateShadowCamera } from './scene.js';
import { createHills, createWater, findDrinkingSpots, createTrees, createBushes, createGrass, isWaterAt } from './world.js';
import { createPlayer, addPlayerEventListeners, updatePlayer, getIsTreeBraced } from './player.js';
import { deer } from './deer.js';
import { initUI, showMessage, updateInteraction, updateCompass, ensureMainMenuHidden } from './ui.js';
import { initAudio, playRifleSound, updateAmbianceForTime } from './audio.js';
import { logEvent, initializeDayReport, updateDistanceTraveled } from './report-logger.js';
import { gameContext } from './context.js'; 
import {
    GAME_TIME_SPEED_MULTIPLIER,
    HOURS_IN_DAY,
    NIGHT_START_HOUR,
    DAWN_START_HOUR,
    SLEEP_SEQUENCE_DELAY_MS,
    SLEEP_SEQUENCE_MAIN_DURATION_MS,
    SLEEP_FADE_OUT_DURATION_MS,
    LEGAL_HUNTING_START_HOUR,
    LEGAL_HUNTING_END_HOUR
} from './constants.js';
import { updateSpatialAudioListener } from './spatial-audio.js';

// --- CORE FUNCTIONS (No longer need context passed) ---

function isNight() {
    const currentTime = gameContext.gameTime;
    return currentTime < DAWN_START_HOUR || currentTime > NIGHT_START_HOUR;
}

function isLegalHuntingTime() {
    const currentTime = gameContext.gameTime;
    return currentTime >= LEGAL_HUNTING_START_HOUR && currentTime <= LEGAL_HUNTING_END_HOUR;
}

function processKill(baseScore, baseMessage, wasMoving, shotCount, distance) {
    let finalScore = baseScore;
    let finalMessage = baseMessage;
    let ethical = true;

    if (!isLegalHuntingTime()) {
        finalScore = -50; // Penalty for illegal harvest
        finalMessage = "Unethical Harvest (Out of Hours)";
        ethical = false;
    }

    gameContext.score += finalScore;
    gameContext.scoreValueElement.textContent = gameContext.score;
    gameContext.killInfo = { 
        score: finalScore, 
        message: finalMessage, 
        wasMoving: wasMoving,
        shotCount: shotCount,
        distance: distance,
        ethical: ethical
    };
    
    const scoreText = finalScore >= 0 ? ` +${finalScore}` : ` ${finalScore}`;
    showMessage(`${finalMessage}!${scoreText} Points`);
    
    gameContext.deer.setState('KILLED');
    const isBraced = getIsTreeBraced();
    logEvent("Deer Killed", `${finalMessage} at ${distance} yards${isBraced ? ' (Braced)' : ''}`, {
        distance: distance,
        moving: wasMoving,
        shotCount: shotCount,
        ethical: ethical,
        braced: isBraced
    });
}

function getHeightAt(x, z) {
    // Use optimized cached height queries for better performance
    return gameContext.getCachedHeightAt(x, z);
}

function shoot() {
    if (gameContext.isSleeping) return;
    
    // Play rifle sound first
    playRifleSound();
    
    // Apply rifle recoil effect immediately after sound
    applyRifleRecoil();

    // Use the correct flag to ensure the GLB model is fully loaded and ready.
    if (!gameContext.deer || !gameContext.deer.isModelLoaded) {
        showMessage("Deer model not loaded yet", 2000);
        return;
    }

    // Check if deer model is actually in the scene
    if (!gameContext.scene.children.includes(gameContext.deer.model)) {
        showMessage("Deer not in scene", 2000);
        return;
    }

    // Determine if deer was moving when shot was taken
    const wasMoving = gameContext.deer.state === 'FLEEING' || gameContext.deer.state === 'WOUNDED' || gameContext.deer.state === 'WANDERING';

    // Calculate distance from shooter to deer for logging
    const shotDistance = gameContext.player.position.distanceTo(gameContext.deer.model.position);
    const shotDistanceYards = Math.round(shotDistance * 1.09361); // Convert to yards

    // Initialize huntLog on first shot if not already initialized
    if (!gameContext.huntLog) { 
        gameContext.huntLog = {
            initialSightingDistance: shotDistanceYards,
            firstShotResult: '',
            firstShotDistance: shotDistanceYards,
            hitLocation: '',
            distanceTrailed: 0,
            recoveryShotDistance: null,
            totalShotsTaken: 0,
            deerInitialPosition: gameContext.deer.model.position.clone()
        };
    }

    // Temporarily make the vitals hitbox visible for the raycaster to detect it.
    gameContext.deer.hitbox.showVitalsForRaycasting();

    gameContext.raycaster.setFromCamera({ x: 0, y: 0 }, gameContext.camera);
    const intersects = gameContext.raycaster.intersectObject(gameContext.deer.model, true);

    // Hide the vitals hitbox again immediately.
    gameContext.deer.hitbox.hideVitalsAfterRaycasting();

    let shotResult = {
        distance: shotDistanceYards,
        hitType: 'miss',
        timestamp: new Date().toLocaleTimeString(),
        deerMoving: wasMoving
    };

    if (intersects.length > 0) {
        // Deer was hit
        const hit = intersects[0];
        let hitName = hit.object.name;
        
        let hitPosition = null;

        // Prioritize the hit: Vitals > Head > Body.
        for (const intersection of intersects) {
            let currentHitObject = intersection.object;
            let currentHitName = currentHitObject.name;
            while (!currentHitName && currentHitObject.parent) {
                currentHitObject = currentHitObject.parent;
                currentHitName = currentHitObject.name;
            }

            if (currentHitName === 'vitals') {
                hitName = 'vitals';
                hitPosition = intersection.point;
                break; // Vitals is highest priority.
            }
            if (currentHitName === 'head' || currentHitName === 'brain') {
                hitName = 'head'; // Normalize to 'head' for processing
                hitPosition = intersection.point;
                break; // Head/brain is second highest priority - always lethal
            }
            if (currentHitName === 'body' && !hitName) {
                hitName = 'body';
                hitPosition = intersection.point;
            }
        }

        if (hitName) {
            
            // Update shot result with hit type
            if (hitName === 'vitals') {
                shotResult.hitType = 'vital';
            } else if (hitName === 'head') {
                shotResult.hitType = 'brain';
            } else if (hitName === 'body') {
                shotResult.hitType = 'wound';
            }
            
            // Mark as a successful hit
            shotResult.hit = true;
            
            // Increment shot count and record hit location
            gameContext.huntLog.totalShotsTaken++;
            
            // Record hit location for report
            if (!gameContext.huntLog.hitLocation) {
                // First hit - record the location
                if (hitName === 'vitals') {
                    gameContext.huntLog.hitLocation = 'Vital organs';
                } else if (hitName === 'head') {
                    gameContext.huntLog.hitLocation = 'Head/Brain';
                } else if (hitName === 'body') {
                    gameContext.huntLog.hitLocation = 'Body';
                }
            }
            
            // Mark deer as actually hit to prevent erratic state cycling
            gameContext.deer.wasActuallyHit = true;
            
            // Create blood indicator at the hit location
            if (hitPosition) {
                gameContext.deer.createShotBloodIndicator(hitPosition);
            }
            
            const distance = gameContext.player.position.distanceTo(gameContext.deer.model.position);
            const wasMoving = gameContext.deer.state === 'FLEEING' || gameContext.deer.state === 'WOUNDED' || gameContext.deer.state === 'WANDERING';
            
            if (hitName === 'vitals' || hitName === 'head') {
                let isLethalShot = true;
                if (hitName === 'vitals') {
                    // Calculate the angle between player and deer to determine shot direction
                    const playerPos = gameContext.player.position;
                    const deerPos = gameContext.deer.model.position;
                    const deerRotation = gameContext.deer.model.rotation.y;
                    
                    // Vector from player to deer (shot direction)
                    const shotDirection = new THREE.Vector3()
                        .subVectors(deerPos, playerPos)
                        .normalize();
                    
                    // Deer's forward direction (using +Z as confirmed correct)
                    const deerForward = new THREE.Vector3(0, 0, 1)
                        .applyAxisAngle(new THREE.Vector3(0, 1, 0), deerRotation);
                    
                    // Calculate the angle between deer's forward direction and shot direction
                    // When deer faces player directly, this should be ~180° (opposite directions)
                    const dotProduct = deerForward.dot(shotDirection);
                    const angle = Math.acos(Math.max(-1, Math.min(1, dotProduct)));
                    const angleInDegrees = THREE.MathUtils.radToDeg(angle);
                    
                    // Convert to shot angle: 180° = frontal, 90° = side, 0° = rear
                    const shotAngle = 180 - angleInDegrees;
                    
                    // Check shot direction based on corrected shot angle
                    if (shotAngle > 135) {
                        // Front shot (135-180°) - instant kill
                        processKill(100, "Perfect Front Vitals Shot", wasMoving, 1, shotDistanceYards);
                    } else if (shotAngle < 45) {
                        // Rear shot (0-45°) - should be treated as hindquarter body shot
                        hitName = 'body';
                        shotResult.hitType = 'wound';
                        gameContext.huntLog.hitLocation = 'Hindquarters';
                        isLethalShot = false;
                    } else {
                        // Side shot (45-135°) - instant kill
                        processKill(80, "Perfect Side Vitals Shot", wasMoving, 1, shotDistanceYards);
                    }
                } else if (hitName === 'head') {
                    // Head/brain shot - instant kill with high score
                    processKill(120, "Perfect Head Shot", wasMoving, 1, shotDistanceYards);
                }
                
                // If shot was reclassified as body shot, fall through to body shot logic
                if (!isLethalShot) {
                    // Process as body shot instead
                    if (gameContext.deer.state !== 'WOUNDED') {
                        gameContext.deer.woundCount = 1;
                        gameContext.deer.setState('WOUNDED');
                        showMessage("Hindquarter shot - deer wounded!");
                        logEvent("Deer Wounded", `Hindquarter shot at ${shotDistanceYards} yards`, {
                            distance: shotDistanceYards,
                            moving: wasMoving
                        });
                        
                        // Check if 3 wounds = kill
                        if (gameContext.deer.woundCount >= 3) {
                            processKill(10, "3-Wound Kill", wasMoving, gameContext.deer.woundCount, shotDistanceYards);
                        }
                    } else {
                        // Already wounded, increment wound count
                        gameContext.deer.woundCount++;
                        showMessage(`Additional wound! (${gameContext.deer.woundCount}/3)`);
                        logEvent("Deer Wounded", `Additional wound at ${shotDistanceYards} yards`, {
                            distance: shotDistanceYards,
                            moving: wasMoving
                        });
                        
                        // Check if 3 wounds = kill
                        if (gameContext.deer.woundCount >= 3) {
                            processKill(10, "3-Wound Kill", wasMoving, gameContext.deer.woundCount, shotDistanceYards);
                        }
                    }
                }
            } else if (hitName === 'body') {
                // Body hit - wound the deer
                if (gameContext.deer.state !== 'WOUNDED') {
                    gameContext.deer.woundCount = 1;
                    gameContext.deer.setState('WOUNDED');
                    showMessage("Body shot - deer wounded!");
                    logEvent("Deer Wounded", `Body shot at ${shotDistanceYards} yards`, {
                        distance: shotDistanceYards,
                        moving: wasMoving
                    });
                    
                    // Check if 3 wounds = kill
                    if (gameContext.deer.woundCount >= 3) {
                        processKill(10, "3-Wound Kill", wasMoving, gameContext.deer.woundCount, shotDistanceYards);
                    }
                } else {
                    // Already wounded, increment wound count
                    gameContext.deer.woundCount++;
                    showMessage(`Additional wound! (${gameContext.deer.woundCount}/3)`);
                    logEvent("Deer Wounded", `Additional wound at ${shotDistanceYards} yards`, {
                        distance: shotDistanceYards,
                        moving: wasMoving
                    });
                    
                    // Check if 3 wounds = kill
                    if (gameContext.deer.woundCount >= 3) {
                        processKill(10, "3-Wound Kill", wasMoving, gameContext.deer.woundCount, shotDistanceYards);
                    }
                }
            }
        } else {
            // Hit a non-critical or unnamed part
            if (gameContext.deer.state !== 'WOUNDED') gameContext.deer.setState('FLEEING');
        }
    } else {
        // Handle a clean miss
        gameContext.score -= 20; // Changed from -50 to -20
        gameContext.scoreValueElement.textContent = gameContext.score;
        showMessage("Missed! -20 Points");
        logEvent("Shot Missed", `Missed shot at ${shotDistanceYards} yards`, {
            distance: shotDistanceYards,
            moving: wasMoving
        });
        if (gameContext.deer.state !== 'WOUNDED' && gameContext.deer.state !== 'FLEEING') {
            gameContext.deer.setState('FLEEING');
        }
    }

    // Log this shot to the shot log
    if (!gameContext.shotLog) {
        gameContext.shotLog = [];
    }
    gameContext.shotLog.push(shotResult);
    
    // Update first shot result if this is the first shot
    if (gameContext.huntLog && gameContext.huntLog.firstShotResult === '') {
        gameContext.huntLog.firstShotResult = shotResult.hitType;
    }

    // Log all shots for statistics tracking
    logEvent("Shot Taken", shotResult.hit ? `Shot hit at ${shotDistanceYards} yards` : `Shot missed at ${shotDistanceYards} yards`, {
        distance: shotDistanceYards,
        moving: wasMoving,
        hit: shotResult.hit,
        hideFromReport: shotResult.hit // Hide successful shots from report since kill events show them
    });
    
    // Update statistics for shot taken
    // Removed updateStats call
    
    // Update report modal if open
    // Removed updateReportModal call
    
    if(gameContext.renderer) gameContext.renderer.render(gameContext.scene, gameContext.camera);
}

// Rifle recoil effect - kicks camera upward and slightly backward
function applyRifleRecoil() {
    if (!gameContext.camera) {
        return;
    }
    
    // Store original camera rotation for restoration
    const originalRotation = {
        x: gameContext.camera.rotation.x,
        y: gameContext.camera.rotation.y,
        z: gameContext.camera.rotation.z
    };
    
    // Recoil parameters with realistic variation
    const baseRecoilStrength = 0.01875; // Reduced by another 50% for very subtle recoil
    const horizontalVariation = 0.0075; // Reduced horizontal variation proportionally
    const rollVariation = 0.004; // Reduced roll variation proportionally
    const recoilDuration = 100; // Hold duration (ms)
    const recoveryDuration = 400; // Recovery back to original position (ms)
    
    // Calculate realistic recoil with increased random variation
    const upwardRecoil = baseRecoilStrength + (Math.random() - 0.5) * 0.012; // Increased variation in upward kick
    const horizontalRecoil = (Math.random() - 0.5) * horizontalVariation * (0.8 + Math.random() * 0.4); // Variable horizontal intensity
    const rollRecoil = (Math.random() - 0.5) * rollVariation * (0.7 + Math.random() * 0.6); // Variable roll intensity
    
    // Add slight directional bias variation (not perfectly centered)
    const directionalBiasX = (Math.random() - 0.5) * 0.003; // Slight up/down bias
    const directionalBiasY = (Math.random() - 0.5) * 0.004; // Slight left/right bias
    
    // Temporarily disable controls if they exist
    const controlsEnabled = gameContext.controls ? gameContext.controls.enabled : null;
    if (gameContext.controls) {
        gameContext.controls.enabled = false;
    }
    
    // Apply multi-axis recoil kick
    gameContext.camera.rotation.x += upwardRecoil + directionalBiasX; // Primary upward kick with slight bias
    gameContext.camera.rotation.y += horizontalRecoil + directionalBiasY; // Random horizontal movement with slight bias
    gameContext.camera.rotation.z += rollRecoil; // Slight roll/twist
    
    // Calculate varied recovery endpoint (not exact return to origin)
    const recoveryOffsetX = (Math.random() - 0.5) * 0.05; // Dramatically increased vertical offset variation
    const recoveryOffsetY = (Math.random() - 0.5) * 0.06; // Dramatically increased horizontal offset variation
    const recoveryOffsetZ = (Math.random() - 0.5) * 0.025; // Dramatically increased roll offset variation
    
    // Calculate final recovery target position
    const recoveryTargetX = originalRotation.x + recoveryOffsetX;
    const recoveryTargetY = originalRotation.y + recoveryOffsetY;
    const recoveryTargetZ = originalRotation.z + recoveryOffsetZ;
    
    // Smooth recovery animation - gradually reduce recoil effect
    const startTime = Date.now();
    
    function animateRecoilRecovery() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / recoveryDuration, 1);
        
        // Use easeOut curve for smooth recovery
        const easeOut = 1 - Math.pow(1 - progress, 3);
        
        // Add unpredictable variation throughout the recovery path
        const recoveryVariationX = Math.sin(progress * Math.PI * 3 + Math.random()) * 0.003; // Unpredictable vertical path
        const recoveryVariationY = Math.cos(progress * Math.PI * 2.5 + Math.random()) * 0.002; // Unpredictable horizontal path
        const recoveryVariationZ = Math.sin(progress * Math.PI * 4 + Math.random()) * 0.001; // Unpredictable roll path
        
        // Gradually return to varied recovery target (not exact origin)
        gameContext.camera.rotation.x = recoveryTargetX + upwardRecoil * (1 - easeOut) + recoveryVariationX + directionalBiasX * (1 - easeOut);
        gameContext.camera.rotation.y = recoveryTargetY + horizontalRecoil * (1 - easeOut) + recoveryVariationY + directionalBiasY * (1 - easeOut);
        gameContext.camera.rotation.z = recoveryTargetZ + rollRecoil * (1 - easeOut) + recoveryVariationZ;
        
        if (progress < 1) {
            requestAnimationFrame(animateRecoilRecovery);
        } else {
            // Settle at the varied recovery target position (not exact origin)
            gameContext.camera.rotation.x = recoveryTargetX;
            gameContext.camera.rotation.y = recoveryTargetY;
            gameContext.camera.rotation.z = recoveryTargetZ;
            
            // Re-enable controls to resume natural weapon sway
            if (gameContext.controls && controlsEnabled !== null) {
                gameContext.controls.enabled = controlsEnabled;
            }
        }
    }
    requestAnimationFrame(animateRecoilRecovery);
}

function tagDeer() {
    if (gameContext.deer.state !== 'KILLED' || !gameContext.canTag || !gameContext.killInfo || gameContext.deer.tagged) {
        return;
    }
    
    const tagBonus = 25;
    gameContext.score += tagBonus;
    gameContext.scoreValueElement.textContent = gameContext.score;
    
    const shotScoreStr = gameContext.killInfo.score >= 0 ? `+${gameContext.killInfo.score}` : `${gameContext.killInfo.score}`;
    const finalMessage = `${gameContext.killInfo.message} (${shotScoreStr}) | Tag Bonus: +${tagBonus}`;
    showMessage(finalMessage);
    logEvent("Deer Tagged", `${finalMessage}`, {
        score: tagBonus,
        bonusType: 'tag'
    });
    
    gameContext.dailyKillInfo = { ...gameContext.huntLog, ...gameContext.killInfo };
    gameContext.huntLog = {}; 
    gameContext.killInfo = null;
    gameContext.canTag = false;
    gameContext.deer.tagged = true; 
    if(gameContext.interactionPromptElement) gameContext.interactionPromptElement.style.display = 'none';
    
    // Wait 10 seconds before spawning a new deer
    setTimeout(() => {
        gameContext.deer.respawn();
    }, 10000); // 10 seconds delay
}

async function handleEndOfDay() {
    // Show the hunters report (real-time report) instead of the old end-of-day report
    showHuntersReport();
    logEvent("Day Ended", "End of day - hunters report displayed", {
        report: gameContext.reportEntries
    });
}

/**
 * Shows the hunters report (real-time report) at the end of the day
 */
function showHuntersReport() {
    // Import the report generator function
    import('./report-logger.js').then(module => {
        const reportHTML = module.generateCurrentReport();
        
        // Show the report in the end-of-day modal
        gameContext.endOfDayContent.innerHTML = reportHTML;
        gameContext.endOfDayModalBackdrop.style.display = 'flex';
        
        // Set up continue button to reset for next day
        if (gameContext.continueToNextDayButton) {
            gameContext.continueToNextDayButton.onclick = () => {
                gameContext.endOfDayModalBackdrop.style.display = 'none';
                
                // Reset daily tracking for new day
                gameContext.distanceTraveled = 0;
                gameContext.dailyKillInfo = null;
                gameContext.huntLog = {};
                
                // Initialize new day report
                import('./report-logger.js').then(reportModule => {
                    reportModule.initializeDayReport();
                });
                
                showMessage("A new day has dawned. Good luck hunting!", 5000);
            };
        }
    });
}

/**
 * Shows the comprehensive end-of-day report with detailed hunt analysis
 */
function showEndOfDayReport() {
    const distanceInMiles = (gameContext.distanceTraveled * 0.000621371).toFixed(2);
    
    // Build comprehensive hunt summary
    let reportHTML = `<h3>Day ${gameContext.reportEntries.length + 1} Summary</h3>`;
    
    // Basic stats
    reportHTML += `<div class="stat-line"><span class="highlight">Distance Traveled:</span> ${distanceInMiles} miles</div>`;
    reportHTML += `<div class="stat-line"><span class="highlight">Time in Field:</span> Full hunting day</div>`;
    
    if (gameContext.dailyKillInfo || (gameContext.huntLog && gameContext.huntLog.totalShotsTaken > 0)) {
        reportHTML += `<h3>Hunt Analysis</h3>`;
        
        const huntData = gameContext.dailyKillInfo || gameContext.huntLog;
        const trailingDistance = Math.round(huntData.distanceTrailed * 1.09361);
        const firstShotDistance = huntData.firstShotDistance || huntData.initialSightingDistance || 'Unknown';
        const finalShotDistance = huntData.recoveryShotDistance || firstShotDistance;
        const hitLocation = huntData.hitLocation || 'Unknown';
        const totalShots = huntData.totalShotsTaken || 1;
        const initialSightingDistance = huntData.initialSightingDistance || 'Unknown';
        const firstShotResult = huntData.firstShotResult || 'Unknown';
        
        // Initial sighting
        reportHTML += `<div class="stat-line"><span class="highlight">Initial Sighting:</span> ${initialSightingDistance} yards</div>`;
        
        // Shot analysis
        reportHTML += `<h3>Shot Analysis</h3>`;
        reportHTML += `<div class="stat-line"><span class="highlight">Total Shots Taken:</span> ${totalShots}</div>`;
        reportHTML += `<div class="stat-line"><span class="highlight">First Shot Distance:</span> ${firstShotDistance} yards</div>`;
        reportHTML += `<div class="stat-line"><span class="highlight">Hit Location:</span> ${hitLocation}</div>`;
        reportHTML += `<div class="stat-line"><span class="highlight">First Shot Result:</span> <span class="${getResultClass(firstShotResult)}">${firstShotResult}</span></div>`;
        
        // Detailed shot log
        if (gameContext.shotLog && gameContext.shotLog.length > 0) {
            reportHTML += `<h3>Detailed Shot Log</h3>`;
            gameContext.shotLog.forEach((shot, index) => {
                const shotNumber = index + 1;
                const hitTypeClass = shot.hitType === 'miss' ? 'error' : 
                                   shot.hitType === 'vital' || shot.hitType === 'brain' ? 'success' : 'warning';
                const hitTypeDisplay = shot.hitType === 'vital' ? 'Vital Hit' :
                                     shot.hitType === 'brain' ? 'Brain Shot' :
                                     shot.hitType === 'wound' ? 'Body Wound' : 'Miss';
                
                reportHTML += `<div class="stat-line">`;
                reportHTML += `<span class="highlight">Shot ${shotNumber} (${shot.timestamp}):</span> `;
                reportHTML += `${shot.distance} yards - `;
                reportHTML += `<span class="${hitTypeClass}">${hitTypeDisplay}</span>`;
                if (shot.deerMoving) {
                    reportHTML += ` (Deer was moving)`;
                }
                reportHTML += `</div>`;
            });
            
            // Shot accuracy summary
            const hits = gameContext.shotLog.filter(shot => shot.hitType !== 'miss').length;
            const accuracy = Math.round((hits / gameContext.shotLog.length) * 100);
            reportHTML += `<div class="stat-line"><span class="highlight">Shot Accuracy:</span> ${hits}/${gameContext.shotLog.length} (${accuracy}%)</div>`;
            
            // Average shot distance
            const totalDistance = gameContext.shotLog.reduce((sum, shot) => sum + shot.distance, 0);
            const avgDistance = Math.round(totalDistance / gameContext.shotLog.length);
            reportHTML += `<div class="stat-line"><span class="highlight">Average Shot Distance:</span> ${avgDistance} yards</div>`;
            
            // Hunt Ethics Analysis
            reportHTML += `<h3>Hunt Ethics Analysis</h3>`;
            const ethicsAnalysis = generateHuntEthicsAnalysis(gameContext.shotLog, huntData);
            reportHTML += ethicsAnalysis;
        }
        
        if (finalShotDistance !== firstShotDistance) {
            reportHTML += `<div class="stat-line"><span class="highlight">Final Shot Distance:</span> ${finalShotDistance} yards</div>`;
        }
        
        // Tracking analysis
        if (trailingDistance > 0) {
            reportHTML += `<h3>Tracking Analysis</h3>`;
            reportHTML += `<div class="stat-line"><span class="highlight">Distance Trailed:</span> ${trailingDistance} yards</div>`;
            
            if (trailingDistance > 100) {
                reportHTML += `<div class="stat-line"><span class="warning">⚠ Extended tracking required - consider shot placement improvement</span></div>`;
            } else if (trailingDistance < 50) {
                reportHTML += `<div class="stat-line"><span class="success">✓ Minimal tracking required - excellent shot placement</span></div>`;
            }
        }
        
        // Ethical assessment
        reportHTML += `<h3>Ethical Assessment</h3>`;
        
        if (gameContext.dailyKillInfo) {
            // Successful hunt
            reportHTML += `<div class="stat-line"><span class="success">✓ Clean, ethical harvest completed</span></div>`;
            
            if (totalShots === 1) {
                reportHTML += `<div class="stat-line"><span class="success">✓ One-shot harvest demonstrates excellent marksmanship</span></div>`;
            } else if (totalShots === 2) {
                reportHTML += `<div class="stat-line"><span class="warning">⚠ Two shots required - consider practicing shot placement</span></div>`;
            } else {
                reportHTML += `<div class="stat-line"><span class="error">⚠ Multiple shots required - significant improvement needed</span></div>`;
            }
            
            if (firstShotDistance <= 100) {
                reportHTML += `<div class="stat-line"><span class="success">✓ Appropriate shooting distance maintained</span></div>`;
            } else if (firstShotDistance <= 200) {
                reportHTML += `<div class="stat-line"><span class="warning">⚠ Long-range shot - ensure adequate practice at this distance</span></div>`;
            } else {
                reportHTML += `<div class="stat-line"><span class="error">⚠ Very long-range shot - consider closer approach for ethical hunting</span></div>`;
            }
            
            // Score breakdown if available
            if (gameContext.dailyKillInfo.message) {
                reportHTML += `<h3>Performance</h3>`;
                reportHTML += `<div class="stat-line"><span class="highlight">Result:</span> <span class="success">${gameContext.dailyKillInfo.message}</span></div>`;
            }
            
        } else if (gameContext.huntLog && gameContext.huntLog.firstShotResult && gameContext.huntLog.firstShotResult.includes('Wounded')) {
            // Wounded but not recovered
            reportHTML += `<div class="stat-line"><span class="error">✗ Wounded animal not recovered</span></div>`;
            reportHTML += `<div class="stat-line"><span class="error">✗ Hunter's responsibility to improve shot placement and tracking skills</span></div>`;
            reportHTML += `<div class="stat-line"><span class="warning">⚠ Consider practicing at shorter distances</span></div>`;
            reportHTML += `<div class="stat-line"><span class="warning">⚠ Review proper shot placement techniques</span></div>`;
        }
        
        // Lessons learned
        reportHTML += `<h3>Lessons Learned</h3>`;
        
        if (hitLocation.includes('Vital')) {
            reportHTML += `<div class="stat-line"><span class="success">✓ Excellent shot placement in vital zone</span></div>`;
        } else if (hitLocation.includes('Head')) {
            reportHTML += `<div class="stat-line"><span class="success">✓ Precise headshot demonstrates excellent marksmanship</span></div>`;
        } else if (hitLocation.includes('Body')) {
            reportHTML += `<div class="stat-line"><span class="warning">⚠ Body shot - aim for vital organs for more ethical harvest</span></div>`;
        }
        
        if (trailingDistance > 200) {
            reportHTML += `<div class="stat-line"><span class="warning">⚠ Extensive tracking suggests shot placement improvement needed</span></div>`;
        }
        
    } else {
        // No shots taken
        reportHTML += `<h3>Hunt Analysis</h3>`;
        reportHTML += `<div class="stat-line">No deer encountered or shot opportunities taken</div>`;
        
        reportHTML += `<h3>Reflection</h3>`;
        reportHTML += `<div class="stat-line"><span class="highlight">Time in nature is valuable regardless of harvest</span></div>`;
        reportHTML += `<div class="stat-line">Consider different hunting locations or times</div>`;
        reportHTML += `<div class="stat-line">Patience and persistence are key hunting virtues</div>`;
    }
    
    // Create simple report entry for the report history
    let simpleReportContent = "The quiet of the woods was its own reward.";
    
    if (gameContext.dailyKillInfo) {
        const huntData = gameContext.dailyKillInfo;
        const trailingDistance = Math.round(huntData.distanceTrailed * 1.09361);
        const firstShotDistance = huntData.firstShotDistance || huntData.initialSightingDistance || 'Unknown';
        const finalShotDistance = huntData.recoveryShotDistance || firstShotDistance;
        const hitLocation = huntData.hitLocation || 'Unknown';
        const totalShots = huntData.totalShotsTaken || 1;
        
        simpleReportContent = `Travelled ${distanceInMiles} miles. A successful day. Sighted the buck at ${huntData.initialSightingDistance} yards. First shot was ${huntData.firstShotResult} from ${firstShotDistance} yards, hitting the ${hitLocation.toLowerCase()}.`;
        
        if (trailingDistance > 0) {
            simpleReportContent += ` The buck ran, and I trailed it for ${trailingDistance} yards before taking the final shot from ${finalShotDistance} yards.`;
        }
        
        simpleReportContent += ` Total shots taken: ${totalShots}. ${huntData.message || 'A clean and ethical hunt'}.`;
    } else if (gameContext.huntLog && gameContext.huntLog.firstShotResult && gameContext.huntLog.firstShotResult.includes('Wounded')) {
        const huntData = gameContext.huntLog;
        const trailingDistance = Math.round(huntData.distanceTrailed * 1.09361);
        const firstShotDistance = huntData.firstShotDistance || huntData.initialSightingDistance || 'Unknown';
        const hitLocation = huntData.hitLocation || 'Unknown';
        const totalShots = huntData.totalShotsTaken || 1;
        
        simpleReportContent = `Travelled ${distanceInMiles} miles. A disappointing day. Wounded a deer with ${huntData.firstShotResult} from ${firstShotDistance} yards, hitting the ${hitLocation.toLowerCase()}. Tracked it for ${trailingDistance} yards but couldn't recover it. Total shots taken: ${totalShots}. A hunter's duty is to be better.`;
    } else {
        simpleReportContent = `Travelled ${distanceInMiles} miles. The forest was quiet today. No deer harvested, but the time spent in nature is never wasted.`;
    }
    
    // Add to report history
    gameContext.reportEntries.unshift({title: `Day ${gameContext.reportEntries.length + 1}`, content: simpleReportContent});
    if (gameContext.reportEntries.length > 5) gameContext.reportEntries.pop();
    
    // Show the enhanced modal
    gameContext.endOfDayContent.innerHTML = reportHTML;
    gameContext.endOfDayModalBackdrop.style.display = 'flex';
    
    // Reset for next day when continue is clicked
    if (gameContext.continueToNextDayButton) {
        gameContext.continueToNextDayButton.onclick = () => {
            gameContext.endOfDayModalBackdrop.style.display = 'none';
            gameContext.distanceTraveled = 0;
            gameContext.dailyKillInfo = null;
            gameContext.huntLog = {};
            showMessage("A new day has dawned. Good luck hunting!", 5000);
        };
    }
}

/**
 * Shows the comprehensive end-of-day report with detailed hunt analysis
 */
function getResultClass(result) {
    if (!result) return '';
    
    if (result.includes('Perfect') || result.includes('Headshot') || result.includes('Recovery')) {
        return 'success';
    } else if (result.includes('Wounded')) {
        return 'error';
    } else {
        return 'warning';
    }
}

/**
 * Checks for collision between a position and trees in the game world.
 * @param {THREE.Vector3} position - The position to check for collision
 * @param {number} radius - The collision radius (default: 1.0)
 * @returns {THREE.Object3D|null} - The colliding tree object or null if no collision
 */
function checkTreeCollision(position, radius = 1.0) {
    // Safety check: ensure trees exist
    if (!gameContext.trees || !gameContext.trees.children) {
        return null;
    }
    
    // Performance optimization: Use spatial partitioning to only check nearby trees
    // Instead of checking all trees, only check trees within a reasonable distance
    const MAX_CHECK_DISTANCE = 50; // Only check trees within 50 units
    const MAX_TREES_TO_CHECK = 20; // Limit to checking at most 20 trees per call
    
    let treesChecked = 0;
    
    // Check collision with nearby trees only
    for (const tree of gameContext.trees.children) {
        // Quick distance check to skip far away trees
        const roughDistance = Math.abs(position.x - tree.position.x) + Math.abs(position.z - tree.position.z);
        if (roughDistance > MAX_CHECK_DISTANCE) {
            continue; // Skip trees that are definitely too far away
        }
        
        // Calculate precise 2D distance (ignore Y axis for collision)
        const distance = new THREE.Vector2(
            position.x - tree.position.x,
            position.z - tree.position.z
        ).length();
        
        // Estimate tree collision radius based on scale
        // Trees typically have a base radius around 1.5-2.0 units when scaled
        const treeRadius = (tree.scale.x || 1.0) * 1.8;
        
        // Check if collision occurs
        if (distance < treeRadius + radius) {
            return tree; // Return the colliding tree
        }
        
        // Limit the number of trees we check per call to prevent performance issues
        treesChecked++;
        if (treesChecked >= MAX_TREES_TO_CHECK) {
            break;
        }
    }
    
    return null; // No collision detected
}

/**
 * Checks for collision between a position and bushes in the game world.
 * @param {THREE.Vector3} position - The position to check for collision
 * @param {number} radius - The collision radius (default: 1.0)
 * @returns {THREE.Object3D|null} - The colliding bush object or null if no collision
 */
function checkBushCollision(position, radius = 1.0) {
    // Safety check: ensure bushes exist
    if (!gameContext.bushes || !gameContext.bushes.children) {
        return null;
    }
    
    // Performance optimization: Use spatial partitioning to only check nearby bushes
    const MAX_CHECK_DISTANCE = 30; // Only check bushes within 30 units (smaller than trees)
    const MAX_BUSHES_TO_CHECK = 15; // Limit to checking at most 15 bushes per call
    
    let bushesChecked = 0;
    
    // Check collision with nearby bushes only
    for (const bush of gameContext.bushes.children) {
        // Quick distance check to skip far away bushes
        const roughDistance = Math.abs(position.x - bush.position.x) + Math.abs(position.z - bush.position.z);
        if (roughDistance > MAX_CHECK_DISTANCE) {
            continue; // Skip bushes that are definitely too far away
        }
        
        bushesChecked++;
        
        // Calculate precise 2D distance (ignore Y axis for collision)
        const distance = new THREE.Vector2(
            position.x - bush.position.x,
            position.z - bush.position.z
        ).length();
        
        // Estimate bush collision radius based on scale
        // Bushes are smaller than trees, typically 0.8-1.2 units when scaled
        const bushRadius = bush.scale.x * 16.0; // Reduced by 20% from 20.0 for more precise detection
        
        // Check if collision occurs
        if (distance < bushRadius + radius) {
            return bush; // Return the colliding bush
        }
        
        // Limit the number of bushes we check per call to prevent performance issues
        bushesChecked++;
        if (bushesChecked >= MAX_BUSHES_TO_CHECK) {
            break;
        }
    }
    
    return null; // No collision detected
}

/**
 * Checks if a position is within foliage (bushes) for sound effects.
 * Uses the visual bushes directly for collision detection.
 * @param {number} x - The x coordinate to check
 * @param {number} z - The z coordinate to check
 * @returns {boolean} - True if position is within foliage
 */
function isFoliageAt(x, z) {
    // Safety check: ensure bushes exist
    if (!gameContext.bushes || !gameContext.bushes.children) {
        return false;
    }
    
    // Check each visual bush for collision
    for (const bush of gameContext.bushes.children) {
        // Calculate 2D distance to bush center
        const distance = Math.sqrt(
            (x - bush.position.x) ** 2 + 
            (z - bush.position.z) ** 2
        );
        
        // Bush collision radius based on its scale (bushes have scale 0.15-0.75)
        // Use a much larger collision radius to create a foliage area around the bush
        const bushRadius = bush.scale.x * 20.0; // Reduced from 30.0 for more precise detection
        
        if (distance <= bushRadius) {
            return true; // Player is inside this bush
        }
    }
    
    return false; // No bush collision detected
}

function startSleepSequence() {
    if (gameContext.isSleeping) return;
    gameContext.isSleeping = true;
    gameContext.sleepOverlay.style.display = 'flex';
    
    setTimeout(() => {
        gameContext.sleepOverlay.style.opacity = 1;
        setTimeout(async () => {
            await handleEndOfDay(); 
            gameContext.gameTime = DAWN_START_HOUR - 0.5;
            // Reset map usage count for new day
            gameContext.mapUsageCount = 0;
            gameContext.sleepOverlay.style.opacity = 0;
            setTimeout(() => {
                gameContext.sleepOverlay.style.display = 'none';
                gameContext.isSleeping = false;
            }, SLEEP_FADE_OUT_DURATION_MS);
        }, SLEEP_SEQUENCE_MAIN_DURATION_MS);
    }, SLEEP_SEQUENCE_DELAY_MS);
}

function updateDayNightCycle() {
    if (gameContext.isSleeping) return;
    const delta = gameContext.clock.getDelta();
    gameContext.deltaTime = delta; // Store delta time for other modules
    gameContext.gameTime += delta * GAME_TIME_SPEED_MULTIPLIER;
    if (gameContext.gameTime >= HOURS_IN_DAY) {
        gameContext.gameTime = 0;
        startSleepSequence(); 
    }
    gameContext.timeSinceLastDrink += delta;

    // Update time display in HUD
    updateTimeDisplay();

    // Update dynamic lighting based on time of day
    updateDynamicLighting();
}

function animate() {
    requestAnimationFrame(animate);
    
    // Track player movement for report
    const previousPosition = gameContext.player.position.clone();
    
    updateDayNightCycle();
    updateShadowCamera();
    updatePlayer();
    
    // Calculate distance traveled this frame
    const currentPosition = gameContext.player.position.clone();
    const frameDistance = previousPosition.distanceTo(currentPosition);
    if (frameDistance > 0.01) { // Only track significant movement
        updateDistanceTraveled(frameDistance);
    }
    
    gameContext.deer.update(gameContext.deltaTime);
    
    // Check for deer sighting (player looking at deer within reasonable distance)
    const deerDistance = gameContext.player.position.distanceTo(gameContext.deer.model.position);
    if (deerDistance < 200 && !gameContext.deerSighted) { // Within 200 units and not already logged
        // Check if player is roughly looking at the deer
        const directionToDeer = new THREE.Vector3().subVectors(gameContext.deer.model.position, gameContext.player.position).normalize();
        const playerDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(gameContext.camera.quaternion);
        const angle = directionToDeer.angleTo(playerDirection);
        
        if (angle < Math.PI / 3) { // Within 60 degree cone
            const distanceYards = Math.round(deerDistance * 1.09361);
            logEvent("Deer Sighted", `Deer was jumped ${distanceYards} yards away`, {
                distance: distanceYards,
                playerPosition: gameContext.player.position.clone(),
                deerPosition: gameContext.deer.model.position.clone()
            });
            gameContext.deerSighted = true;
            
            // Reset sighting flag after some time
            setTimeout(() => {
                gameContext.deerSighted = false;
            }, 30000); // 30 seconds before can log another sighting
        }
    }
    
    updateInteraction();
    updateCompass();
    updateSpatialAudioListener();
    updateAmbianceForTime(gameContext.gameTime);
    
    if(gameContext.renderer) gameContext.renderer.render(gameContext.scene, gameContext.camera);
}

async function init(worldConfig) {
    gameContext.worldConfig = worldConfig;
    
    // Reset shot log for new hunting session
    gameContext.shotLog = [];
    
    setupScene();
    createHills(worldConfig);
    createWater(worldConfig);
    findDrinkingSpots();
    await createTrees(worldConfig);
    await createBushes(worldConfig);
    await createGrass(worldConfig); // Add grass patches for ground cover
    
    // Initialize deer after world is created
    createPlayer();
    initAudio();
    
    // Update time display immediately to show correct starting time
    updateTimeDisplay();
    
    // Delay deer respawn to ensure audio system is ready for deer blow sound
    setTimeout(() => {
        gameContext.deer.respawn();
        
        // Set initial deer state based on UI selection
        if (gameContext.deerBehaviorMode) {
            gameContext.deer.setState(gameContext.deerBehaviorMode);
        }
    }, 1000); // 1 second delay to allow audio system to initialize

    addPlayerEventListeners();
    document.addEventListener('contextmenu', (event) => event.preventDefault());
    showMessage("Welcome to Fairchase! Use WASD to move, Mouse to look, R to scope, Click to shoot.", 5000);
    initializeDayReport();
}

// --- GAME ENTRY POINT ---
document.addEventListener('DOMContentLoaded', async () => {
    // Make gameContext globally accessible for debugging
    window.gameContext = gameContext;
    
    // Populate UI Elements in Context
    gameContext.timeValueElement = document.getElementById('clock-value');
    gameContext.scoreValueElement = document.getElementById('score-value');
    gameContext.compassElement = document.getElementById('compass-value');
    gameContext.interactionPromptElement = document.getElementById('interaction-prompt');
    gameContext.messageElement = document.getElementById('message');
    gameContext.sleepOverlay = document.getElementById('sleep-overlay');
    gameContext.sleepTimerElement = document.getElementById('sleep-timer');
    gameContext.mainMenu = document.getElementById('main-menu');
    gameContext.worldSelect = document.getElementById('world-select');
    gameContext.startGameButton = document.getElementById('start-button');
    gameContext.scopeOverlayElement = document.getElementById('scope-overlay');
    gameContext.crosshairElement = document.getElementById('crosshair');
    gameContext.reportModalBackdrop = document.getElementById('report-modal-backdrop');
    gameContext.reportModal = document.getElementById('report-modal');
    gameContext.reportTitle = document.getElementById('report-title');
    gameContext.reportContent = document.getElementById('report-content');
    gameContext.closeReportButton = document.getElementById('close-report-button');
    gameContext.journalButton = document.getElementById('journal-button');
    gameContext.mapButton = document.getElementById('map-button');
    gameContext.mapModalBackdrop = document.getElementById('map-modal-backdrop');
    gameContext.mapModal = document.getElementById('map-modal');
    gameContext.closeMapButton = document.getElementById('close-map-button');
    gameContext.endOfDayModalBackdrop = document.getElementById('end-of-day-modal-backdrop');
    gameContext.endOfDayModal = document.getElementById('end-of-day-modal');
    gameContext.endOfDayTitle = document.getElementById('end-of-day-title');
    gameContext.endOfDayContent = document.getElementById('end-of-day-content');
    gameContext.continueToNextDayButton = document.getElementById('continue-to-next-day-button');
    gameContext.mapCanvas = document.getElementById('map-canvas');

    // Assign core functions to the context
    gameContext.init = init;
    gameContext.animate = animate;
    gameContext.getHeightAt = getHeightAt;
    gameContext.shoot = shoot;
    gameContext.tagDeer = tagDeer;
    gameContext.startSleepSequence = startSleepSequence;
    gameContext.isNight = isNight;
    gameContext.handleEndOfDay = handleEndOfDay;
    gameContext.checkTreeCollision = checkTreeCollision;
    gameContext.checkBushCollision = checkBushCollision;
    gameContext.isWaterAt = isWaterAt; // Added isWaterAt binding
    gameContext.isFoliageAt = isFoliageAt;

    // Initialize the UI, which will set up the main menu and its listeners
    // await initTitleMusic();
    await initUI();
});

function generateHuntEthicsAnalysis(shotLog, huntData) {
    let analysis = '';
    
    // Calculate shot statistics
    const totalShots = shotLog.length;
    const cleanKills = shotLog.filter(shot => shot.hitType === 'vital' || shot.hitType === 'brain').length;
    const wounds = shotLog.filter(shot => shot.hitType === 'wound').length;
    const misses = shotLog.filter(shot => shot.hitType === 'miss').length;
    const movingShots = shotLog.filter(shot => shot.deerMoving).length;
    const standingShots = totalShots - movingShots;
    
    // Calculate percentages
    const cleanKillRate = Math.round((cleanKills / totalShots) * 100);
    const woundRate = Math.round((wounds / totalShots) * 100);
    const missRate = Math.round((misses / totalShots) * 100);
    const movingShotRate = Math.round((movingShots / totalShots) * 100);
    
    // Shot placement analysis
    analysis += `<div class="stat-line"><span class="highlight">Shot Placement Analysis:</span></div>`;
    analysis += `<div class="stat-line">• Clean Kills (Vital/Brain): ${cleanKills} shots (${cleanKillRate}%)</div>`;
    analysis += `<div class="stat-line">• Wounding Shots: ${wounds} shots (${woundRate}%)</div>`;
    analysis += `<div class="stat-line">• Missed Shots: ${misses} shots (${missRate}%)</div>`;
    
    // Deer movement analysis
    analysis += `<div class="stat-line"><span class="highlight">Deer Movement Analysis:</span></div>`;
    analysis += `<div class="stat-line">• Shots on Standing Deer: ${standingShots} shots</div>`;
    analysis += `<div class="stat-line">• Shots on Moving Deer: ${movingShots} shots (${movingShotRate}%)</div>`;
    
    // Ethical hunting assessment
    analysis += `<div class="stat-line"><span class="highlight">Ethical Assessment:</span></div>`;
    
    // Overall performance rating
    let performanceRating = '';
    let ethicalConcerns = [];
    
    if (totalShots === 1 && cleanKills === 1) {
        performanceRating = '<span class="success">Excellent - One shot, clean kill</span>';
    } else if (cleanKillRate >= 80 && woundRate <= 20) {
        performanceRating = '<span class="success">Good - High clean kill rate</span>';
    } else if (cleanKillRate >= 50 && woundRate <= 40) {
        performanceRating = '<span class="warning">Fair - Room for improvement</span>';
    } else {
        performanceRating = '<span class="error">Poor - Significant improvement needed</span>';
    }
    
    analysis += `<div class="stat-line">• Overall Performance: ${performanceRating}</div>`;
    
    // Specific ethical concerns and recommendations
    if (wounds > 1) {
        ethicalConcerns.push('Multiple wounding shots indicate poor shot placement');
        analysis += `<div class="stat-line"><span class="error">⚠ Concern: ${wounds} wounding shots suggest inadequate shot placement or range estimation</span></div>`;
    }
    
    if (totalShots > 3) {
        ethicalConcerns.push('Excessive number of shots taken');
        analysis += `<div class="stat-line"><span class="error">⚠ Concern: ${totalShots} shots taken - ethical hunting requires quick, clean kills</span></div>`;
    }
    
    if (movingShotRate > 50) {
        ethicalConcerns.push('Too many shots taken on moving deer');
        analysis += `<div class="stat-line"><span class="warning">⚠ Concern: ${movingShotRate}% of shots on moving deer - wait for standing shots when possible</span></div>`;
    }
    
    if (wounds > 0 && cleanKills === 0) {
        analysis += `<div class="stat-line"><span class="error">⚠ Critical: Wounded deer without clean kill - improve tracking and recovery shot placement</span></div>`;
    }
    
    // Positive feedback
    if (cleanKills > 0) {
        analysis += `<div class="stat-line"><span class="success">✓ Good: ${cleanKills} clean kill shot(s) demonstrate proper shot placement</span></div>`;
    }
    
    if (standingShots > movingShots) {
        analysis += `<div class="stat-line"><span class="success">✓ Good: Majority of shots taken on standing deer shows patience and ethics</span></div>`;
    }
    
    // Recommendations
    analysis += `<div class="stat-line"><span class="highlight">Recommendations:</span></div>`;
    
    if (woundRate > 20) {
        analysis += `<div class="stat-line">• Practice shot placement on vital zones to reduce wounding</div>`;
    }
    
    if (movingShotRate > 30) {
        analysis += `<div class="stat-line">• Wait for deer to stop before taking shots for better accuracy</div>`;
    }
    
    if (totalShots > 2) {
        analysis += `<div class="stat-line">• Consider closer approach or better rest position for first shot success</div>`;
    }
    
    if (ethicalConcerns.length === 0 && totalShots === 1 && cleanKills === 1) {
        analysis += `<div class="stat-line"><span class="success">• Exemplary hunting - maintain this standard of ethics and marksmanship</span></div>`;
    }
    
    return analysis;
}

/**
 * Interpolates between two hex colors
 * @param {number} color1 - First color as hex number
 * @param {number} color2 - Second color as hex number  
 * @param {number} factor - Interpolation factor (0-1)
 * @returns {number} Interpolated color as hex number
 */
function interpolateColor(color1, color2, factor) {
    const c1 = new THREE.Color(color1);
    const c2 = new THREE.Color(color2);
    return c1.lerp(c2, factor).getHex();
}

/**
 * Adjusts color saturation and luminosity
 * @param {number} hexColor - Original hex color
 * @param {number} saturationFactor - Multiplier for saturation (0.5 = 50% saturation)
 * @param {number} luminosityFactor - Multiplier for luminosity (1.2 = 20% brighter)
 * @returns {number} Adjusted hex color
 */
function adjustColorSaturationAndLuminosity(hexColor, saturationFactor, luminosityFactor) {
    const color = new THREE.Color(hexColor);
    
    // Convert to HSL
    const hsl = {};
    color.getHSL(hsl);
    
    // Adjust saturation and luminosity
    hsl.s *= saturationFactor;
    hsl.l *= luminosityFactor;
    
    // Clamp values
    hsl.s = Math.min(1, Math.max(0, hsl.s));
    hsl.l = Math.min(1, Math.max(0, hsl.l));
    
    // Convert back to RGB and return hex
    color.setHSL(hsl.h, hsl.s, hsl.l);
    return color.getHex();
}

function updateTimeDisplay() {
    if (gameContext.timeValueElement) {
        const hours = Math.floor(gameContext.gameTime);
        const minutes = Math.floor((gameContext.gameTime - hours) * 60);
        const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        gameContext.timeValueElement.textContent = timeString;
    }
}

function updateDynamicLighting() {
    if (!gameContext.scene || !gameContext.scene.sun || !gameContext.scene.ambientLight) return;
    
    const timeOfDay = gameContext.gameTime; // 0-24 hours
    const sun = gameContext.scene.sun;
    const ambientLight = gameContext.scene.ambientLight;
    
    // Calculate sun position (arc across the sky)
    const sunAngle = ((timeOfDay - 6) / 12) * Math.PI; // 6 AM to 6 PM arc
    const sunHeight = Math.sin(sunAngle);
    const sunX = Math.cos(sunAngle) * 300;
    const sunY = Math.max(10, sunHeight * 200 + 50); // Keep sun above horizon
    const sunZ = 100;
    
    sun.position.set(sunX, sunY, sunZ);
    
    // Define lighting phases throughout the day
    let sunColor, ambientColor, skyColor, sunIntensity, ambientIntensity;
    
    if (timeOfDay >= 4.5 && timeOfDay < 7) {
        // Sunrise (4:30-7:00 AM) - Gradual transition from night to morning
        const progress = (timeOfDay - 4.5) / 2.5; // 2.5 hour duration
        // From night colors to sunrise/golden hour start colors
        sunColor = interpolateColor(0x0f0f23, 0xff6b35, progress); // Very dark blue to orange
        ambientColor = interpolateColor(0x0a0a1a, 0x8b4513, progress); // Nearly black to warm brown
        skyColor = adjustColorSaturationAndLuminosity(
            interpolateColor(0x0f0f23, 0xff8c69, progress), 0.5, 1.2 // Dark blue to salmon
        );
        sunIntensity = 0.1 + progress * 0.7; // 0.1 to 0.8
        ambientIntensity = 0.1 + progress * 0.4; // 0.1 to 0.5
        
    } else if (timeOfDay >= 7 && timeOfDay < 10) {
        // Early Morning (7-10 AM) - golden hour
        const progress = (timeOfDay - 7) / 3;
        sunColor = interpolateColor(0xff6b35, 0xffd700, progress); // Orange to gold
        ambientColor = interpolateColor(0x8b4513, 0xdaa520, progress); // Brown to goldenrod
        skyColor = adjustColorSaturationAndLuminosity(
            interpolateColor(0xff8c69, 0x87ceeb, progress), 0.5, 1.2
        ); // Salmon to sky blue with reduced saturation and increased luminosity
        sunIntensity = 0.8 + progress * 0.2; // 0.8 to 1.0
        ambientIntensity = 0.5 + progress * 0.2; // 0.5 to 0.7
        
    } else if (timeOfDay >= 10 && timeOfDay < 15) {
        // Midday (10 AM - 3 PM) - bright white/blue light
        const progress = (timeOfDay - 10) / 5;
        sunColor = interpolateColor(0xffd700, 0xffffff, progress); // Gold to white
        ambientColor = interpolateColor(0xdaa520, 0xf0f8ff, progress); // Goldenrod to alice blue
        skyColor = adjustColorSaturationAndLuminosity(
            interpolateColor(0x87ceeb, 0x4169e1, progress), 0.5, 1.2
        ); // Sky blue to royal blue with reduced saturation and increased luminosity
        sunIntensity = 1.0; // Peak brightness
        ambientIntensity = 0.7; // Peak ambient
        
    } else if (timeOfDay >= 15 && timeOfDay < 17) {
        // Late Afternoon (3-5 PM) - warm white to golden
        const progress = (timeOfDay - 15) / 2;
        sunColor = interpolateColor(0xffffff, 0xffd700, progress); // White to gold
        ambientColor = interpolateColor(0xf0f8ff, 0xdaa520, progress); // Alice blue to goldenrod
        skyColor = adjustColorSaturationAndLuminosity(
            interpolateColor(0x4169e1, 0xff8c69, progress), 0.5, 1.2
        ); // Royal blue to salmon with reduced saturation and increased luminosity
        sunIntensity = 1.0 - progress * 0.1; // 1.0 to 0.9
        ambientIntensity = 0.7 - progress * 0.1; // 0.7 to 0.6
        
    } else if (timeOfDay >= 17 && timeOfDay < 19) {
        // Sunset (5-7 PM) - golden to orange/red
        const progress = (timeOfDay - 17) / 2;
        sunColor = interpolateColor(0xffd700, 0xff4500, progress); // Gold to orange red
        ambientColor = interpolateColor(0xdaa520, 0x8b0000, progress); // Goldenrod to dark red
        skyColor = adjustColorSaturationAndLuminosity(
            interpolateColor(0xff8c69, 0xff6347, progress), 0.5, 1.2
        ); // Salmon to tomato with reduced saturation and increased luminosity
        sunIntensity = 0.9 - progress * 0.4; // 0.9 to 0.5
        ambientIntensity = 0.6 - progress * 0.2; // 0.6 to 0.4
        
    } else if (timeOfDay >= 19 && timeOfDay < 21) {
        // Dusk (7-9 PM) - deep orange to purple
        const progress = (timeOfDay - 19) / 2;
        sunColor = interpolateColor(0xff4500, 0x800080, progress); // Orange red to purple
        ambientColor = interpolateColor(0x8b0000, 0x483d8b, progress); // Dark red to dark slate blue
        skyColor = adjustColorSaturationAndLuminosity(
            interpolateColor(0xff6347, 0x4b0082, progress), 0.5, 1.2
        ); // Tomato to indigo with reduced saturation and increased luminosity
        sunIntensity = 0.5 - progress * 0.3; // 0.5 to 0.2
        ambientIntensity = 0.4 - progress * 0.2; // 0.4 to 0.2
        
    } else {
        // Night (9 PM - 4:30 AM) - deep blue/purple tones
        let progress = 0;
        if (timeOfDay >= 21) {
            // Late night (9 PM - midnight)
            progress = (timeOfDay - 21) / 3; // 0 to 1 over 3 hours
        } else if (timeOfDay < 4.5) {
            // Early morning night (midnight - 4:30 AM)
            progress = 1 - (timeOfDay / 4.5); // 1 to 0 over 4.5 hours
        }
        
        sunColor = 0x0f0f23; // Very dark blue
        ambientColor = 0x0a0a1a; // Nearly black
        skyColor = adjustColorSaturationAndLuminosity(
            interpolateColor(0x191970, 0x0f0f23, progress), 0.5, 1.2
        ); // Midnight blue to very dark blue
        sunIntensity = 0.1; // Minimal light
        ambientIntensity = 0.1; // Minimal ambient
    }
    
    // Apply the calculated lighting
    sun.color.setHex(sunColor);
    sun.intensity = sunIntensity;
    
    ambientLight.color.setHex(ambientColor);
    ambientLight.intensity = ambientIntensity;
    
    // Update sky and fog color
    gameContext.scene.background.setHex(skyColor);
    if (gameContext.scene.fog) {
        gameContext.scene.fog.color.setHex(skyColor);
        // Adjust fog density based on time for smooth transitions
        let fogFactor = 1.0;
        // Morning fog (4:00 AM to 8:00 AM)
        if (timeOfDay >= 4.0 && timeOfDay < 4.5) { // Fade in (4:00 -> 4:30)
            const progress = (timeOfDay - 4.0) / 0.5;
            fogFactor = 1.0 + progress * 0.5;
        } else if (timeOfDay >= 4.5 && timeOfDay < 7.5) { // Peak fog (4:30 -> 7:30)
            fogFactor = 1.5;
        } else if (timeOfDay >= 7.5 && timeOfDay < 8.0) { // Fade out (7:30 -> 8:00)
            const progress = (timeOfDay - 7.5) / 0.5;
            fogFactor = 1.5 - progress * 0.5;
        }
        // Evening fog (5:00 PM to 8:00 PM)
        else if (timeOfDay >= 17.0 && timeOfDay < 17.5) { // Fade in (17:00 -> 17:30)
            const progress = (timeOfDay - 17.0) / 0.5;
            fogFactor = 1.0 + progress * 0.5;
        } else if (timeOfDay >= 17.5 && timeOfDay < 19.5) { // Peak fog (17:30 -> 19:30)
            fogFactor = 1.5;
        } else if (timeOfDay >= 19.5 && timeOfDay < 20.0) { // Fade out (19:30 -> 20:00)
            const progress = (timeOfDay - 19.5) / 0.5;
            fogFactor = 1.5 - progress * 0.5;
        }

        gameContext.scene.fog.near = 50 * fogFactor;
        gameContext.scene.fog.far = 200 * fogFactor;
    }
}
