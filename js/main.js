import * as THREE from 'three';
import { setupScene, updateShadowCamera } from './scene.js';
import { createHills, createWater, findDrinkingSpots, createTrees, createBushes } from './world.js';
import { createPlayer, addPlayerEventListeners, updatePlayer } from './player.js';
import { deer } from './deer.js';
import { initUI, showMessage, updateInteraction, updateCompass } from './ui.js';
import { initAudio, playRifleSound } from './audio.js';
import { gameContext } from './context.js'; 
import {
    GAME_TIME_SPEED_MULTIPLIER,
    HOURS_IN_DAY,
    NIGHT_START_HOUR,
    DAWN_START_HOUR,
    SLEEP_SEQUENCE_DELAY_MS,
    SLEEP_SEQUENCE_MAIN_DURATION_MS,
    SLEEP_FADE_OUT_DURATION_MS
} from './constants.js';
import { updateSpatialAudioListener } from './spatial-audio.js';

// --- CORE FUNCTIONS (No longer need context passed) ---

function isNight() {
    const currentTime = gameContext.gameTime;
    return currentTime < DAWN_START_HOUR || currentTime > NIGHT_START_HOUR;
}

function getHeightAt(x, z) {
    if (!gameContext.terrain) return 0;
    gameContext.raycaster.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
    const intersects = gameContext.raycaster.intersectObject(gameContext.terrain);
    return intersects.length > 0 ? intersects[0].point.y : 0;
}

