import * as THREE from 'three';
import { gameContext } from './context.js';
import { playRifleSound } from './audio.js';
import { showMessage, showSeasonCompleteModal } from './ui.js';
import { logEvent } from './report-logger.js';
import { collisionSystem } from './collision.js';
import { LEGAL_HUNTING_START_HOUR, LEGAL_HUNTING_END_HOUR } from './constants.js';
import { applyRifleRecoil } from './camera-effects.js';
import { getIsTreeBraced, getIsKneeling } from './player.js';

/**
 * Shows a message only in practice mode (not hunt simulator)
 * Used for hit/miss feedback that should be hidden in simulator mode
 */
function showPracticeModeMessage(message, duration) {
    if (gameContext.gameMode === 'practice') {
        showMessage(message, duration);
    }
}

/**
 * Checks if current time is within legal hunting hours
 */
function isLegalHuntingTime() {
    const currentTime = gameContext.gameTime;
    return currentTime >= LEGAL_HUNTING_START_HOUR && currentTime <= LEGAL_HUNTING_END_HOUR;
}

/**
 * Updates the score display in the UI
 */
function updateScoreDisplay() {
    if (gameContext.scoreValueElement) {
        gameContext.scoreValueElement.textContent = gameContext.score;
    }
}

/**
 * Calculates bonus points based on shot conditions
 * Fair chase hunting rewards patience and skill - getting close to the animal
 */
function calculateBonuses(distance, wasMoving, hitZone, isFirstShot = false, isBraced = false, isKneeling = false, wasRunning = false, wasWalking = false) {
    let bonus = 0;
    let bonusDetails = [];
    
    // Close range bonus: Rewards stalking skill and patience
    // Getting close to a deer without spooking it is the essence of fair chase
    if (distance <= 25) {
        bonus += 25;
        bonusDetails.push('Close Stalk +25');
    } else if (distance <= 50) {
        bonus += 15;
        bonusDetails.push('Good Stalk +15');
    } else if (distance <= 75) {
        bonus += 10;
        bonusDetails.push('Decent Range +10');
    } else if (distance <= 100) {
        bonus += 5;
        bonusDetails.push('Effective Range +5');
    }
    // No bonus for shots over 100 yards - fair chase emphasizes getting close
    
    // Stationary target bonus: Ethical hunters wait for a clean, still shot
    if (!wasMoving) {
        bonus += 10;
        bonusDetails.push('Patient Shot +10');
    } else if (wasRunning) {
        // Running deer penalty: High risk of wounding
        bonus -= 10;
        bonusDetails.push('Running Target -10');
    } else if (wasWalking) {
        // Walking deer penalty: Should wait for deer to stop
        bonus -= 5;
        bonusDetails.push('Walking Target -5');
    }
    
    // First shot kill bonus: Rewards marksmanship, reduces animal suffering
    if (isFirstShot) {
        bonus += 20;
        bonusDetails.push('First Shot Kill +20');
    }
    
    // Braced shot bonus: Demonstrates proper shooting technique (against tree)
    if (isBraced) {
        bonus += 10;
        bonusDetails.push('Braced Shot +10');
    }
    
    // Kneeling shot bonus: Demonstrates proper shooting technique
    if (isKneeling) {
        bonus += 10;
        bonusDetails.push('Kneeling Shot +10');
    }
    
    // Diligent Hunt bonus: Rewards patient stalking over 500+ yards with a vital shot
    // Only awarded for clean kills (vital shots)
    if (hitZone === 'vitals' && gameContext.distanceTraveled >= 500) {
        bonus += 15;
        bonusDetails.push('Diligent Hunt +15');
    }
    
    return { bonus, bonusDetails };
}

/**
 * Processes a kill event, updating score and logs
 */
