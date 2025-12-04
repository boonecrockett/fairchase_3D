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
    if (distance <= 30) {
        bonus += 25;
        bonusDetails.push('Close Stalk +25');
    } else if (distance <= 50) {
        bonus += 15;
        bonusDetails.push('Good Stalk +15');
    } else if (distance <= 75) {
        bonus += 5;
        bonusDetails.push('Decent Range +5');
    }
    // No bonus for long range shots - fair chase emphasizes getting close
    
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
        const isBraced = getIsTreeBraced();
        const isKneeling = getIsKneeling();
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
    const isBracedForInfo = getIsTreeBraced();
    const isKneelingForInfo = getIsKneeling();
    const { bonusDetails: bonusBreakdown } = calculateBonuses(distance, wasMoving, hitZone, isFirstShot, isBracedForInfo, isKneelingForInfo, wasRunning, wasWalking);
    
    gameContext.killInfo = { 
        score: finalScore, 
        message: baseMessage, // Store base message without bonuses for tag display
        wasMoving: wasMoving,
        shotCount: shotCount,
        distance: distance,
        ethical: ethical,
        hitZone: hitZone,
        bonusBreakdown: bonusBreakdown // Store individual bonus details for report
    };
    
    const scoreText = finalScore >= 0 ? ` +${finalScore}` : ` ${finalScore}`;
    showMessage(`${finalMessage}!${scoreText} Points`);
    
    gameContext.deer.setState('KILLED');
    const isBraced = getIsTreeBraced();
    logEvent("Deer Killed", `${baseMessage} at ${distance} yards${isBraced ? ' (Braced)' : ''}`, {
        distance: distance,
        moving: wasMoving,
        shotCount: shotCount,
        ethical: ethical,
        braced: isBraced,
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

    gameContext.raycaster.setFromCamera({ x: 0, y: 0 }, gameContext.camera);
    const rayOrigin = gameContext.raycaster.ray.origin;
    const rayDirection = gameContext.raycaster.ray.direction;
    const rayEnd = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(1000));

    const hitResult = collisionSystem.raycast(rayOrigin, rayEnd, gameContext.deer);
    let shotResult = {
        distance: shotDistanceYards,
        hitType: 'miss',
        timestamp: new Date().toLocaleTimeString(),
        deerMoving: wasMoving,
        hit: false
    };

    if (hitResult.hit) {
        shotResult.hit = true;
        const hitName = hitResult.hitZone;
        const hitPosition = hitResult.point;
        const yards = Math.round(hitResult.distance * 1.09);
        shotResult.hitType = hitName;

        // Determine if this is an instant kill shot (vital zones)
        const isInstantKill = ['vitals', 'brain', 'spine'].includes(hitName);
        const isNeckShot = hitName === 'neck';
        const neckIsFatal = isNeckShot && Math.random() < 0.5;
        
        if (isInstantKill) {
            // Clean kill - award full points based on hit zone
            const killScores = {
                'brain': -5,   // High risk shot - penalized
                'vitals': 50,  // Standard clean kill
                'spine': -5    // Risky shot - penalized
            };
            const killMessages = {
                'brain': 'Head Shot - Risky Shot',
                'vitals': 'Vital Shot - Clean Kill',
                'spine': 'Spine Shot - Risky Shot'
            };
            
            processKill(killScores[hitName], killMessages[hitName], wasMoving, 1, yards, hitName, wasRunning, wasWalking);
            
        } else if (isNeckShot && neckIsFatal) {
            // Fatal neck shot - risky shot penalized
            processKill(-5, 'Neck Shot - Risky Shot', wasMoving, 1, yards, hitName, wasRunning, wasWalking);
            
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
                // Score based on hit location - penalize unethical shots
                const woundScores = {
                    'neck': -5,     // Neck shot is risky - penalized
                    'gut': -15,     // Gut shot is unethical - causes suffering
                    'rear': -10,    // Hindquarter shot is poor placement
                    'shoulderLeft': -5,  // Shoulder shot - bone may stop bullet
                    'shoulderRight': -5, // Shoulder shot - bone may stop bullet
                    'body': 0       // Neutral body shot
                };
                const woundScore = woundScores[hitName] ?? 0;
                gameContext.score += woundScore;
                updateScoreDisplay();
                
                // Track bad shot penalties for report
                if (woundScore < 0) {
                    if (!gameContext.badShotPenalties) gameContext.badShotPenalties = [];
                    gameContext.badShotPenalties.push({ hitZone: hitName, penalty: Math.abs(woundScore) });
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
                showMessage(message);
                
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
        
        showMessage(`Missed! ${missPenalty} Points`);
        
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
            showMessage(`Excessive Shots! ${excessivePenalty} Points`, 1500);
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

    logEvent("Shot Taken", shotResult.hit ? `Shot hit ${shotResult.hitType} at ${shotDistanceYards} yards` : `Shot missed at ${shotDistanceYards} yards`, {
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
 * Applies spooking penalty when deer is startled by player
 * Called when deer transitions to FLEEING state due to player detection
 */
export function applySpookingPenalty() {
    // Only log once per deer encounter (no penalty)
    if (gameContext.spookingPenaltyApplied) return;
    
    gameContext.spookingPenaltyApplied = true;
    
    showMessage(`Deer Spooked!`, 2000);
    logEvent("Deer Spooked", `Deer fled due to player detection`, {});
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
        
        let tagBonus = 25;
        let bonusMessages = ['Tag +25'];
        let tagBonusBreakdown = [{ name: 'Tagged Deer', value: 25 }];
        
        // Quick recovery bonus: +15 if deer was recovered within 2 minutes of being killed
        const killTime = gameContext.killTime || Date.now();
        const recoveryTime = (Date.now() - killTime) / 1000; // seconds
        if (recoveryTime < 120) { // 2 minutes
            tagBonus += 15;
            bonusMessages.push('Quick Recovery +15');
            tagBonusBreakdown.push({ name: 'Quick Recovery', value: 15 });
        }
        
        // Tracking bonus: Award points for distance tracked to recover wounded deer
        if (gameContext.currentDayStats && gameContext.currentDayStats.trackingDistance > 0) {
            const trackingBonus = Math.min(20, Math.floor(gameContext.currentDayStats.trackingDistance / 10) * 2);
            if (trackingBonus > 0) {
                tagBonus += trackingBonus;
                bonusMessages.push(`Tracking +${trackingBonus}`);
                tagBonusBreakdown.push({ name: 'Tracking', value: trackingBonus });
            }
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