function shoot() {
    if (gameContext.isSleeping) return;
    playRifleSound();

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

    // Temporarily make the vitals hitbox visible for the raycaster to detect it.
    const vitalsBox = gameContext.deer.model.vitals;
    if (vitalsBox) {
        vitalsBox.visible = true;
    }

    gameContext.raycaster.setFromCamera({ x: 0, y: 0 }, gameContext.camera);
    const intersects = gameContext.raycaster.intersectObject(gameContext.deer.model, true);

    // Hide the vitals hitbox again immediately.
    if (vitalsBox) {
        vitalsBox.visible = false;
    }

    if (intersects.length > 0) {
        let hitName = null;
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
            
            // Mark deer as actually hit to prevent erratic state cycling
            gameContext.deer.wasActuallyHit = true;
            
            // Create blood indicator at the hit location
            if (hitPosition) {
                gameContext.deer.createShotBloodIndicator(hitPosition);
            }
            
            const distance = gameContext.player.position.distanceTo(gameContext.deer.model.position);
            const wasMoving = deer.state === 'FLEEING' || deer.state === 'WOUNDED' || deer.state === 'WANDERING';
            
            if (!gameContext.huntLog) { 
                gameContext.huntLog = {
                    initialSightingDistance: Math.round(distance * 1.09361),
                    firstShotResult: '',
                    firstShotDistance: Math.round(distance * 1.09361),
                    hitLocation: '',
                    distanceTrailed: 0,
                    recoveryShotDistance: null,
                    totalShotsTaken: 0,
                    deerInitialPosition: gameContext.deer.model.position.clone()
                };
            }

            // Increment shot count and record hit location
            gameContext.huntLog.totalShotsTaken++;
            
            // Record hit location for journal
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
            
            if (hitName === 'vitals' || hitName === 'head') {
                let isLethalShot = true;
                if (hitName === 'vitals') {
                    // Calculate the angle between player and deer to determine shot direction
                    const playerPos = gameContext.player.position;
                    const deerPos = gameContext.deer.model.position;
                    const deerRotation = gameContext.deer.model.rotation.y;
                    
                    // Vector from deer to player
                    const toPlayer = new THREE.Vector3()
                        .subVectors(playerPos, deerPos)
                        .normalize();
                    
                    // Deer's forward direction (accounting for the 90-degree rotation)
                    const deerForward = new THREE.Vector3(0, 0, -1)
                        .applyAxisAngle(new THREE.Vector3(0, 1, 0), deerRotation);
                    
                    // Calculate the angle between deer's forward direction and direction to player
                    const dotProduct = deerForward.dot(toPlayer);
                    const angle = Math.acos(Math.max(-1, Math.min(1, dotProduct)));
                    const angleInDegrees = angle * (180 / Math.PI);
                    
                    // If angle is greater than 135 degrees, the shot is from behind (not lethal for vitals)
                    if (angleInDegrees > 135) {
                        isLethalShot = false;
                    } else {
                    }
                }
                
                if (isLethalShot) {
                    let shotScore;
                    let shotMessage;
                    let baseScore;

                    if (deer.state === 'WOUNDED') {
                        baseScore = 20; 
                        shotMessage = "Recovery Shot";
                        gameContext.huntLog.recoveryShotDistance = Math.round(distance * 1.09361);
                    } else {
                        baseScore = (hitName === 'vitals') ? 100 : 25;
                        shotMessage = (hitName === 'vitals') ? "Perfect Shot!" : "Headshot!";
                        gameContext.huntLog.firstShotResult = shotMessage;
                    }
                    
                    const maxPenaltyDistance = 250;
                    const distanceFactor = Math.min(distance, maxPenaltyDistance) / maxPenaltyDistance;
                    const penalty = distanceFactor * (baseScore * 0.5); 
                    shotScore = Math.round(baseScore - penalty);

                    const distanceInYards = Math.round(distance * 1.09361);
                    if (distanceInYards < 100) {
                        shotScore += (100 - distanceInYards);
                    }

                    if (wasMoving) {
                        shotScore -= 50;
                        shotMessage += " (Moving)";
                    }

                    gameContext.killInfo = { 
                        score: shotScore, 
                        message: shotMessage, 
                        wasMoving: wasMoving,
                        shotCount: (deer.state === 'WOUNDED') ? 2 : 1,
                        distance: Math.round(distance * 1.09361)
                    };
                    deer.setState('KILLED');
                } else {
                    // Vital shot from behind - treat as body shot (wound but don't kill)
                    if (deer.state !== 'WOUNDED') {
                        deer.woundCount++;
                        gameContext.score -= 25;
                        gameContext.scoreValueElement.textContent = gameContext.score;
                        deer.setState('WOUNDED');
                        gameContext.huntLog.firstShotResult = 'Wounded (Rear Shot)';
                        showMessage(`Wounded from behind! -25 Points (${deer.woundCount}/3)`);
                        
                        // Check if 3 wounds = kill
                        if (deer.woundCount >= 3) {
                            gameContext.killInfo = { 
                                score: 10, // Low score for 3-wound kill
                                message: "3-Wound Kill", 
                                wasMoving: wasMoving,
                                shotCount: deer.woundCount,
                                distance: Math.round(distance * 1.09361)
                            };
                            deer.setState('KILLED');
                        }
                    } else {
                        // Already wounded, increment wound count
                        deer.woundCount++;
                        showMessage(`Additional wound! (${deer.woundCount}/3)`);
                        
                        // Check if 3 wounds = kill
                        if (deer.woundCount >= 3) {
                            gameContext.killInfo = { 
                                score: 10, // Low score for 3-wound kill
                                message: "3-Wound Kill", 
                                wasMoving: wasMoving,
                                shotCount: deer.woundCount,
                                distance: Math.round(distance * 1.09361)
                            };
                            deer.setState('KILLED');
                        }
                    }
                }
            } else if (hitName === 'body') {
                if (deer.state !== 'WOUNDED') {
                    deer.woundCount++;
                    gameContext.score -= 25;
                    gameContext.scoreValueElement.textContent = gameContext.score;
                    deer.setState('WOUNDED');
                    gameContext.huntLog.firstShotResult = 'Wounded';
                    showMessage(`Wounded! -25 Points (${deer.woundCount}/3)`);
                    
                    // Check if 3 wounds = kill
                    if (deer.woundCount >= 3) {
                        gameContext.killInfo = { 
                            score: 10, // Low score for 3-wound kill
                            message: "3-Wound Kill", 
                            wasMoving: wasMoving,
                            shotCount: deer.woundCount,
                            distance: Math.round(distance * 1.09361)
                        };
                        deer.setState('KILLED');
                    }
                } else {
                    // Already wounded, increment wound count
                    deer.woundCount++;
                    showMessage(`Additional wound! (${deer.woundCount}/3)`);
                    
                    // Check if 3 wounds = kill
                    if (deer.woundCount >= 3) {
                        gameContext.killInfo = { 
                            score: 10, // Low score for 3-wound kill
                            message: "3-Wound Kill", 
                            wasMoving: wasMoving,
                            shotCount: deer.woundCount,
                            distance: Math.round(distance * 1.09361)
                        };
                        deer.setState('KILLED');
                    }
                }
            }
        } else {
            // Hit a non-critical or unnamed part
            if (deer.state !== 'WOUNDED') deer.setState('FLEEING');
        }
    } else {
        // Handle a clean miss
        gameContext.score -= 20; // Changed from -50 to -20
        gameContext.scoreValueElement.textContent = gameContext.score;
        showMessage("Missed! -20 Points");
        if (deer.state !== 'WOUNDED' && deer.state !== 'FLEEING') {
            deer.setState('FLEEING');
        }
    }
}

