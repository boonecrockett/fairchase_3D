import * as THREE from 'three';
import { gameContext } from './context.js';
import { triggerDeerBlowSound } from './spatial-audio.js';
import { isOnTrail } from './trails.js';

export class DeerAI {
    constructor(deer, config) {
        this.deer = deer;
        this.config = config;
        
        // Reusable objects for hot-path methods (avoid per-frame allocations)
        this._tempVec3 = new THREE.Vector3();
        this._tempVec3b = new THREE.Vector3();
    }

    update(delta) {
        const deer = this.deer;
        let speed = 0;
        
        // Decrement flee recovery timer - deer stays cautious after being spooked
        if (deer.fleeRecoveryTime > 0) {
            deer.fleeRecoveryTime -= delta;
        }

        switch (deer.state) {
            case 'IDLE':
                // IDLE is a pause state - deer looks around before deciding next action
                speed = 0;
                
                // Explicitly stop all movement - critical for animation sync
                deer.currentSpeed = 0;
                deer.movement.currentSpeed = 0;
                deer.movement.clearMovementHistory();
                
                // Natural head scanning while idle (look around)
                if (!deer.idleLookTimer) deer.idleLookTimer = 0;
                deer.idleLookTimer += delta;
                if (deer.idleLookTimer > 1.0) {
                    deer.idleLookTimer = 0;
                    // Slight random head turn
                    deer.model.rotation.y += (Math.random() - 0.5) * 0.3;
                }
                
                // Wait 1.5-3 seconds before transitioning (more natural pause)
                const idleDuration = 1.5 + Math.random() * 1.5;
                if (deer.stateTimer > idleDuration) {
                    // Deer should visit water at least twice per game day
                    // Thirst threshold of 180 real seconds = deer drinks every ~3 real minutes = 4x per day
                    const thirstThreshold = 180;
                    
                    if (deer.timeSinceLastDrink > thirstThreshold) {
                        deer.setState('THIRSTY');
                    } else {
                        // 30% graze, 70% wander - deer should move frequently
                        deer.setState(Math.random() < 0.3 ? 'GRAZING' : 'WANDERING');
                    }
                }
                break;
            case 'WANDERING':
                // Check if deer has reached its wander target
                if (deer.model.position.distanceTo(deer.movement.getWanderTarget()) < this.config.wanderTargetReachThreshold) {
                    // Reached target - stop completely and transition to IDLE
                    deer.currentSpeed = 0;
                    deer.movement.currentSpeed = 0;
                    deer.movement.clearMovementHistory();
                    deer.setState('IDLE');
                } else {
                    // Only move if we have a valid target
                    speed = this.config.speeds.wandering * delta;
                    deer.movement.smoothRotateTowards(deer.movement.getWanderTarget(), delta);
                    deer.movement.moveWithCollisionDetection(speed, delta);
                }
                break;
            case 'THIRSTY':
                // Find closest water edge point (not center) from gameContext.waterBodies
                let waterEdgeTarget = null;
                let closestDistance = Infinity;
                
                if (gameContext.waterBodies && gameContext.waterBodies.length > 0) {
                    for (const waterBody of gameContext.waterBodies) {
                        // Get water center and radius
                        const waterCenter = waterBody.position;
                        const waterRadius = (waterBody.userData?.config?.size || 92) / 2;
                        
                        // Calculate direction from water center to deer (reuse temp vector)
                        this._tempVec3.subVectors(deer.model.position, waterCenter).normalize();
                        
                        // Calculate edge point (water center + direction * (radius - 2))
                        // Subtract 2 units to stop just at the edge, not in the water
                        this._tempVec3b.copy(waterCenter)
                            .add(this._tempVec3.multiplyScalar(waterRadius - 2));
                        this._tempVec3b.y = deer.model.position.y; // Keep same height for distance calc
                        
                        const distance = deer.model.position.distanceTo(this._tempVec3b);
                        if (distance < closestDistance) {
                            closestDistance = distance;
                            if (!waterEdgeTarget) waterEdgeTarget = new THREE.Vector3();
                            waterEdgeTarget.copy(this._tempVec3b);
                        }
                    }
                }
                
                if (waterEdgeTarget) {
                    // Check if deer is close enough to the water edge to drink
                    if (closestDistance < 5) {
                        // Stop completely before drinking
                        deer.currentSpeed = 0;
                        deer.movement.currentSpeed = 0;
                        deer.movement.clearMovementHistory();
                        deer.setState('DRINKING');
                    } else {
                        // Move toward water edge
                        speed = this.config.speeds.thirsty * delta;
                        deer.movement.smoothRotateTowards(waterEdgeTarget, delta);
                        deer.movement.moveWithCollisionDetection(speed, delta);
                    }
                } else {
                    deer.currentSpeed = 0;
                    deer.movement.currentSpeed = 0;
                    deer.movement.clearMovementHistory();
                    deer.setState('WANDERING'); // No water found
                }
                break;
            case 'GRAZING':
                // Deer should be completely stationary while grazing
                deer.currentSpeed = 0;
                deer.movement.currentSpeed = 0;
                deer.movement.clearMovementHistory();
                if (deer.stateTimer > this.config.stateTimers.grazing) {
                    // Transition to IDLE for a natural pause before next action
                    deer.setState('IDLE');
                }
                break;
            case 'DRINKING':
                // Deer should be completely stationary while drinking
                deer.currentSpeed = 0;
                deer.movement.currentSpeed = 0;
                deer.movement.clearMovementHistory();
                if (deer.stateTimer > this.config.stateTimers.drinking) {
                    deer.timeSinceLastDrink = 0;
                    // Transition to IDLE for a natural pause before next action
                    deer.setState('IDLE');
                }
                break;
            case 'ALERT':
                // Deer should be stationary while alert
                deer.currentSpeed = 0;
                deer.movement.currentSpeed = 0;
                deer.movement.clearMovementHistory();
                
                // Turn counterclockwise (left) when alert instead of toward player
                if (!deer.alertTurnDirection) {
                    // Calculate counterclockwise direction (90 degrees left from current facing)
                    const currentRotation = deer.model.rotation.y;
                    deer.alertTargetRotation = currentRotation + Math.PI / 2; // 90 degrees counterclockwise
                    deer.alertTurnDirection = true;
                }
                
                // Smoothly rotate counterclockwise
                const rotationSpeed = this.config.rotationSpeed * delta;
                const rotationDiff = deer.alertTargetRotation - deer.model.rotation.y;
                
                if (Math.abs(rotationDiff) > 0.1) {
                    deer.model.rotation.y += Math.sign(rotationDiff) * Math.min(Math.abs(rotationDiff), rotationSpeed);
                }
                break;
            case 'FLEEING':
                speed = this.config.speeds.fleeing * delta;
                
                // Check for calibrator override
                if (window.animationCalibrator) {
                    const calibratorMult = window.animationCalibrator.getMovementSpeedMultiplier();
                    if (calibratorMult !== null) {
                        speed = this.config.speeds.fleeing * calibratorMult * delta;
                    }
                }
                
                // Calculate flee direction, but check if it leads to water
                this._tempVec3.subVectors(deer.model.position, gameContext.player.position).normalize();
                
                // Test if fleeing directly away would put deer in water
                const testDistance = 10;
                // Compute test position: deer pos + fleeDir * testDistance
                const testX = deer.model.position.x + this._tempVec3.x * testDistance;
                const testZ = deer.model.position.z + this._tempVec3.z * testDistance;
                const fleeIntoWater = gameContext.isWaterAt ? gameContext.isWaterAt(testX, testZ) : false;
                
                if (fleeIntoWater) {
                    // Try perpendicular directions using stored flee dir components
                    const fdx = this._tempVec3.x;
                    const fdz = this._tempVec3.z;
                    
                    const leftX = deer.model.position.x + (-fdz) * testDistance;
                    const leftZ = deer.model.position.z + fdx * testDistance;
                    const rightX = deer.model.position.x + fdz * testDistance;
                    const rightZ = deer.model.position.z + (-fdx) * testDistance;
                    
                    const leftInWater = gameContext.isWaterAt ? gameContext.isWaterAt(leftX, leftZ) : false;
                    const rightInWater = gameContext.isWaterAt ? gameContext.isWaterAt(rightX, rightZ) : false;
                    
                    if (!leftInWater && !rightInWater) {
                        const ldx = leftX - gameContext.player.position.x;
                        const ldz = leftZ - gameContext.player.position.z;
                        const rdx = rightX - gameContext.player.position.x;
                        const rdz = rightZ - gameContext.player.position.z;
                        if (ldx * ldx + ldz * ldz > rdx * rdx + rdz * rdz) {
                            this._tempVec3.set(-fdz, 0, fdx); // perpLeft
                        } else {
                            this._tempVec3.set(fdz, 0, -fdx); // perpRight
                        }
                    } else if (!leftInWater) {
                        this._tempVec3.set(-fdz, 0, fdx);
                    } else if (!rightInWater) {
                        this._tempVec3.set(fdz, 0, -fdx);
                    }
                    // If both lead to water, keep original flee direction
                }
                
                // Compute target position for smooth rotation (reuse _tempVec3b)
                this._tempVec3b.addVectors(deer.model.position, this._tempVec3);
                deer.movement.smoothRotateTowards(this._tempVec3b, delta);
                deer.movement.moveWithCollisionDetection(speed, delta);
                
                if (deer.stateTimer > this.config.stateTimers.fleeing) {
                    // Generate new wander target AWAY from player, not random
                    // This prevents deer from immediately walking back toward the hunter
                    const awayFromPlayer = new THREE.Vector3()
                        .subVectors(deer.model.position, gameContext.player.position)
                        .normalize();
                    
                    // Set wander target 50-100 units further away from player
                    const fleeDistance = 50 + Math.random() * 50;
                    const newTarget = deer.model.position.clone()
                        .add(awayFromPlayer.multiplyScalar(fleeDistance));
                    
                    // Clamp to world bounds
                    const worldSize = gameContext.terrain ? 
                        gameContext.terrain.geometry.parameters.width / 2 : 500;
                    const margin = 50;
                    newTarget.x = Math.max(-worldSize + margin, Math.min(worldSize - margin, newTarget.x));
                    newTarget.z = Math.max(-worldSize + margin, Math.min(worldSize - margin, newTarget.z));
                    
                    deer.movement.wanderTarget = newTarget;
                    deer.fleeRecoveryTime = 30; // Stay cautious for 30 seconds
                    deer.setState('IDLE');
                }
                break;
            case 'WOUNDED':
                // Use wound system for realistic behavior
                const woundState = deer.woundState;
                
                if (woundState && woundState.woundType) {
                    // Update wound state and check for state changes
                    const woundResult = woundState.update(delta);
                    
                    if (woundResult === 'KILLED') {
                        deer.setState('KILLED');
                        speed = 0;
                        break;
                    }
                    
                    if (woundResult === 'BEDDED') {
                        // Deer beds down - stop moving, use idle animation
                        speed = 0;
                        deer.currentSpeed = 0;
                        deer.movement.currentSpeed = 0;
                        // Stay in WOUNDED state but bedded
                        break;
                    }
                    
                    if (woundResult === 'RECOVERED') {
                        // Muscle hit deer recovered - return to normal
                        deer.setState('FLEEING');
                        break;
                    }
                    
                    if (woundResult === 'ESCAPED') {
                        // Deer "escaped" but will die from wounds - may seek thick cover
                        console.log(`🦌 Wounded deer escaped initial area (${woundState.woundType.displayName})`);
                        
                        // Extend the travel distance - deer runs further before dying
                        woundState.maxTravelDistance += 100 + Math.random() * 200; // Add 100-300 more yards
                        woundState.hasEscaped = false; // Reset so it doesn't trigger again
                        woundState.energy = Math.max(15, woundState.energy); // Give it energy to travel
                        
                        // 70% chance deer seeks thick cover to die in (more challenging to find)
                        // 30% chance deer dies in the open (easier to find)
                        if (Math.random() < 0.7) {
                            console.log(`🦌 Wounded deer seeking thick cover to die`);
                            woundState.woundType.seekCover = true;
                            woundState.reachedTarget = false;
                            woundState.targetBedLocation = null;
                            woundState.findThickCover();
                        } else {
                            console.log(`🦌 Wounded deer will die in the open`);
                        }
                        
                        // Continue wounded movement - don't break, let it keep going
                    }
                    
                    // Check if bedded (stopped)
                    if (woundState.isBedded) {
                        speed = 0;
                        
                        // Check if player approaches - bump and move
                        const distToPlayer = deer.model.position.distanceTo(gameContext.player.position);
                        if (distToPlayer < 25) {
                            // Bumped! Move away 50-150 yards
                            console.log(`🦌 Deer bumped! Was bedded, now moving again.`);
                            woundState.isBedded = false;
                            woundState.distanceTraveled = 0; // Reset for new short run
                            woundState.beddingDistance = 30 + Math.random() * 70; // Short distance: 30-100 units
                            woundState.findBeddingLocation();
                            
                            // Penalty for pushing a wounded deer - causes more suffering
                            // Per B&C: gut-shot deer should be given time before tracking
                            const woundName = woundState.woundType?.name || '';
                            const isGutOrLiver = woundName === 'gut' || woundName === 'liver';
                            const pushPenalty = isGutOrLiver ? 15 : 10;
                            const penaltyDesc = isGutOrLiver ? 
                                'Pushed Gut-Shot Deer' : 'Pushed Wounded Deer';
                            
                            gameContext.score -= pushPenalty;
                            if (typeof updateScoreDisplay === 'function') updateScoreDisplay();
                            
                            if (!gameContext.badShotPenalties) gameContext.badShotPenalties = [];
                            gameContext.badShotPenalties.push({ 
                                hitZone: 'pushed-wounded', 
                                penalty: pushPenalty,
                                description: penaltyDesc
                            });
                            
                            // Import and show message
                            import('./ui.js').then(ui => {
                                ui.showMessage(`${penaltyDesc}! -${pushPenalty} pts. Give wounded deer time to bed.`);
                            });
                        }
                        break;
                    }
                    
                    // Calculate speed based on wound type
                    const baseSpeed = this.config.speeds.wounded;
                    let speedMult = woundState.getSpeedMultiplier();
                    
                    // Check for calibrator override
                    if (window.animationCalibrator) {
                        const calibratorMult = window.animationCalibrator.getMovementSpeedMultiplier();
                        if (calibratorMult !== null) {
                            speedMult = calibratorMult;
                        }
                    }
                    
                    speed = baseSpeed * speedMult * delta;
                    
                    // Get movement direction from wound system
                    let moveDir = woundState.getMovementDirection();
                    
                    // Apply boundary checking
                    const worldSize = gameContext.terrain.geometry.parameters.width;
                    const boundary = worldSize / 2 - this.config.worldBoundaryMargin;
                    const safeBoundary = boundary * 0.8;
                    
                    // Test if direction is safe (boundary check)
                    const testPos = new THREE.Vector3().addVectors(
                        deer.model.position, 
                        moveDir.clone().multiplyScalar(30)
                    );
                    
                    let finalDir = moveDir.clone();
                    if (Math.abs(testPos.x) > safeBoundary || Math.abs(testPos.z) > safeBoundary) {
                        // Find safe direction
                        const centerDir = new THREE.Vector3()
                            .subVectors(new THREE.Vector3(0, 0, 0), deer.model.position)
                            .normalize();
                        finalDir.lerp(centerDir, 0.5).normalize();
                        woundState.fleeDirection = finalDir.clone();
                    }
                    
                    // Proactive obstacle avoidance - check at multiple distances
                    const lookAheadDistances = [4, 8, 12]; // Check close, medium, and far
                    let obstacleAhead = false;
                    
                    for (const dist of lookAheadDistances) {
                        const lookAheadPos = new THREE.Vector3().addVectors(
                            deer.model.position,
                            finalDir.clone().multiplyScalar(dist)
                        );
                        
                        if (gameContext.checkTreeCollision(lookAheadPos, 1.5) ||
                            (gameContext.isWaterAt && gameContext.isWaterAt(lookAheadPos.x, lookAheadPos.z))) {
                            obstacleAhead = true;
                            break;
                        }
                    }
                    
                    // Also check if movement system has a forced avoidance direction
                    if (deer.movement.forcedAvoidanceTimer > 0 && deer.movement.forcedAvoidanceDirection) {
                        finalDir.copy(deer.movement.forcedAvoidanceDirection);
                        woundState.fleeDirection = finalDir.clone();
                    } else if (obstacleAhead) {
                        // Find clear direction before hitting obstacle
                        const testAngles = [Math.PI/6, -Math.PI/6, Math.PI/4, -Math.PI/4, Math.PI/2, -Math.PI/2, Math.PI*3/4, -Math.PI*3/4];
                        let foundClear = false;
                        for (const angle of testAngles) {
                            const testDir = finalDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
                            
                            // Check all distances for this direction
                            let directionClear = true;
                            for (const dist of lookAheadDistances) {
                                const testPosition = new THREE.Vector3().addVectors(
                                    deer.model.position,
                                    testDir.clone().multiplyScalar(dist)
                                );
                                
                                const hasTree = gameContext.checkTreeCollision(testPosition, 1.5);
                                const hasWater = gameContext.isWaterAt && gameContext.isWaterAt(testPosition.x, testPosition.z);
                                const outOfBounds = Math.abs(testPosition.x) >= safeBoundary || Math.abs(testPosition.z) >= safeBoundary;
                                
                                if (hasTree || hasWater || outOfBounds) {
                                    directionClear = false;
                                    break;
                                }
                            }
                            
                            if (directionClear) {
                                finalDir.copy(testDir).normalize();
                                woundState.fleeDirection = finalDir.clone();
                                foundClear = true;
                                break;
                            }
                        }
                        
                        // If no clear direction found, head toward center
                        if (!foundClear) {
                            const toCenter = new THREE.Vector3()
                                .subVectors(new THREE.Vector3(0, 0, 0), deer.model.position)
                                .normalize();
                            finalDir.copy(toCenter);
                            woundState.fleeDirection = finalDir.clone();
                        }
                    }
                    
                    // Apply wobble for dying deer
                    const wobble = woundState.getWobble();
                    if (wobble !== 0) {
                        deer.model.rotation.y += wobble * delta;
                    }
                    
                    // Look back behavior (gut shots)
                    if (woundState.shouldLookBack()) {
                        // Brief pause and turn toward player
                        const toPlayer = new THREE.Vector3()
                            .subVectors(gameContext.player.position, deer.model.position);
                        const lookAngle = Math.atan2(toPlayer.x, toPlayer.z);
                        deer.model.rotation.y = lookAngle;
                        speed = 0; // Pause briefly
                    } else {
                        // Normal wounded movement
                        const targetPos = new THREE.Vector3().addVectors(deer.model.position, finalDir);
                        deer.movement.smoothRotateTowards(targetPos, delta);
                        
                        // Check if deer is facing roughly the right direction before moving
                        // This prevents "moonwalking" where deer moves backward
                        const deerForward = new THREE.Vector3(0, 0, 1).applyQuaternion(deer.model.quaternion);
                        const dotProduct = deerForward.dot(finalDir);
                        
                        // Scale speed based on facing direction:
                        // - Facing target (dot=1): full speed
                        // - Perpendicular (dot=0): 30% speed (still moving while turning)
                        // - Facing away (dot=-1): 10% speed (minimal, mostly turning)
                        const facingFactor = 0.1 + Math.max(0, dotProduct) * 0.9;
                        deer.movement.moveWithCollisionDetection(speed * facingFactor, delta);
                    }
                    
                    // Blood drops based on wound bleed rate
                    const bloodInterval = woundState.getBloodDropInterval();
                    if (!deer.lastBloodDropTime) deer.lastBloodDropTime = 0;
                    deer.lastBloodDropTime += delta;
                    if (deer.lastBloodDropTime >= bloodInterval) {
                        deer.effects.createBloodDrop();
                        deer.lastBloodDropTime = 0;
                    }
                } else {
                    // Fallback to old behavior if no wound type set
                    speed = this.config.speeds.wounded * delta;
                    
                    if (!deer.woundedFleeDirection) {
                        deer.woundedFleeDirection = new THREE.Vector3()
                            .subVectors(deer.model.position, gameContext.player.position)
                            .normalize();
                    }
                    
                    const targetPosition = new THREE.Vector3()
                        .addVectors(deer.model.position, deer.woundedFleeDirection);
                    deer.movement.smoothRotateTowards(targetPosition, delta);
                    deer.movement.moveWithCollisionDetection(speed, delta);
                    
                    if (deer.effects.shouldCreateBloodDrop()) {
                        deer.effects.createBloodDrop();
                    }
                }
                break;
            case 'KILLED':
                speed = 0;
                break;
        }

        // Store movement speed for animation decisions
        deer.movementSpeed = speed / delta; // Convert back to units per second
        deer.currentSpeed = deer.movementSpeed;

        // Handle boundary checks and stuck detection
        this.checkBoundaries(deer);
        this.checkStuck(deer, delta);
    }