function processKill(baseScore, baseMessage, wasMoving, shotCount, distance, hitZone = 'body', wasRunning = false, wasWalking = false) {
    // Prevent processing a new kill if one is already pending a tag
    if (gameContext.killInfo) {
        return;
    }

    let finalScore = baseScore;
    let finalMessage = baseMessage;
    let ethical = true;

    // Check for illegal hunting hours
    if (!isLegalHuntingTime()) {
        finalScore = -100; // Penalty for illegal harvest
        finalMessage = "Unethical Harvest (Out of Hours)";
        ethical = false;
    } else {
        // Apply bonuses only for ethical kills
        const isFirstShot = shotCount === 1 && gameContext.huntLog && gameContext.huntLog.totalShotsTaken <= 1;
        // Use stored shot conditions from huntLog (captured at time of shot)
        // Fall back to current state if not available
        const isBraced = gameContext.huntLog?.firstShotBraced ?? getIsTreeBraced();
        const isKneeling = gameContext.huntLog?.firstShotKneeling ?? getIsKneeling();
        const { bonus, bonusDetails } = calculateBonuses(distance, wasMoving, hitZone, isFirstShot, isBraced, isKneeling, wasRunning, wasWalking);
        finalScore += bonus;
        if (bonusDetails.length > 0) {
            finalMessage += ` (${bonusDetails.join(', ')})`;
        }
    }

    gameContext.score += finalScore;
    updateScoreDisplay();
    
    // Record kill time for quick recovery bonus calculation
    gameContext.killTime = Date.now();
    
    // Get bonus details for report breakdown
    const isFirstShot = shotCount === 1 && gameContext.huntLog && gameContext.huntLog.totalShotsTaken <= 1;
    // Use stored shot conditions from huntLog (captured at time of shot)
    const isBracedForInfo = gameContext.huntLog?.firstShotBraced ?? getIsTreeBraced();
    const isKneelingForInfo = gameContext.huntLog?.firstShotKneeling ?? getIsKneeling();
    const { bonusDetails: bonusBreakdown } = calculateBonuses(distance, wasMoving, hitZone, isFirstShot, isBracedForInfo, isKneelingForInfo, wasRunning, wasWalking);
    
    // Determine shooting stance for killInfo
    let stance = 'Offhand';
    if (isBracedForInfo && isKneelingForInfo) {
        stance = 'Sitting & Braced';
    } else if (isBracedForInfo) {
        stance = 'Braced';
    } else if (isKneelingForInfo) {
        stance = 'Sitting';
    }
    
    gameContext.killInfo = { 
        score: finalScore, 
        message: baseMessage, // Store base message without bonuses for tag display
        wasMoving: wasMoving,
        shotCount: shotCount,
        distance: distance,
        ethical: ethical,
        hitZone: hitZone,
        bonusBreakdown: bonusBreakdown, // Store individual bonus details for report
        shootingStance: stance
    };
    
    const scoreText = finalScore >= 0 ? ` +${finalScore}` : ` ${finalScore}`;
    showPracticeModeMessage(`${finalMessage}!${scoreText} Points`);
    
    gameContext.deer.setState('KILLED');
    // Use stored shot conditions for log (already calculated above as isBracedForInfo/isKneelingForInfo)
    const logBraced = isBracedForInfo;
    const logKneeling = isKneelingForInfo;
    
    // Determine shooting stance for report (use stored values)
    let shootingStance = 'Offhand';
    if (logBraced && logKneeling) {
        shootingStance = 'Sitting & Braced';
    } else if (logBraced) {
        shootingStance = 'Braced';
    } else if (logKneeling) {
        shootingStance = 'Sitting';
    }
    
    logEvent("Deer Killed", `${baseMessage} at ${distance} yards (${shootingStance})`, {
        distance: distance,
        moving: wasMoving,
        shotCount: shotCount,
        ethical: ethical,
        braced: logBraced,
        kneeling: logKneeling,
        shootingStance: shootingStance,
        hitZone: hitZone,
        totalScore: finalScore
    });
}

/**
 * Handles the shooting mechanic
 */