function tagDeer() {
    if (deer.state !== 'KILLED' || !gameContext.canTag || !gameContext.killInfo) return;

    const shotScore = gameContext.killInfo.score;
    const tagBonus = 25;
    gameContext.score += shotScore + tagBonus;
    gameContext.scoreValueElement.textContent = gameContext.score;
    const shotScoreStr = shotScore >= 0 ? `+${shotScore}` : shotScore;
    const finalMessage = `${gameContext.killInfo.message} (${shotScoreStr}) | Tag Bonus: +${tagBonus}`;
    showMessage(finalMessage);
    
    gameContext.dailyKillInfo = { ...gameContext.huntLog, ...gameContext.killInfo };
    gameContext.huntLog = {}; 
    gameContext.killInfo = null;
    gameContext.canTag = false;
    if(gameContext.interactionPromptElement) gameContext.interactionPromptElement.style.display = 'none';
    
    // Wait 10 seconds before spawning a new deer
    setTimeout(() => {
        deer.respawn();
    }, 10000); // 10 seconds delay
}

async function handleEndOfDay() {
    // Show the enhanced end-of-day journal modal
    showEndOfDayJournal();
}

/**
 * Shows the comprehensive end-of-day journal with detailed hunt analysis
 */
function showEndOfDayJournal() {
    const distanceInMiles = (gameContext.distanceTraveled * 0.000621371).toFixed(2);
    
    // Build comprehensive hunt summary
    let journalHTML = `<h3>Day ${gameContext.journalEntries.length + 1} Summary</h3>`;
    
    // Basic stats
    journalHTML += `<div class="stat-line"><span class="highlight">Distance Traveled:</span> ${distanceInMiles} miles</div>`;
    journalHTML += `<div class="stat-line"><span class="highlight">Time in Field:</span> Full hunting day</div>`;
    
    if (gameContext.dailyKillInfo || (gameContext.huntLog && gameContext.huntLog.totalShotsTaken > 0)) {
        journalHTML += `<h3>Hunt Analysis</h3>`;
        
        const huntData = gameContext.dailyKillInfo || gameContext.huntLog;
        const trailingDistance = Math.round(huntData.distanceTrailed * 1.09361);
        const firstShotDistance = huntData.firstShotDistance || huntData.initialSightingDistance;
        const finalShotDistance = huntData.recoveryShotDistance || firstShotDistance;
        const hitLocation = huntData.hitLocation || 'Unknown';
        const totalShots = huntData.totalShotsTaken || 1;
        
        // Initial sighting
        journalHTML += `<div class="stat-line"><span class="highlight">Initial Sighting:</span> ${huntData.initialSightingDistance} yards</div>`;
        
        // Shot analysis
        journalHTML += `<h3>Shot Analysis</h3>`;
        journalHTML += `<div class="stat-line"><span class="highlight">Total Shots Taken:</span> ${totalShots}</div>`;
        journalHTML += `<div class="stat-line"><span class="highlight">First Shot Distance:</span> ${firstShotDistance} yards</div>`;
        journalHTML += `<div class="stat-line"><span class="highlight">Hit Location:</span> ${hitLocation}</div>`;
        journalHTML += `<div class="stat-line"><span class="highlight">First Shot Result:</span> <span class="${getResultClass(huntData.firstShotResult)}">${huntData.firstShotResult}</span></div>`;
        
        if (finalShotDistance !== firstShotDistance) {
            journalHTML += `<div class="stat-line"><span class="highlight">Final Shot Distance:</span> ${finalShotDistance} yards</div>`;
        }
        
        // Tracking analysis
        if (trailingDistance > 0) {
            journalHTML += `<h3>Tracking Analysis</h3>`;
            journalHTML += `<div class="stat-line"><span class="highlight">Distance Trailed:</span> ${trailingDistance} yards</div>`;
            
            if (trailingDistance > 100) {
                journalHTML += `<div class="stat-line"><span class="warning">⚠ Extended tracking required - consider shot placement improvement</span></div>`;
            } else if (trailingDistance < 50) {
                journalHTML += `<div class="stat-line"><span class="success">✓ Minimal tracking required - excellent shot placement</span></div>`;
            }
        }
        
        // Ethical assessment
        journalHTML += `<h3>Ethical Assessment</h3>`;
        
        if (gameContext.dailyKillInfo) {
            // Successful hunt
            journalHTML += `<div class="stat-line"><span class="success">✓ Clean, ethical harvest completed</span></div>`;
            
            if (totalShots === 1) {
                journalHTML += `<div class="stat-line"><span class="success">✓ One-shot harvest demonstrates excellent marksmanship</span></div>`;
            } else if (totalShots === 2) {
                journalHTML += `<div class="stat-line"><span class="warning">⚠ Two shots required - consider practicing shot placement</span></div>`;
            } else {
                journalHTML += `<div class="stat-line"><span class="error">⚠ Multiple shots required - significant improvement needed</span></div>`;
            }
            
            if (firstShotDistance <= 100) {
                journalHTML += `<div class="stat-line"><span class="success">✓ Appropriate shooting distance maintained</span></div>`;
            } else if (firstShotDistance <= 200) {
                journalHTML += `<div class="stat-line"><span class="warning">⚠ Long-range shot - ensure adequate practice at this distance</span></div>`;
            } else {
                journalHTML += `<div class="stat-line"><span class="error">⚠ Very long-range shot - consider closer approach for ethical hunting</span></div>`;
            }
            
            // Score breakdown if available
            if (gameContext.dailyKillInfo.message) {
                journalHTML += `<h3>Performance</h3>`;
                journalHTML += `<div class="stat-line"><span class="highlight">Result:</span> <span class="success">${gameContext.dailyKillInfo.message}</span></div>`;
            }
            
        } else if (gameContext.huntLog && gameContext.huntLog.firstShotResult && gameContext.huntLog.firstShotResult.includes('Wounded')) {
            // Wounded but not recovered
            journalHTML += `<div class="stat-line"><span class="error">✗ Wounded animal not recovered</span></div>`;
            journalHTML += `<div class="stat-line"><span class="error">✗ Hunter's responsibility to improve shot placement and tracking skills</span></div>`;
            journalHTML += `<div class="stat-line"><span class="warning">⚠ Consider practicing at shorter distances</span></div>`;
            journalHTML += `<div class="stat-line"><span class="warning">⚠ Review proper shot placement techniques</span></div>`;
        }
        
        // Lessons learned
        journalHTML += `<h3>Lessons Learned</h3>`;
        
        if (hitLocation.includes('Vital')) {
            journalHTML += `<div class="stat-line"><span class="success">✓ Excellent shot placement in vital zone</span></div>`;
        } else if (hitLocation.includes('Head')) {
            journalHTML += `<div class="stat-line"><span class="success">✓ Precise headshot demonstrates excellent marksmanship</span></div>`;
        } else if (hitLocation.includes('Body')) {
            journalHTML += `<div class="stat-line"><span class="warning">⚠ Body shot - aim for vital organs for more ethical harvest</span></div>`;
        }
        
        if (trailingDistance > 200) {
            journalHTML += `<div class="stat-line"><span class="warning">⚠ Extensive tracking suggests shot placement improvement needed</span></div>`;
        }
        
    } else {
        // No shots taken
        journalHTML += `<h3>Hunt Analysis</h3>`;
        journalHTML += `<div class="stat-line">No deer encountered or shot opportunities taken</div>`;
        
        journalHTML += `<h3>Reflection</h3>`;
        journalHTML += `<div class="stat-line"><span class="highlight">Time in nature is valuable regardless of harvest</span></div>`;
        journalHTML += `<div class="stat-line">Consider different hunting locations or times</div>`;
        journalHTML += `<div class="stat-line">Patience and persistence are key hunting virtues</div>`;
    }
    
    // Create simple journal entry for the journal history
    let simpleJournalContent = "The quiet of the woods was its own reward.";
    
    if (gameContext.dailyKillInfo) {
        const huntData = gameContext.dailyKillInfo;
        const trailingDistance = Math.round(huntData.distanceTrailed * 1.09361);
        const firstShotDistance = huntData.firstShotDistance || huntData.initialSightingDistance;
        const finalShotDistance = huntData.recoveryShotDistance || firstShotDistance;
        const hitLocation = huntData.hitLocation || 'Unknown';
        const totalShots = huntData.totalShotsTaken || 1;
        
        simpleJournalContent = `Travelled ${distanceInMiles} miles. A successful day. Sighted the buck at ${huntData.initialSightingDistance} yards. First shot was ${huntData.firstShotResult} from ${firstShotDistance} yards, hitting the ${hitLocation.toLowerCase()}.`;
        
        if (trailingDistance > 0) {
            simpleJournalContent += ` The buck ran, and I trailed it for ${trailingDistance} yards before taking the final shot from ${finalShotDistance} yards.`;
        }
        
        simpleJournalContent += ` Total shots taken: ${totalShots}. ${huntData.message || 'A clean and ethical hunt'}.`;
    } else if (gameContext.huntLog && gameContext.huntLog.firstShotResult && gameContext.huntLog.firstShotResult.includes('Wounded')) {
        const huntData = gameContext.huntLog;
        const trailingDistance = Math.round(huntData.distanceTrailed * 1.09361);
        const firstShotDistance = huntData.firstShotDistance || huntData.initialSightingDistance;
        const hitLocation = huntData.hitLocation || 'Unknown';
        const totalShots = huntData.totalShotsTaken || 1;
        
        simpleJournalContent = `Travelled ${distanceInMiles} miles. A disappointing day. Wounded a deer with ${huntData.firstShotResult} from ${firstShotDistance} yards, hitting the ${hitLocation.toLowerCase()}. Tracked it for ${trailingDistance} yards but couldn't recover it. Total shots taken: ${totalShots}. A hunter's duty is to be better.`;
    } else {
        simpleJournalContent = `Travelled ${distanceInMiles} miles. The forest was quiet today. No deer harvested, but the time spent in nature is never wasted.`;
    }
    
    // Add to journal history
    gameContext.journalEntries.unshift({title: `Day ${gameContext.journalEntries.length + 1}`, content: simpleJournalContent});
    if (gameContext.journalEntries.length > 5) gameContext.journalEntries.pop();
    
    // Show the enhanced modal
    gameContext.endOfDayContent.innerHTML = journalHTML;
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
 * Helper function to get CSS class for shot result
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
    
    // Check collision with each tree
    for (const tree of gameContext.trees.children) {
        // Calculate 2D distance (ignore Y axis for collision)
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
    }
    
    return null; // No collision detected
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
    
    if (timeOfDay >= 5 && timeOfDay < 7) {
        // Sunrise (5-7 AM) - warm orange/pink tones
        const progress = (timeOfDay - 5) / 2;
        sunColor = interpolateColor(0x1a1a2e, 0xff6b35, progress); // Dark blue to orange
        ambientColor = interpolateColor(0x16213e, 0x8b4513, progress); // Dark to warm brown
        skyColor = adjustColorSaturationAndLuminosity(
            interpolateColor(0x1a1a2e, 0xff8c69, progress), 0.5, 1.2
        ); // Dark to salmon with reduced saturation and increased luminosity
        sunIntensity = 0.3 + progress * 0.5; // 0.3 to 0.8
        ambientIntensity = 0.2 + progress * 0.3; // 0.2 to 0.5
        
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
        // Night (9 PM - 5 AM) - deep blue/purple tones
        sunColor = 0x191970; // Midnight blue
        ambientColor = 0x191970; // Midnight blue
        skyColor = adjustColorSaturationAndLuminosity(0x191970, 0.5, 1.2); // Midnight blue with reduced saturation and increased luminosity
        sunIntensity = 0.1; // Very dim
        ambientIntensity = 0.15; // Minimal ambient
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
        // Adjust fog density based on time (more fog at dawn/dusk)
        const fogFactor = (timeOfDay >= 5 && timeOfDay <= 8) || (timeOfDay >= 17 && timeOfDay <= 20) ? 1.5 : 1.0;
        gameContext.scene.fog.near = 50 * fogFactor;
        gameContext.scene.fog.far = 200 * fogFactor;
    }
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

function animate() {
    requestAnimationFrame(gameContext.animate);
    updateDayNightCycle();
    updateShadowCamera();
    updatePlayer();
    deer.update(gameContext.deltaTime);
    updateInteraction();
    updateCompass();
    updateSpatialAudioListener();
    if(gameContext.renderer) gameContext.renderer.render(gameContext.scene, gameContext.camera);
}

async function init(worldConfig) {
    gameContext.worldConfig = worldConfig;
    setupScene();
    createHills(worldConfig);
    createWater(worldConfig);
    findDrinkingSpots();
    await createTrees(worldConfig);
    await createBushes(worldConfig);
    createPlayer();
    initAudio();
    deer.respawn();
    addPlayerEventListeners();
    document.addEventListener('contextmenu', (event) => event.preventDefault());
    showMessage("Welcome to Fairchase! Use WASD to move, Mouse to look, R to scope, Click to shoot.", 5000);
}

// --- GAME ENTRY POINT ---
document.addEventListener('DOMContentLoaded', () => {
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

    // Initialize the UI, which will set up the main menu and its listeners
    initUI();
});