    checkBoundaries(deer) {
        const worldSize = gameContext.terrain.geometry.parameters.width;
        const boundary = worldSize / 2 - this.config.worldBoundaryMargin;
        
        let wasOutsideBoundary = false;
        let needsBoundaryEscape = false;
        
        if (deer.model.position.x > boundary) {
            const safeX = this.findSafePositionNearBoundary(boundary, deer.model.position.z, 'x');
            deer.model.position.x = safeX;
            wasOutsideBoundary = true;
            needsBoundaryEscape = true;
        } else if (deer.model.position.x < -boundary) {
            const safeX = this.findSafePositionNearBoundary(-boundary, deer.model.position.z, 'x');
            deer.model.position.x = safeX;
            wasOutsideBoundary = true;
            needsBoundaryEscape = true;
        }
        
        if (deer.model.position.z > boundary) {
            const safeZ = this.findSafePositionNearBoundary(boundary, deer.model.position.x, 'z');
            deer.model.position.z = safeZ;
            wasOutsideBoundary = true;
            needsBoundaryEscape = true;
        } else if (deer.model.position.z < -boundary) {
            const safeZ = this.findSafePositionNearBoundary(-boundary, deer.model.position.x, 'z');
            deer.model.position.z = safeZ;
            wasOutsideBoundary = true;
            needsBoundaryEscape = true;
        }
        
        if (needsBoundaryEscape) {
            const centerDirection = new THREE.Vector3(0, 0, 0).sub(deer.model.position).normalize();
            const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(
                new THREE.Vector3(0, 0, 1),
                centerDirection
            );
            
            deer.model.quaternion.slerp(targetQuaternion, 0.5);
            
            if (deer.state === 'WOUNDED') {
                deer.woundedFleeDirection = centerDirection.clone();
                deer.lastWoundedDirectionUpdate = gameContext.clock.getElapsedTime();
            }
            
            deer.movement.generateNewWanderTarget();
            
            const safeBoundary = boundary * 0.8;
            const wanderTarget = deer.movement.getWanderTarget();
            wanderTarget.x = Math.max(-safeBoundary, Math.min(safeBoundary, wanderTarget.x));
            wanderTarget.z = Math.max(-safeBoundary, Math.min(safeBoundary, wanderTarget.z));
        } else if (wasOutsideBoundary) {
            deer.movement.generateNewWanderTarget();
        }
    }