export function shoot() {
    if (gameContext.isSleeping || (gameContext.deer && gameContext.deer.state === 'KILLED')) return;

    playRifleSound();
    applyRifleRecoil();
    
    // Penalty for shooting outside legal hunting hours (applies to all shots)
    if (!isLegalHuntingTime()) {
        const afterHoursPenalty = -25;
        gameContext.score += afterHoursPenalty;
        updateScoreDisplay();
        showMessage(`Shooting After Hours! ${afterHoursPenalty} Points`, 2000);
        logEvent("Illegal Shot", "Shot fired outside legal hunting hours", {
            penalty: afterHoursPenalty
        });
        
        // Track penalty for report
        if (!gameContext.badShotPenalties) gameContext.badShotPenalties = [];
        gameContext.badShotPenalties.push({ 
            hitZone: 'after-hours-shot', 
            penalty: Math.abs(afterHoursPenalty),
            description: 'Shot After Hours'
        });
    }

    if (!gameContext.deer || !gameContext.deer.isModelLoaded) {
        showMessage("Deer model not loaded yet", 2000);
        return;
    }

    if (!gameContext.scene.children.includes(gameContext.deer.model)) {
        showMessage("Deer not in scene", 2000);
        return;
    }

    const deerState = gameContext.deer.state;
    const wasMoving = ['FLEEING', 'WOUNDED', 'WANDERING', 'THIRSTY'].includes(deerState);
    const wasRunning = ['FLEEING', 'WOUNDED'].includes(deerState);
    const wasWalking = ['WANDERING', 'THIRSTY'].includes(deerState);
    const shotDistance = gameContext.player.position.distanceTo(gameContext.deer.model.position);
    const shotDistanceYards = Math.round(shotDistance * 1.09361);

    // Capture shooting conditions at time of shot (for bonus calculation)
    // These are stored so bonuses apply correctly even if deer dies later from wound
    const shotIsBraced = getIsTreeBraced();
    const shotIsKneeling = getIsKneeling();
    
    if (!gameContext.huntLog) {
        gameContext.huntLog = {
            initialSightingDistance: shotDistanceYards,
            firstShotResult: '',
            firstShotDistance: shotDistanceYards,
            hitLocation: '',
            distanceTrailed: 0,
            recoveryShotDistance: null,
            totalShotsTaken: 0,
            deerInitialPosition: gameContext.deer.model.position.clone(),
            // Store first shot conditions for bonus calculation
            firstShotBraced: shotIsBraced,
            firstShotKneeling: shotIsKneeling
        };
    }

    gameContext.raycaster.setFromCamera({ x: 0, y: 0 }, gameContext.camera);
    const rayOrigin = gameContext.raycaster.ray.origin;
    let rayDirection = gameContext.raycaster.ray.direction.clone();
    
    // --- Accuracy Deviation System (Hunt Simulator only) ---
    // Applies realistic shot deviation based on shooting conditions
    // Only in simulator mode - practice mode has perfect accuracy for learning
    if (gameContext.gameMode !== 'practice') {
        const isBraced = getIsTreeBraced();
        const isKneeling = getIsKneeling();
        
        // Calculate cumulative deviation in degrees
        let deviationDegrees = 0;
        
        // Stance-based deviation
        if (!isBraced && !isKneeling) {
            // Offhand (standing, no support) - highest deviation
            deviationDegrees += 2.0;
        } else if (isKneeling && !isBraced) {
            // Sitting only - moderate deviation
            deviationDegrees += 0.5;
        } else if (isBraced && !isKneeling) {
            // Braced only - low deviation
            deviationDegrees += 0.2;
        }
        // Sitting + Braced = 0 deviation (perfect accuracy)
        
        // Distance-based deviation (simulates bullet drop, wind, shooter fatigue)
        if (shotDistanceYards > 150) {
            deviationDegrees += 0.6;
        } else if (shotDistanceYards > 100) {
            deviationDegrees += 0.3;
        }
        
        // Moving target adds deviation (harder to track and lead)
        if (wasMoving) {
            deviationDegrees += 1.0;
        }
        
        // Apply random deviation within the calculated cone
        if (deviationDegrees > 0) {
            const deviationRadians = (deviationDegrees * Math.PI) / 180;
            // Random angle within deviation cone
            const randomAngle = Math.random() * Math.PI * 2;
            const randomMagnitude = Math.random() * deviationRadians;
            
            // Create perpendicular vectors for deviation
            const up = new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3().crossVectors(rayDirection, up).normalize();
            const actualUp = new THREE.Vector3().crossVectors(right, rayDirection).normalize();
            
            // Apply deviation
            const deviationX = Math.cos(randomAngle) * Math.sin(randomMagnitude);
            const deviationY = Math.sin(randomAngle) * Math.sin(randomMagnitude);
            
            rayDirection.add(right.multiplyScalar(deviationX));
            rayDirection.add(actualUp.multiplyScalar(deviationY));
            rayDirection.normalize();
        }
    }
    
    const rayEnd = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(1000));

    // Calculate shot angle relative to deer's facing direction
    // This determines if it's a broadside, quartering, frontal, or rear shot
    const deerForward = new THREE.Vector3(0, 0, 1).applyQuaternion(gameContext.deer.model.quaternion).normalize();
    const shotTowardsDeer = rayDirection.clone().normalize();
    const angleAlignment = deerForward.dot(shotTowardsDeer); // -1 = frontal, 0 = broadside, 1 = rear
    
    // Determine shot angle type based on ethical hunting guidelines
    // Reference: onX Hunt, Outdoor Life, and hunter education standards
    // Broadside = ideal (0 penalty), Quartering-away = acceptable (small penalty)
    // Quartering-toward = risky (penalty), Frontal = ill-advised (high penalty)
    // Rear/"Texas heart shot" = very risky (highest penalty)
    let shotAngleType = 'broadside';
    let shotAnglePenalty = 0;
    if (angleAlignment < -0.6) {
        // Frontal shot - "ill-advised in most circumstances" per hunting guides
        // Very small target area, high bone/tissue obstruction, high wounding risk
        shotAngleType = 'frontal';
        shotAnglePenalty = -30;
    } else if (angleAlignment > 0.6) {
        // Rear shot / "Texas heart shot" - very risky
        // High risk of gut shot, meat spoilage, and prolonged suffering
        shotAngleType = 'rear';
        shotAnglePenalty = -35;
    } else if (angleAlignment < -0.25) {
        // Quartering-toward - "greater risk" per hunting guides
        // Must shoot through scapula/humerus, risk of gut shot
        shotAngleType = 'quartering-toward';
        shotAnglePenalty = -20;
    } else if (angleAlignment > 0.25) {
        // Quartering-away - "second-best shot" per hunting guides
        // Good vital access, but not ideal - small penalty
        shotAngleType = 'quartering-away';
        shotAnglePenalty = -5;
    }
    // Broadside (between -0.25 and 0.25) - "as good as it gets" - no penalty

    const hitResult = collisionSystem.raycast(rayOrigin, rayEnd, gameContext.deer);
    let shotResult = {
        distance: shotDistanceYards,
        hitType: 'miss',
        timestamp: new Date().toLocaleTimeString(),
        deerMoving: wasMoving,
        hit: false,
        shotAngle: shotAngleType,
        shotAnglePenalty: shotAnglePenalty
    };

    if (hitResult.hit) {
        shotResult.hit = true;
        const hitName = hitResult.hitZone;
        const hitPosition = hitResult.point;
        const yards = Math.round(hitResult.distance * 1.09);
        shotResult.hitType = hitName;

        // Determine if this is an instant kill shot (vital zones)
        // Shot angle affects kill probability - poor angles reduce instant kill chance
        // Note: Single lung shots are NOT instant kills - only heart, brain, spine, and double lung
        const baseInstantKill = ['heart', 'brain', 'spine', 'doubleLung'].includes(hitName);
        const isNeckShot = hitName === 'neck' || hitName === 'throat';
        const neckIsFatal = isNeckShot && Math.random() < 0.5;
        
        // Kill probability based on shot angle (per ethical hunting guidelines)
        // Frontal: 35% - small target, high bone obstruction
        // Rear: 20% - mostly gut, rarely clean vital hit
        // Quartering-toward: 70% - bone may deflect
        // Quartering-away: 90% - good but not perfect
        // Broadside: 100% - ideal angle
        let killProbability = 1.0;
        if (shotAngleType === 'frontal') {
            killProbability = 0.35;
        } else if (shotAngleType === 'rear') {
            killProbability = 0.20;
        } else if (shotAngleType === 'quartering-toward') {
            killProbability = 0.70;
        } else if (shotAngleType === 'quartering-away') {
            killProbability = 0.90;
        }
        
        const isInstantKill = baseInstantKill && Math.random() < killProbability;
        
        // If vital hit but poor angle caused it to be non-fatal, convert to wound
        const vitalHitButWounded = baseInstantKill && !isInstantKill;
        
        if (isInstantKill) {
            // Clean kill - award full points based on hit zone
            const killScores = {
                'brain': -5,   // High risk shot - penalized
                'heart': 50,   // Clean kill
                'doubleLung': 50, // Clean kill - both lungs hit
                'spine': -5    // Risky shot - penalized
            };
            const killMessages = {
                'brain': 'Head Shot - Risky Shot',
                'heart': 'Heart Shot - Clean Kill',
                'doubleLung': 'Double Lung Shot - Clean Kill',
                'spine': 'Spine Shot - Risky Shot'
            };
            
            // Apply shot angle penalty
            let finalScore = killScores[hitName] + shotAnglePenalty;
            let finalMessage = killMessages[hitName];
            
            // Track risky hit zone penalties (brain, spine)
            if (!gameContext.badShotPenalties) gameContext.badShotPenalties = [];
            if (killScores[hitName] < 0) {
                gameContext.badShotPenalties.push({ 
                    hitZone: hitName, 
                    penalty: Math.abs(killScores[hitName]),
                    description: killMessages[hitName]
                });
            }
            
            // Modify message for bad shot angles
            if (shotAnglePenalty < 0) {
                const angleNames = {
                    'frontal': 'Frontal Shot',
                    'rear': 'Rear Shot', 
                    'quartering-toward': 'Quartering-Toward'
                };
                finalMessage = `${killMessages[hitName]} (${angleNames[shotAngleType]} - Poor Angle)`;
                
                // Track shot angle penalty for report (separate from hit zone penalty)
                gameContext.badShotPenalties.push({ 
                    hitZone: `${shotAngleType}-angle`, 
                    penalty: Math.abs(shotAnglePenalty),
                    description: `${angleNames[shotAngleType]} - Risky shot angle`
                });
            }
            
            // Store shot angle for report
            if (!gameContext.shotAngles) gameContext.shotAngles = [];
            gameContext.shotAngles.push({ angle: shotAngleType, penalty: shotAnglePenalty });
            
            processKill(finalScore, finalMessage, wasMoving, 1, yards, hitName, wasRunning, wasWalking);
            
        } else if (isNeckShot && neckIsFatal) {
            // Fatal neck shot - risky shot penalized
            if (!gameContext.badShotPenalties) gameContext.badShotPenalties = [];
            gameContext.badShotPenalties.push({ 
                hitZone: 'neck', 
                penalty: 5,
                description: 'Neck Shot - Risky Shot'
            });
            processKill(-5, 'Neck Shot - Risky Shot', wasMoving, 1, yards, hitName, wasRunning, wasWalking);
            
        } else if (vitalHitButWounded) {
            // Vital area hit but poor shot angle caused deflection/non-fatal wound
            // This simulates bone deflection, single lung hit, or gut penetration
            gameContext.lastHitPosition = gameContext.deer.model.position.clone();
            
            // Determine wound type based on shot angle
            // Frontal: likely single lung or liver (deflected by sternum/ribs)
            // Rear: likely gut shot (Texas heart shot rarely hits vitals cleanly)
            // Quartering-toward: likely single lung (shoulder bone deflection)
            let deflectedHitZone = 'vitals'; // Will become single lung
            if (shotAngleType === 'rear') {
                deflectedHitZone = 'gut'; // Rear shots usually hit gut
            }
            
            const hitPointVec = hitPosition ? new THREE.Vector3(hitPosition.x, hitPosition.y, hitPosition.z) : null;
            const woundResult = gameContext.deer.applyWound(deflectedHitZone, hitPointVec);
            
            // Apply shot angle penalty
            gameContext.score += shotAnglePenalty;
            updateScoreDisplay();
            
            // Track penalty
            if (!gameContext.badShotPenalties) gameContext.badShotPenalties = [];
            const angleNames = { 'frontal': 'Frontal', 'rear': 'Rear', 'quartering-toward': 'Quartering-Toward' };
            gameContext.badShotPenalties.push({ 
                hitZone: `${shotAngleType}-angle`, 
                penalty: Math.abs(shotAnglePenalty),
                description: `${angleNames[shotAngleType]} shot - bullet deflected`
            });
            
            const woundTypeName = woundResult?.woundType?.displayName || 'Wound';
            const angleDesc = angleNames[shotAngleType] || shotAngleType;
            showPracticeModeMessage(`${angleDesc} shot deflected! ${woundTypeName} - deer wounded. ${shotAnglePenalty} Points`);
            
            logEvent("Deer Wounded", `Vital hit deflected by ${angleDesc} angle - ${woundTypeName} at ${yards} yards`, {
                distance: yards,
                originalHit: 'vitals',
                actualWound: woundTypeName,
                shotAngle: shotAngleType,
                score: shotAnglePenalty
            });
            
        } else {
            // Non-fatal hit - wound the deer with realistic behavior
            // Store hit position for GPS map (red X marker)
            gameContext.lastHitPosition = gameContext.deer.model.position.clone();
            
            // Use new applyWound method that determines wound type from hitbox
            const hitPointVec = hitPosition ? new THREE.Vector3(hitPosition.x, hitPosition.y, hitPosition.z) : null;
            const woundResult = gameContext.deer.applyWound(hitName, hitPointVec);
            
            // Check if deer died from accumulated wounds (3+ hits)
            if (woundResult && woundResult.killed) {
                processKill(20, 'Recovery Kill', wasMoving, gameContext.deer.woundCount, yards, hitName, wasRunning, wasWalking);
            } else {
                // Score based on hit location - penalize risky/poor shots
                const woundScores = {
                    'neck': -10,    // Neck shot is risky - penalized
                    'gut': -25,     // Gut shot causes significant suffering
                    'rear': -15,    // Hindquarter shot is poor placement
                    'shoulderLeft': -10, // Shoulder shot - bone may stop bullet
                    'shoulderRight': -10, // Shoulder shot - bone may stop bullet
                    'body': -5      // Non-vital body shot
                };
                const woundScore = woundScores[hitName] ?? 0;
                gameContext.score += woundScore;
                updateScoreDisplay();
                
                // Track bad shot penalties for report
                if (woundScore < 0) {
                    if (!gameContext.badShotPenalties) gameContext.badShotPenalties = [];
                    gameContext.badShotPenalties.push({ hitZone: hitName, penalty: Math.abs(woundScore) });
                }
                
                // Long-range penalty: Poor shot at over 100 yards
                // Per B&C: "stretch the stalk, not the shot" - if you can't make a clean kill, get closer
                if (yards > 100) {
                    const longRangePenalty = 10;
                    gameContext.score -= longRangePenalty;
                    updateScoreDisplay();
                    if (!gameContext.badShotPenalties) gameContext.badShotPenalties = [];
                    gameContext.badShotPenalties.push({ 
                        hitZone: 'long-range-poor-shot', 
                        penalty: longRangePenalty,
                        description: 'Exceeded Effective Range'
                    });
                }
                
                // Get wound type name for display
                const woundTypeName = woundResult && woundResult.woundType ? 
                    woundResult.woundType.displayName : hitName;
                
                // Set appropriate message based on hit location with score
                const scoreText = woundScore >= 0 ? `+${woundScore}` : `${woundScore}`;
                const woundMessages = {
                    'neck': `Neck shot! Deer wounded. ${scoreText} Points`,
                    'gut': `Gut shot! Poor placement causes suffering. ${scoreText} Points`,
                    'rear': `Hindquarter shot! Poor shot placement. ${scoreText} Points`,
                    'shoulderLeft': `Shoulder shot! Bone may deflect bullet. ${scoreText} Points`,
                    'shoulderRight': `Shoulder shot! Bone may deflect bullet. ${scoreText} Points`,
                    'body': `Body shot - deer wounded at ${yards} yards`
                };
                
                // Show wound type in message if available
                let message = woundMessages[hitName] || `Wounded at ${yards} yards`;
                if (woundResult && woundResult.woundType) {
                    message = `${woundTypeName}! ${scoreText} Points`;
                }
                showPracticeModeMessage(message);
                
                logEvent("Deer Wounded", `Deer wounded by ${hitName} shot (${woundTypeName}) at ${yards} yards (${scoreText})`, {
                    distance: yards,
                    moving: wasMoving,
                    hitZone: hitName,
                    woundType: woundTypeName,
                    score: woundScore
                });
            }
        }

        // Update hunt log
        if (gameContext.huntLog.firstShotResult === '') {
            gameContext.huntLog.hitLocation = hitName;
            gameContext.huntLog.firstShotResult = hitName;
        } else {
            gameContext.huntLog.recoveryShotDistance = shotDistanceYards;
        }

        gameContext.deer.createShotBloodIndicator(hitPosition);
        
    } else {
        // Missed shot - apply penalty
        shotResult.hitType = 'miss';
        const missPenalty = -5;
        gameContext.score += missPenalty;
        updateScoreDisplay();
        
        showPracticeModeMessage(`Missed! ${missPenalty} Points`);
        
        // Deer flees on missed shot
        if (gameContext.deer.state !== 'KILLED' && gameContext.deer.state !== 'FLEEING') {
            gameContext.deer.setState('FLEEING');
        }
    }

    if (gameContext.huntLog) {
        gameContext.huntLog.totalShotsTaken++;
        if (gameContext.huntLog.firstShotResult === '') {
            gameContext.huntLog.firstShotResult = shotResult.hitType;
        }
        
        // Excessive shots penalty: -10 for each shot after the 3rd
        // Discourages spray-and-pray tactics, promotes careful shot placement
        if (gameContext.huntLog.totalShotsTaken > 3) {
            const excessivePenalty = -10;
            gameContext.score += excessivePenalty;
            updateScoreDisplay();
            showPracticeModeMessage(`Excessive Shots! ${excessivePenalty} Points`, 1500);
            logEvent("Excessive Shots", `Penalty for shot #${gameContext.huntLog.totalShotsTaken}`, {
                shotNumber: gameContext.huntLog.totalShotsTaken,
                penalty: excessivePenalty
            });
        }
    }

    if (!gameContext.shotLog) {
        gameContext.shotLog = [];
    }
    gameContext.shotLog.push(shotResult);

    // Human-readable hit zone names for logging
    const hitZoneNames = {
        'vitals': 'Right Lung',
        'leftLung': 'Left Lung',
        'doubleLung': 'Double Lung',
        'heart': 'Heart',
        'brain': 'Brain',
        'spine': 'Spine',
        'neck': 'Neck',
        'throat': 'Throat',
        'gut': 'Gut',
        'rear': 'Rear',
        'liver': 'Liver',
        'shoulderLeft': 'Left Shoulder',
        'shoulderRight': 'Right Shoulder',
        'semiVitalBack': 'Upper Back',
        'semiVitalGut': 'Lower Abdomen'
    };
    const hitZoneDisplay = hitZoneNames[shotResult.hitType] || shotResult.hitType;
    
    logEvent("Shot Taken", shotResult.hit ? `Shot hit ${hitZoneDisplay} at ${shotDistanceYards} yards` : `Shot missed at ${shotDistanceYards} yards`, {
        distance: shotDistanceYards,
        moving: wasMoving,
        hit: shotResult.hit
    });
}

