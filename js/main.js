import * as THREE from 'three';
import { setupScene } from './scene.js';
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
                    distanceTrailed: 0,
                    recoveryShotDistance: null
                };
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
                    const penalty = distanceFactor * (baseScore * 0.75);
                    shotScore = Math.round(baseScore - penalty);

                    if (distance < 100) {
                        shotScore += (100 - Math.round(distance * 1.09361));
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
        gameContext.score -= 50;
        gameContext.scoreValueElement.textContent = gameContext.score;
        showMessage("Missed! -50 Points");
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
    deer.respawn();
}

async function handleEndOfDay() {
    const distanceInMiles = (gameContext.distanceTraveled * 0.000621371).toFixed(2);
    let journalContent = "The quiet of the woods was its own reward."; // Default message

    if (gameContext.dailyKillInfo) {
        journalContent = `Travelled ${distanceInMiles} miles. A successful day. Sighted the buck at ${gameContext.dailyKillInfo.initialSightingDistance} yards. First shot was ${gameContext.dailyKillInfo.firstShotResult}. It ran, and I trailed it for ${Math.round(gameContext.dailyKillInfo.distanceTrailed * 1.09361)} yards before taking the final shot, a ${gameContext.dailyKillInfo.message}, from ${gameContext.dailyKillInfo.recoveryShotDistance || gameContext.dailyKillInfo.initialSightingDistance} yards. A clean and ethical hunt.`;
    } else if (gameContext.huntLog && gameContext.huntLog.firstShotResult === 'Wounded') {
        journalContent = `Travelled ${distanceInMiles} miles. A disappointing day. Wounded a deer but couldn't recover it after tracking it for ${Math.round(gameContext.huntLog.distanceTrailed * 1.09361)} yards. A hunter's duty is to be better.`;
    } else {
        journalContent = `Travelled ${distanceInMiles} miles. The forest was quiet today. No deer harvested, but the time spent in nature is never wasted.`;
    }

    gameContext.journalEntries.unshift({title: `Day ${gameContext.journalEntries.length + 1}`, content: journalContent});
    if (gameContext.journalEntries.length > 5) gameContext.journalEntries.pop(); 
    
    showMessage("A new day has dawned. Check your journal.", 5000);
    gameContext.distanceTraveled = 0;
    gameContext.dailyKillInfo = null;
    gameContext.huntLog = {};
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

    // Update scene lighting based on time
    if (gameContext.scene && gameContext.scene.sun) {
        const angle = (gameContext.gameTime / HOURS_IN_DAY) * 2 * Math.PI - Math.PI / 2;
        gameContext.scene.sun.position.set(Math.cos(angle) * 500, Math.sin(angle) * 500, 0);
        gameContext.scene.sun.intensity = Math.max(0, Math.sin(angle) + 0.5);
        gameContext.scene.ambientLight.intensity = Math.max(0.2, Math.sin(angle) + 0.3);
    }
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
    updatePlayer();
    deer.update(gameContext.deltaTime);
    updateInteraction();
    updateCompass();
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
    gameContext.reportTitle = document.getElementById('report-title');
    gameContext.reportContent = document.getElementById('report-content');
    gameContext.closeReportButton = document.getElementById('close-report-button');
    gameContext.journalButton = document.getElementById('journal-button');
    gameContext.mapButton = document.getElementById('map-button');
    gameContext.mapModalBackdrop = document.getElementById('map-modal-backdrop');
    gameContext.closeMapButton = document.getElementById('close-map-button');
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