    findSafePositionNearBoundary(boundaryValue, otherCoordinate, axis) {
        const testRadius = 0.7;
        const maxAttempts = 10;
        const stepSize = 2.0;
        
        for (let i = 0; i < maxAttempts; i++) {
            const offset = i * stepSize;
            const testValue = boundaryValue > 0 ? boundaryValue - offset : boundaryValue + offset;
            
            const testPosition = new THREE.Vector3();
            if (axis === 'x') {
                testPosition.set(testValue, this.deer.model.position.y, otherCoordinate);
            } else {
                testPosition.set(otherCoordinate, this.deer.model.position.y, testValue);
            }
            
            if (!gameContext.checkTreeCollision(testPosition, testRadius)) {
                return testValue;
            }
        }
        
        const safeOffset = 10;
        return boundaryValue > 0 ? boundaryValue - safeOffset : boundaryValue + safeOffset;
    }

    checkStuck(deer, delta) {
        const currentTime = gameContext.clock.getElapsedTime();
        if (currentTime - deer.lastStuckCheckTime > deer.stuckCheckInterval) {
            deer.lastStuckCheckTime = currentTime;
            
            const shouldBeMovingStates = ['WANDERING', 'FLEEING', 'WOUNDED'];
            const shouldCheckForStuck = shouldBeMovingStates.includes(deer.state);
            
            if (deer.stuckDetectionHistory.length > 0 && shouldCheckForStuck) {
                const oldestPosition = deer.stuckDetectionHistory[0];
                const distanceSinceLastCheck = deer.model.position.distanceTo(oldestPosition);
                
                const isInMovingAnimation = deer.animation.isInMovingAnimation();
                
                const isWanderingButStuck = deer.state === 'WANDERING' && 
                    deer.model.position.distanceTo(deer.movement.getWanderTarget()) > this.config.wanderTargetReachThreshold &&
                    distanceSinceLastCheck < deer.stuckThreshold;
                
                const isFleeingButStuck = deer.state === 'FLEEING' && distanceSinceLastCheck < deer.stuckThreshold;
                
                if ((isInMovingAnimation && distanceSinceLastCheck < deer.stuckThreshold) || 
                    isWanderingButStuck || 
                    isFleeingButStuck) {
                    deer.consecutiveStuckChecks++;
                    if (deer.consecutiveStuckChecks >= deer.requiredStuckChecks) {
                        deer.emergencyEscapeActive = true;
                    }
                } else {
                    deer.consecutiveStuckChecks = 0;
                    deer.emergencyEscapeActive = false;
                }
            } else if (!shouldCheckForStuck) {
                deer.consecutiveStuckChecks = 0;
                deer.emergencyEscapeActive = false;
            }
        }

        if (deer.emergencyEscapeActive) {
            deer.stuckDetectionHistory = [];
            
            const testDirections = [
                new THREE.Vector3(1, 0, 0),   // East
                new THREE.Vector3(-1, 0, 0),  // West
                new THREE.Vector3(0, 0, 1),   // North
                new THREE.Vector3(0, 0, -1)   // South
            ];
            
            let foundSafePosition = false;
            const escapeDistance = 2.0; 
            
            for (const direction of testDirections) {
                const testPosition = deer.model.position.clone().add(direction.clone().multiplyScalar(escapeDistance));
                const boundary = gameContext.worldSize / 2 - 10;
                const withinBounds = Math.abs(testPosition.x) < boundary && Math.abs(testPosition.z) < boundary;
                const noTreeCollision = !gameContext.checkTreeCollision(testPosition, 0.7);
                
                if (withinBounds && noTreeCollision) {
                    const moveDirection = direction.clone().multiplyScalar(escapeDistance * 0.5);
                    deer.model.position.add(moveDirection);
                    deer.model.position.y = gameContext.getHeightAt(deer.model.position.x, deer.model.position.z) + deer.config.heightOffset;
                    
                    deer.movement.generateNewWanderTarget();
                    
                    foundSafePosition = true;
                    deer.emergencyEscapeActive = false;
                    deer.consecutiveStuckChecks = 0;
                    break;
                }
            }
            
            if (!foundSafePosition) {
                const centerDirection = new THREE.Vector3(0, 0, 0).sub(deer.model.position).normalize();
                const centerMove = centerDirection.multiplyScalar(1.0);
                
                deer.model.position.add(centerMove);
                deer.model.position.y = gameContext.getHeightAt(deer.model.position.x, deer.model.position.z) + deer.config.heightOffset;
                deer.movement.generateNewWanderTarget();
                
                deer.emergencyEscapeActive = false;
                deer.consecutiveStuckChecks = 0;
            }
        }

        const distanceMoved = deer.model.position.distanceTo(deer.movement.lastPosition);
        
        if (deer.state === 'IDLE' || deer.state === 'KILLED') {
            deer.movement.clearMovementHistory();
        } else {
            deer.movement.updateMovementHistory(distanceMoved);
        }

        if (deer.movement.getIsMoving()) {
            deer.effects.createTrack();
        }

        deer.movement.lastPosition.copy(deer.model.position);

        deer.stuckDetectionHistory.push(deer.model.position.clone());
        
        if (deer.stuckDetectionHistory.length > deer.stuckDetectionMaxHistory) {
            deer.stuckDetectionHistory.shift();
        }
    }
}