/**
 * Records deer sighting (no bonus awarded)
 * Called when deer is first sighted
 */
export function awardScoutingBonus() {
    // Only record once per deer
    if (gameContext.scoutingBonusAwarded) return;
    
    gameContext.scoutingBonusAwarded = true;
    
    // No points for scouting - just log the sighting
    logEvent("Deer Sighted", `Spotted deer`, {});
}

/**
 * Awards tracking bonus for following wounded deer
 * Called periodically while tracking
 */
export function awardTrackingBonus(distanceTracked) {
    // Award +2 points per 10 meters tracked
    const trackingBonus = Math.floor(distanceTracked / 10) * 2;
    if (trackingBonus > 0 && !gameContext.trackingBonusAwarded) {
        gameContext.score += trackingBonus;
        updateScoreDisplay();
        gameContext.trackingBonusAwarded = true;
        
        logEvent("Tracking Bonus", `Awarded for tracking wounded deer ${distanceTracked.toFixed(0)}m`, {
            distance: distanceTracked,
            bonus: trackingBonus
        });
    }
}

/**
 * Applies spooking penalty when deer is startled by hunter
 * Called when deer transitions to FLEEING state due to hunter detection
 */
export function applySpookingPenalty() {
    // Only log once per deer encounter (no penalty)
    if (gameContext.spookingPenaltyApplied) return;
    
    gameContext.spookingPenaltyApplied = true;
    
    showPracticeModeMessage(`Deer Spooked!`, 2000);
    logEvent("Deer Spooked", `Deer fled due to hunter detection`, {});
}

/**
 * Resets scoring flags for a new deer encounter
 * Called when deer respawns
 */
export function resetScoringFlags() {
    gameContext.scoutingBonusAwarded = false;
    gameContext.trackingBonusAwarded = false;
    gameContext.spookingPenaltyApplied = false;
    gameContext.killTime = null;
    gameContext.badShotPenalties = [];
    gameContext.lastHitPosition = null;
    gameContext.bloodDrops = [];
    gameContext.tagBonusInfo = null;
    gameContext.dailyKillInfo = null;
}

/**
 * Handles tagging a killed deer
 */
export function tagDeer() {
    try {
        if (gameContext.deer.tagged) {
            return;
        }
        if (!gameContext.killInfo) {
            // Fallback: If killInfo is missing but canTag is true, allow tagging for respawned deer
            // This ensures tagging works even if killInfo state is not set properly after respawn
        }
        
        // Base tag bonus reduced - tagging is expected, not exceptional
        let tagBonus = 10;
        let bonusMessages = ['Tag +10'];
        let tagBonusBreakdown = [{ name: 'Tagged Deer', value: 10 }];
        
        // Check if this was a clean kill (vital shot, first shot)
        const wasVitalShot = gameContext.killInfo && gameContext.killInfo.hitZone === 'vitals';
        const wasFirstShot = gameContext.huntLog && gameContext.huntLog.totalShotsTaken <= 1;
        const hadBadShots = gameContext.badShotPenalties && gameContext.badShotPenalties.length > 0;
        
        // Quick recovery bonus: Only for clean kills (vital shots without bad shot penalties)
        // Don't reward quick recovery of a gut-shot deer - that's just fixing your mistake
        const killTime = gameContext.killTime || Date.now();
        const recoveryTime = (Date.now() - killTime) / 1000; // seconds
        if (recoveryTime < 120 && wasVitalShot && !hadBadShots) {
            tagBonus += 15;
            bonusMessages.push('Quick Recovery +15');
            tagBonusBreakdown.push({ name: 'Quick Recovery', value: 15 });
        }
        
        // Tracking bonus: Only if it was a vital shot that required tracking (double lung, etc.)
        // Don't reward tracking a gut-shot deer - that's expected responsibility, not a bonus
        if (gameContext.currentDayStats && gameContext.currentDayStats.trackingDistance > 0) {
            if (wasVitalShot && !hadBadShots) {
                // Small bonus for tracking a well-placed shot
                const trackingBonus = Math.min(10, Math.floor(gameContext.currentDayStats.trackingDistance / 20));
                if (trackingBonus > 0) {
                    tagBonus += trackingBonus;
                    bonusMessages.push(`Tracking +${trackingBonus}`);
                    tagBonusBreakdown.push({ name: 'Tracking', value: trackingBonus });
                }
            }
            // No tracking bonus for poor shots - recovering your wounded deer is the minimum expectation
        }
        
        // Store tag bonus breakdown for report
        gameContext.tagBonusInfo = tagBonusBreakdown;
        
        gameContext.score += tagBonus;
        gameContext.scoreValueElement.textContent = gameContext.score;
        
        const shotScoreStr = gameContext.killInfo ? (gameContext.killInfo.score >= 0 ? `+${gameContext.killInfo.score}` : `${gameContext.killInfo.score}`) : '';
        const bonusBreakdown = bonusMessages.join(', ');
        const finalMessage = gameContext.killInfo 
            ? `${gameContext.killInfo.message} (${shotScoreStr}) | ${bonusBreakdown}` 
            : bonusBreakdown;
        showMessage(finalMessage);
        logEvent("Deer Tagged", `${finalMessage}`, {
            score: tagBonus,
            bonusType: 'tag',
            bonuses: bonusMessages
        });
        
        gameContext.dailyKillInfo = { ...gameContext.huntLog, ...gameContext.killInfo };
        gameContext.huntLog = {}; 
        gameContext.killInfo = null;
        gameContext.canTag = false;
        gameContext.deer.tagged = true; 
        if(gameContext.interactionPromptElement) gameContext.interactionPromptElement.style.display = 'none';
        
        // Season complete - deer has been tagged
        logEvent("Season Complete", "Successfully harvested and tagged deer. Season ended.");
        
        // Show season complete modal after a brief delay
        setTimeout(() => {
            showSeasonCompleteModal();
        }, 2000);
    } catch (error) {
        console.error('🏷️ ERROR: Exception in tagDeer function:', error);
    }
}
