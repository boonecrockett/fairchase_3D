import * as THREE from 'three';
import { gameContext } from './context.js';
import { updateDeerAudio, triggerDeerBlowSound, triggerDeerSpawnBlowSound } from './spatial-audio.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { deerConfig } from './deer-config.js';
import { DeerEffects } from './deer-effects.js';
import { DeerAnimation } from './deer-animation.js';
import { DeerHitbox } from './deer-hitbox.js';
import { DeerMovement } from './deer-movement.js';
import { Animal } from './animal.js';

class Deer extends Animal {
    constructor() {
        super(deerConfig);
        this.model.name = 'deer'; // Overriding generic name
        gameContext.deer = this; // The entire deer instance is the source of truth

        this.timeSinceLastDrink = 0;
        this.idleBehaviorTimer = 0;
        this.idleBehaviorDuration = 3 + Math.random() * 4; // Random duration 3-7 seconds
        this.currentIdleBehavior = 'idle';
        this.lastStuckCheckTime = 0;
        this.stuckCheckInterval = 1.0; // Check every 1 second (less frequent)
        this.emergencyEscapeActive = false;
        this.consecutiveStuckChecks = 0; // Require multiple consecutive stuck detections
        this.requiredStuckChecks = 3; // Must be stuck for 3 consecutive checks before activating escape

        this.previousState = 'IDLE'; // Initialize for spatial audio state change detection
        this.alertTurnDirection = false; // Reset alert turning behavior
        this.alertStartTime = 0;
        this.hasAlertedPlayer = false; // Track if deer has blown alarm for current detection event
        this.alertMovementDelay = 2.5; // Total delay before deer can move after becoming alert (0.5s sound delay + 2s movement delay)

        this.currentIdleBehavior = 'idle';
        
        // Initialize visual effects system
        this.effects = new DeerEffects(this, this.config);
        
        // Initialize animation system
        this.animation = new DeerAnimation(this, this.config);
        
        // Initialize hitbox system
        this.hitbox = new DeerHitbox(this, this.config);

    /**
     * Wounds the deer, increments wound count, and checks for death.
     * @returns {boolean} True if the deer died from this wound, false otherwise.
     */
    this.wound = () => {
        if (this.state === 'KILLED') return false;

        this.woundCount++;
        this.effects.createBloodDrop(); // Deer bleeds when wounded

        if (this.woundCount >= 3) {
            this.setState('KILLED');
            return true; // Deer has died from wounds
        }

        this.setState('WOUNDED');
        return false; // Deer is wounded but not dead
    };
        
        // Initialize movement system
        this.movement = new DeerMovement(this, this.config);
        
        // Generate initial wander target
        this.movement.generateNewWanderTarget();

        this.fallen = false;
        this.woundCount = 0; // Track number of wounds for 3-wound kill logic
        this.tagged = false; // Track if deer has been tagged after being killed
        this.setState('IDLE'); // Initialize state to IDLE
        
        // Debugging option to disable fleeing behavior
        this.fleeingEnabled = true; // Default: deer can flee normally
        
        // Head turning properties for looking at hunter
        this.isLookingAtHunter = false;
        this.headTargetRotation = 0; // Target Y rotation for head
        this.headCurrentRotation = 0; // Current Y rotation for head
        this.headTurnSpeed = 3.0; // Radians per second for head turning

        // Movement detection tracking for stealth system
        this.lastPlayerPosition = new THREE.Vector3();
        this.playerMovementStartTime = 0;
        this.isTrackingPlayerMovement = false;
        this.hasDetectedMovingPlayer = false;
        this.MOVEMENT_DETECTION_THRESHOLD = 1.0; // Reduced from 4.0 to 1.0 seconds - deer detects movement faster
        this.MOVEMENT_DISTANCE_THRESHOLD = 0.05; // Reduced from 0.3 to 0.05 - more sensitive to player movement
        this.movementSampleCount = 0;
        this.REQUIRED_MOVEMENT_SAMPLES = 2; // Reduced from 5 to 2 - require less consistent movement to detect

        this.wasActuallyHit = false; // Flag to track if deer was actually hit

        this.stuckDetectionHistory = [];
        this.stuckDetectionMaxHistory = 60; // Track last 60 positions (about 1 second at 60fps)
        this.stuckThreshold = 0.2; // If deer hasn't moved more than 0.2 units in 1 second, it might be stuck
        
        this.lastStuckCheckTime = 0;
        
        // Cache for isPlayerVisible function
        this.cachedVisibility = undefined;
        this.lastVisibilityCheck = undefined;
        this.lastPlayerPositionForVisibility = undefined;
        
        this.woundedFleeDirection = null;
        this.lastWoundedDirectionUpdate = null;
    }

    setState(newState) {
        const oldState = this.state;
        
        console.log('🔴 DEBUG: setState called - oldState:', oldState, 'newState:', newState);
        
        // DEFENSIVE: Validate state - reject invalid states
        const validStates = ['IDLE', 'WANDERING', 'THIRSTY', 'GRAZING', 'DRINKING', 'ALERT', 'FLEEING', 'WOUNDED', 'KILLED'];
        if (!validStates.includes(newState)) {
            console.error('🚨 INVALID STATE DETECTED:', newState);
            console.error('🚨 Stack trace:', new Error().stack);
            console.error('🚨 Rejecting invalid state, keeping current state:', this.state);
            return; // Reject invalid state
        }
        
        // Critical bug fix: Prevent any state changes if deer is locked in KILLED state
        if (this.stateLockedToKilled && newState !== 'KILLED') {
            console.log('🔴 DEBUG: setState blocked - deer locked to KILLED state');
            return;
        }
        
        // Also prevent transitions OUT of KILLED state once it's been set
        // EXCEPTION: Allow transitions during respawn when stateLockedToKilled is explicitly false
        if (this.state === 'KILLED' && newState !== 'KILLED' && this.stateLockedToKilled === true) {
            console.log('🔴 DEBUG: setState blocked - cannot transition out of KILLED state');
            return;
        }
        
        // Critical bug fix: Set state lock BEFORE entering KILLED state to prevent race conditions
        if (newState === 'KILLED') {
            console.log('🔴 DEBUG: Setting state lock for KILLED state');
            this.stateLockedToKilled = true;
            this.deathSequenceStarted = true;
        }
        
        super.setState(newState);
        gameContext.deerState = newState; // For legacy access
        
        console.log('🔴 DEBUG: setState completed - this.state:', this.state, 'gameContext.deerState:', gameContext.deerState);

        // Special debug logging for ALERT state
        if (newState === 'ALERT' && oldState !== 'ALERT') {
            this.alertStartTime = gameContext.clock.getElapsedTime(); // Record when deer became alert
            if (!this.hasAlertedPlayer) {
                triggerDeerBlowSound(this); // Trigger deer blow sound immediately
                this.hasAlertedPlayer = true;
            }
        }
        
        // Trigger deer blow sound when fleeing (for close-range spooks that skip ALERT)
        if (newState === 'FLEEING' && oldState !== 'FLEEING') {
            if (!this.hasAlertedPlayer) {
                triggerDeerBlowSound(this); // Trigger deer blow sound for fleeing
                this.hasAlertedPlayer = true;
            }
        }
        
        // Reset alert turn direction when leaving ALERT state
        if (oldState === 'ALERT' && newState !== 'ALERT') {
            this.alertTurnDirection = false;
        }
        
        // Reset alert flag when deer flees or returns to calm states
        if (newState === 'FLEEING' || newState === 'WANDERING' || newState === 'GRAZING') {
            this.hasAlertedPlayer = false; // Reset alert flag for future encounters
        }

        if (newState === 'WANDERING') {
            this.movement.generateNewWanderTarget();
        }
        
        if (newState === 'KILLED') {
        // Start death sequence after state is set
        // CRITICAL FIX: Always start death sequence when entering KILLED state.
        // The conditional check for `deathSequenceInProgress` was causing an intermittent
        // bug where a deer could not be tagged if the flag wasn't reset from a previous
        // deer's death. This ensures the sequence always runs for a killed deer.
        this.startDeathSequence();
    }
        
        // Reset hit flag after state change
        if (newState !== 'WOUNDED' && newState !== 'KILLED') {
            this.wasActuallyHit = false;
        }
        
        // Reset alert turn direction when leaving ALERT state
        if (oldState === 'ALERT' && newState !== 'ALERT') {
            this.alertTurnDirection = false;
            this.hasAlertedPlayer = false; // Reset alert flag
        }
    }

    /**
     * Start the death sequence - sets fallen flag and triggers death animation
     */
    startDeathSequence() {
        console.log('DEBUG: Starting death sequence for deer');
        this.deathSequenceInProgress = true;
        this.fallen = true; // CRITICAL: Set fallen flag so deer can be tagged
        console.log('DEBUG: Deer fallen flag set to:', this.fallen);
        console.log('DEBUG: Deer state:', this.state, 'tagged:', this.tagged);
        
        // Trigger death animation
        if (this.animation) {
            this.animation.startDeathAnimation();
        }
        
        // Play the built-in 'Die' animation if available
        if (this.animations && this.animations['Die']) {
            this.playAnimation('Die');
        }
    }

    respawn() {
        this.fallen = false;
        this.tagged = false; // Reset tagged status for new deer
        
        // CRITICAL FIX: Reset all death-related flags FIRST before calling setState
        // This prevents the setState call from being blocked by state protection logic
        this.stateLockedToKilled = false;
        this.deathSequenceStarted = false;
        this.deathSequenceInProgress = false; // CRITICAL FIX: Reset this flag so death sequence can start again
        this.wasActuallyHit = false;
        this.woundCount = 0; // Reset wound count for new deer

        // Reset model rotation to upright position (fix walking while laying down bug)
        if (this.model) {
            this.model.rotation.x = 0;
            this.model.rotation.z = 0;
            // Keep Y rotation for facing direction
        }

        // Stop all animations and reset state to ensure deer is fully alive
        // Now that state locks are reset, setState should work properly
        this.animation.reset();
        this.setState('WANDERING');
        
        // Get spawn mode from the game context, with 'random' as a default
        const spawnMode = gameContext.deerSpawnMode || 'random';
        
        let x, y, z;
        const worldSize = gameContext.worldConfig?.terrain?.size || 200;
        const maxAttempts = 50; // Maximum attempts to find a safe spawn position
        let attempts = 0;
        let safePosition = null;
        
        // Keep trying until we find a position that doesn't collide with trees
        while (attempts < maxAttempts && !safePosition) {
            attempts++;
            
            if (spawnMode === 'testing') {
                x = gameContext.player.position.x;
                z = gameContext.player.position.z + 20;
                y = gameContext.getHeightAt(x, z);
            } else if (spawnMode === 'near') {
                // Near mode: spawn within reasonable hunting distance of player
                const minDistance = 30; // Minimum distance from player
                const maxDistance = 80; // Maximum distance from player
                const angle = Math.random() * 2 * Math.PI; // Random direction
                const distance = minDistance + Math.random() * (maxDistance - minDistance);
                
                x = gameContext.player.position.x + Math.cos(angle) * distance;
                z = gameContext.player.position.z + Math.sin(angle) * distance;
                
                // Ensure spawn position is within world boundaries
                const boundary = worldSize / 2 - this.config.respawnBoundaryMargin;
                x = Math.max(-boundary, Math.min(boundary, x));
                z = Math.max(-boundary, Math.min(boundary, z));
                
                y = gameContext.getHeightAt(x, z);
            } else {
                // Normal/random mode: spawn randomly across the map
                const margin = 50;
                x = (Math.random() - 0.5) * (worldSize - margin);
                z = (Math.random() - 0.5) * (worldSize - margin);
                y = gameContext.getHeightAt(x, z);
            }
            
            // Check if this position collides with any trees
            const testPosition = new THREE.Vector3(x, y, z);
            const deerRadius = 0.7; // Same radius used in movement collision detection
            
            if (!gameContext.checkTreeCollision || !gameContext.checkTreeCollision(testPosition, deerRadius)) {
                // Safe position found!
                safePosition = testPosition;
            }
        }
        
        // If we couldn't find a safe position after max attempts, use the last position anyway
        // This prevents infinite loops, though it's very unlikely to happen
        if (!safePosition) {
            safePosition = new THREE.Vector3(x, y, z);
        }

        this.spawn(safePosition, Math.PI); // Facing the player
        
        // Play blow sound 10 seconds after new deer spawns, regardless of distance
        // This alerts the player that a new deer has appeared on the map
        setTimeout(() => {
            triggerDeerSpawnBlowSound(this);
        }, 10000); // 10 seconds delay to give player time to prepare
    }

    createTrack() {
        this.effects.createTrack();
    }

    updateTracks() {
        this.effects.updateTracks();
    }

    createBloodDrop() {
        this.effects.createBloodDrop();
    }

    createShotBloodIndicator(hitPosition) {
        this.effects.createShotBloodIndicator(hitPosition);
    }

    updateBloodDrops() {
        this.effects.updateBloodDrops();
    }



    spawn(position, rotationY) {
        // Call parent spawn method first
        super.spawn(position, rotationY);
        

    }

    createVitals(parent) {
        console.log('DEBUG: Creating deer vitals hitbox, parent:', parent);
        this.hitbox.createVitals(parent);
        console.log('DEBUG: After hitbox creation - vitals:', !!this.model.vitals, 'gut:', !!this.model.gut, 'rear:', !!this.model.rear);
    }
    
    createSimpleVitalsHitbox() {
        this.hitbox.createSimpleVitalsHitbox();
    }

    update(delta) {
        if (!this.isModelLoaded) return;

        // CRITICAL: Handle KILLED state first - prevent any other logic from running
        if (this.state === 'KILLED' || this.stateLockedToKilled) {
            if (this.stateLockedToKilled && this.state !== 'KILLED') {
                this.state = 'KILLED';
                gameContext.deerState = 'KILLED';
            }
            this.model.position.y = gameContext.getHeightAt(this.model.position.x, this.model.position.z) + this.config.heightOffset;
            this.stateTimer += delta;
            if (this.mixer) {
                this.mixer.update(delta);
            }
            this.animation.update(delta);
            return; // Exit immediately
        }

        super.update(delta);

        if (this.state === 'KILLED') return;

        updateDeerAudio(this, delta);

        if ((this.state === 'WOUNDED' || this.state === 'FLEEING') && gameContext.huntLog && gameContext.huntLog.deerInitialPosition) {
            const currentDistance = gameContext.huntLog.deerInitialPosition.distanceTo(this.model.position);
            gameContext.huntLog.distanceTrailed = Math.max(gameContext.huntLog.distanceTrailed, currentDistance);
        }

        this.timeSinceLastDrink += delta;
        this.effects.update();
        this.animation.update(delta);

        const distanceToPlayer = this.model.position.distanceTo(gameContext.player.position);
        const playerVisible = this.isPlayerVisible();
        const currentPlayerPosition = gameContext.player.position.clone();
        const playerMoved = this.lastPlayerPosition.distanceTo(currentPlayerPosition) > this.MOVEMENT_DISTANCE_THRESHOLD;

        if (playerVisible) {
            if (playerMoved) {
                this.movementSampleCount++;
                if (!this.isTrackingPlayerMovement && this.movementSampleCount >= this.REQUIRED_MOVEMENT_SAMPLES) {
                    this.isTrackingPlayerMovement = true;
                    this.playerMovementStartTime = gameContext.clock.getElapsedTime();
                    this.hasDetectedMovingPlayer = false;
                } else if (this.isTrackingPlayerMovement) {
                    const movementDuration = gameContext.clock.getElapsedTime() - this.playerMovementStartTime;
                    if (movementDuration >= this.MOVEMENT_DETECTION_THRESHOLD && !this.hasDetectedMovingPlayer) {
                        this.hasDetectedMovingPlayer = true;
                    }
                }
            } else {
                this.movementSampleCount = Math.max(0, this.movementSampleCount - 1);
                if (this.movementSampleCount === 0 && this.isTrackingPlayerMovement) {
                    this.isTrackingPlayerMovement = false;
                    this.hasDetectedMovingPlayer = false;
                }
            }
        } else {
            if (this.isTrackingPlayerMovement) {
                this.isTrackingPlayerMovement = false;
                this.hasDetectedMovingPlayer = false;
            }
            this.movementSampleCount = 0;
        }

        this.lastPlayerPosition.copy(currentPlayerPosition);

        if (this.state !== 'FLEEING' && this.state !== 'WOUNDED' && this.state !== 'KILLED') {
            const currentTime = gameContext.clock.getElapsedTime();
            const inAlertDelay = this.state === 'ALERT' && (currentTime - this.alertStartTime < this.alertMovementDelay);
            if (playerVisible && this.hasDetectedMovingPlayer && distanceToPlayer < this.config.fleeDistanceThreshold && this.fleeingEnabled && !inAlertDelay) {
                this.setState('FLEEING');
            } else if (playerVisible && this.hasDetectedMovingPlayer && distanceToPlayer < this.config.alertDistanceThreshold) {
                if (this.state !== 'ALERT') {
                    this.setState('ALERT');
                }
            } else if (this.state === 'ALERT' && !playerVisible) {
                this.setState('IDLE');
            }
        }

        let speed = 0;

        switch (this.state) {
            case 'IDLE':
                speed = 0;
                if (this.timeSinceLastDrink > 30) {
                    this.setState('THIRSTY');
                } else {
                    this.setState(Math.random() < 0.4 ? 'GRAZING' : 'WANDERING'); // 40% chance to graze, 60% to wander
                }
                break;
            case 'WANDERING':
                speed = this.config.speeds.wandering * delta;
                if (this.timeSinceLastDrink > 30) {
                    this.setState('THIRSTY');
                } else {
                    this.setState(Math.random() < 0.4 ? 'GRAZING' : 'WANDERING'); // 40% chance to graze, 60% to wander
                }
                if (this.model.position.distanceTo(this.movement.getWanderTarget()) < this.config.wanderTargetReachThreshold) {
                    this.setState(Math.random() < 0.4 ? 'GRAZING' : 'WANDERING'); // 40% chance to graze, 60% to wander
                } else {
                    this.movement.smoothRotateTowards(this.movement.getWanderTarget(), delta);
                    this.movement.moveWithCollisionDetection(speed); // Move while rotating towards target
                }
                break;
            case 'THIRSTY':
                speed = this.config.speeds.thirsty * delta;
                
                // Find closest water source from gameContext.waterBodies
                let closestWater = null;
                let closestDistance = Infinity;
                
                if (gameContext.waterBodies && gameContext.waterBodies.length > 0) {
                    for (const waterBody of gameContext.waterBodies) {
                        const distance = this.model.position.distanceTo(waterBody.position);
                        if (distance < closestDistance) {
                            closestDistance = distance;
                            closestWater = waterBody.position;
                        }
                    }
                }
                
                if (closestWater) {
                    if (this.model.position.distanceTo(closestWater) < 10) {
                        this.setState('DRINKING');
                    } else {
                        this.movement.smoothRotateTowards(closestWater, delta);
                        this.movement.moveWithCollisionDetection(speed); // Move while rotating towards water
                    }
                } else {
                    this.setState('WANDERING'); // No water found
                }
                break;
            case 'GRAZING':
                // Deer should be completely stationary while grazing
                speed = 0;
                if (this.stateTimer > this.config.stateTimers.grazing) {
                    this.setState('WANDERING');
                }
                break;
            case 'DRINKING':
                // Deer should be completely stationary while drinking
                speed = 0;
                if (this.stateTimer > this.config.stateTimers.drinking) {
                    this.timeSinceLastDrink = 0;
                    this.setState('WANDERING');
                }
                break;
            case 'ALERT':
                speed = 0;
                
                // Turn counterclockwise (left) when alert instead of toward player
                if (!this.alertTurnDirection) {
                    // Calculate counterclockwise direction (90 degrees left from current facing)
                    const currentRotation = this.model.rotation.y;
                    this.alertTargetRotation = currentRotation + Math.PI / 2; // 90 degrees counterclockwise
                    this.alertTurnDirection = true;
                }
                
                // Smoothly rotate counterclockwise
                const rotationSpeed = this.config.rotationSpeed * delta;
                const rotationDiff = this.alertTargetRotation - this.model.rotation.y;
                
                if (Math.abs(rotationDiff) > 0.1) {
                    this.model.rotation.y += Math.sign(rotationDiff) * Math.min(Math.abs(rotationDiff), rotationSpeed);
                }
                break;
            case 'FLEEING':
                speed = this.config.speeds.fleeing * delta;
                const fleeDirFromPlayer = new THREE.Vector3().subVectors(this.model.position, gameContext.player.position).normalize();
                this.movement.smoothRotateTowards(new THREE.Vector3().addVectors(this.model.position, fleeDirFromPlayer), delta);
                this.movement.moveWithCollisionDetection(speed); // Move while rotating away from player
                if (this.stateTimer > this.config.stateTimers.fleeing) this.setState('WANDERING');
                break;
            case 'WOUNDED':
                speed = this.config.speeds.wounded * delta;
                
                // Initialize wounded flee direction if not set
                if (!this.woundedFleeDirection) {
                    this.woundedFleeDirection = new THREE.Vector3().subVectors(this.model.position, gameContext.player.position).normalize();
                }
                
                // Only recalculate direction occasionally, not every frame
                if (!this.lastWoundedDirectionUpdate || gameContext.clock.getElapsedTime() - this.lastWoundedDirectionUpdate > 0.5) {
                    // Calculate basic flee direction away from player
                    const newFleeDir = new THREE.Vector3().subVectors(this.model.position, gameContext.player.position).normalize();
                    
                    // Check if fleeing in this direction would take deer too close to world boundary
                    const worldSize = gameContext.terrain.geometry.parameters.width;
                    const boundary = worldSize / 2 - this.config.worldBoundaryMargin;
                    const safeBoundary = boundary * 0.8; // Stay well within safe zone
                    
                    // Calculate where deer would be if it moved in flee direction
                    const testPosition = new THREE.Vector3().addVectors(this.model.position, newFleeDir.clone().multiplyScalar(50));
                    
                    // If flee direction would take deer too close to boundary, adjust direction
                    let adjustedFleeDir = newFleeDir.clone();
                    if (Math.abs(testPosition.x) > safeBoundary || Math.abs(testPosition.z) > safeBoundary) {
                        // Instead of blending with center direction (which could point toward hunter),
                        // find a safe tangential direction that keeps deer away from both boundary and hunter
                        const safeDirections = [];
                        
                        // Test 8 directions around the deer (45-degree increments)
                        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                            const testDir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
                            const testPos = new THREE.Vector3().addVectors(this.model.position, testDir.clone().multiplyScalar(50));
                            
                            // Check if this direction keeps deer within safe boundaries
                            if (Math.abs(testPos.x) <= safeBoundary && Math.abs(testPos.z) <= safeBoundary) {
                                // Check if this direction keeps deer away from hunter (not toward hunter)
                                const dirToHunter = new THREE.Vector3().subVectors(gameContext.player.position, this.model.position).normalize();
                                const dotProduct = testDir.dot(dirToHunter);
                                
                                // Only consider directions that don't point toward hunter (dot product < 0.3)
                                if (dotProduct < 0.3) {
                                    safeDirections.push({
                                        direction: testDir,
                                        awayFromHunter: -dotProduct, // Higher is better (more away from hunter)
                                        similarity: testDir.dot(newFleeDir) // How similar to original flee direction
                                    });
                                }
                            }
                        }
                        
                        if (safeDirections.length > 0) {
                            // Choose the direction that's most away from hunter and similar to original flee direction
                            safeDirections.sort((a, b) => (b.awayFromHunter + b.similarity * 0.5) - (a.awayFromHunter + a.similarity * 0.5));
                            adjustedFleeDir = safeDirections[0].direction.clone();
                        } else {
                            // Fallback: use perpendicular direction to hunter-deer line
                            const hunterToDeer = new THREE.Vector3().subVectors(this.model.position, gameContext.player.position).normalize();
                            adjustedFleeDir = new THREE.Vector3(-hunterToDeer.z, 0, hunterToDeer.x).normalize();
                        }
                    }
                    
                    // Smoothly transition to new direction instead of abrupt change
                    this.woundedFleeDirection.lerp(adjustedFleeDir, 0.1); // Very gradual direction change
                    this.woundedFleeDirection.normalize();
                    
                    this.lastWoundedDirectionUpdate = gameContext.clock.getElapsedTime();
                }
                
                // Use the persistent flee direction
                const targetPosition = new THREE.Vector3().addVectors(this.model.position, this.woundedFleeDirection);
                this.movement.smoothRotateTowards(targetPosition, delta);
                this.movement.moveWithCollisionDetection(speed);
                
                const currentTime = gameContext.clock.getElapsedTime();
                if (this.effects.shouldCreateBloodDrop()) {
                    this.effects.createBloodDrop();
                }
                break;
            case 'KILLED':
                speed = 0;
                break;
        }

        // Store movement speed for animation decisions
        this.movementSpeed = speed / delta; // Convert back to units per second
        this.currentSpeed = this.movementSpeed;

        // Animation handling is now delegated to the animation system
        // which is updated above in this.animation.update(delta)

        // --- Boundary Checking ---
        const worldSize = gameContext.terrain.geometry.parameters.width;
        const boundary = worldSize / 2 - this.config.worldBoundaryMargin;
        
        let wasOutsideBoundary = false;
        let needsBoundaryEscape = false;
        
        if (this.model.position.x > boundary) {
            // Use collision-safe position adjustment instead of direct assignment
            const safeX = this.findSafePositionNearBoundary(boundary, this.model.position.z, 'x');
            this.model.position.x = safeX;
            wasOutsideBoundary = true;
            needsBoundaryEscape = true;
        } else if (this.model.position.x < -boundary) {
            // Use collision-safe position adjustment instead of direct assignment
            const safeX = this.findSafePositionNearBoundary(-boundary, this.model.position.z, 'x');
            this.model.position.x = safeX;
            wasOutsideBoundary = true;
            needsBoundaryEscape = true;
        }
        
        if (this.model.position.z > boundary) {
            // Use collision-safe position adjustment instead of direct assignment
            const safeZ = this.findSafePositionNearBoundary(boundary, this.model.position.x, 'z');
            this.model.position.z = safeZ;
            wasOutsideBoundary = true;
            needsBoundaryEscape = true;
        } else if (this.model.position.z < -boundary) {
            // Use collision-safe position adjustment instead of direct assignment
            const safeZ = this.findSafePositionNearBoundary(-boundary, this.model.position.x, 'z');
            this.model.position.z = safeZ;
            wasOutsideBoundary = true;
            needsBoundaryEscape = true;
        }
        
        if (needsBoundaryEscape) {
            // Force deer to face toward center of world to escape boundary
            const centerDirection = new THREE.Vector3(0, 0, 0).sub(this.model.position).normalize();
            const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(
                new THREE.Vector3(0, 0, 1),
                centerDirection
            );
            
            // Apply immediate rotation toward center (50% of the way)
            this.model.quaternion.slerp(targetQuaternion, 0.5);
            
            // CRITICAL: Override wounded deer's persistent direction when hitting boundary
            if (this.state === 'WOUNDED') {
                // Force wounded deer to flee toward center, overriding persistent direction
                this.woundedFleeDirection = centerDirection.clone();
                this.lastWoundedDirectionUpdate = gameContext.clock.getElapsedTime();
            }
            
            // Generate a new wander target closer to center
            const escapeDistance = 50; // Move at least 30% toward center
            this.movement.generateNewWanderTarget();
            
            // Ensure the new target is well within boundaries
            const safeBoundary = boundary * 0.8; // Use 80% of boundary for safety
            const wanderTarget = this.movement.getWanderTarget();
            wanderTarget.x = Math.max(-safeBoundary, Math.min(safeBoundary, wanderTarget.x));
            wanderTarget.z = Math.max(-safeBoundary, Math.min(safeBoundary, wanderTarget.z));
        } else if (wasOutsideBoundary) {
            // Just generate a new target if we were outside but didn't need escape
            this.movement.generateNewWanderTarget();
        }

        // Stuck detection - only for states where deer should be moving
        const currentTime = gameContext.clock.getElapsedTime();
        if (currentTime - this.lastStuckCheckTime > this.stuckCheckInterval) {
            this.lastStuckCheckTime = currentTime;
            
            // Only check stuck detection for states where deer should be actively moving
            // Exclude natural stationary states: GRAZING, DRINKING, IDLE, ALERT, KILLED
            const shouldBeMovingStates = ['WANDERING', 'FLEEING', 'WOUNDED'];
            const shouldCheckForStuck = shouldBeMovingStates.includes(this.state);
            
            // Only check if we have enough history AND deer should be moving
            if (this.stuckDetectionHistory.length > 0 && shouldCheckForStuck) {
                const oldestPosition = this.stuckDetectionHistory[0];
                const distanceSinceLastCheck = this.model.position.distanceTo(oldestPosition);
                
                // Check if deer is in a moving animation (Walk or Run) but not actually moving
                const isInMovingAnimation = this.animation.isInMovingAnimation();
                
                // Enhanced stuck detection - check multiple conditions:
                // 1. Deer is in moving animation but not moving (original logic)
                // 2. Deer is WANDERING but can't reach its wander target for extended time
                // 3. Deer is FLEEING but not moving much (trapped while trying to escape)
                const isWanderingButStuck = this.state === 'WANDERING' && 
                    this.model.position.distanceTo(this.movement.getWanderTarget()) > this.config.wanderTargetReachThreshold &&
                    distanceSinceLastCheck < this.stuckThreshold;
                
                const isFleeingButStuck = this.state === 'FLEEING' && distanceSinceLastCheck < this.stuckThreshold;
                
                // Consider deer "stuck" if any of these conditions are met:
                if ((isInMovingAnimation && distanceSinceLastCheck < this.stuckThreshold) || 
                    isWanderingButStuck || 
                    isFleeingButStuck) {
                    // Deer is stuck - activate emergency escape
                    this.consecutiveStuckChecks++;
                    if (this.consecutiveStuckChecks >= this.requiredStuckChecks) {
                        this.emergencyEscapeActive = true;
                    }
                } else {
                    // Deer is not stuck - reset emergency escape
                    this.consecutiveStuckChecks = 0;
                    this.emergencyEscapeActive = false;
                }
            } else if (!shouldCheckForStuck) {
                // Deer is in a stationary state - reset stuck detection counters
                this.consecutiveStuckChecks = 0;
                this.emergencyEscapeActive = false;
            }
        }

        // Emergency escape
        if (this.emergencyEscapeActive) {
            // Clear stuck detection history immediately to prevent re-triggering
            this.stuckDetectionHistory = [];
            
            // Try to find a safe position by testing fewer directions for better performance
            const testDirections = [
                new THREE.Vector3(1, 0, 0),   // East
                new THREE.Vector3(-1, 0, 0),  // West
                new THREE.Vector3(0, 0, 1),   // North
                new THREE.Vector3(0, 0, -1)   // South
                // Removed diagonal directions to reduce collision checks from 8 to 4
            ];
            
            let foundSafePosition = false;
            const escapeDistance = 2.0; // Reduced from 3.0 - less aggressive teleportation
            
            for (const direction of testDirections) {
                // Test movement in this direction
                const testPosition = this.model.position.clone().add(direction.clone().multiplyScalar(escapeDistance));
                
                // Check if this position is safe (no tree collision and within boundaries)
                const boundary = gameContext.worldSize / 2 - 10;
                const withinBounds = Math.abs(testPosition.x) < boundary && Math.abs(testPosition.z) < boundary;
                const noTreeCollision = !gameContext.checkTreeCollision(testPosition, 0.7);
                
                if (withinBounds && noTreeCollision) {
                    // This direction is clear - move there and rotate toward it
                    const moveDirection = direction.clone().multiplyScalar(escapeDistance * 0.5); // Move half the distance
                    this.model.position.add(moveDirection);
                    this.model.position.y = gameContext.getHeightAt(this.model.position.x, this.model.position.z) + this.heightOffset;
                    
                    // Generate a new wander target in a safe direction
                    this.movement.generateNewWanderTarget();
                    
                    foundSafePosition = true;
                    this.emergencyEscapeActive = false;
                    this.consecutiveStuckChecks = 0; // Reset stuck counter
                    break;
                }
            }
            
            // If no safe position found, try moving toward world center (less aggressive)
            if (!foundSafePosition) {
                const centerDirection = new THREE.Vector3(0, 0, 0).sub(this.model.position).normalize();
                const centerMove = centerDirection.multiplyScalar(1.0); // Smaller movement toward center
                
                this.model.position.add(centerMove);
                this.model.position.y = gameContext.getHeightAt(this.model.position.x, this.model.position.z) + this.heightOffset;
                this.movement.generateNewWanderTarget();
                
                this.emergencyEscapeActive = false;
                this.consecutiveStuckChecks = 0; // Reset stuck counter
            }
        }

        // Enhanced movement detection
        const distanceMoved = this.model.position.distanceTo(this.movement.lastPosition);
        const movementThreshold = 0.05;
        
        // For stationary states, clear movement history to ensure proper animation
        if (this.state === 'IDLE' || this.state === 'KILLED') {
            this.movement.clearMovementHistory();
        } else {
            // Update movement history for moving states
            this.movement.updateMovementHistory(distanceMoved);
        }

        // Create tracks when deer is moving
        if (this.movement.getIsMoving()) {
            this.effects.createTrack();
        }

        // Update last position for next frame
        this.movement.lastPosition.copy(this.model.position);

        // CRITICAL FIX: Track position history for stuck detection
        // Add current position to stuck detection history
        this.stuckDetectionHistory.push(this.model.position.clone());
        
        // Maintain history size limit
        if (this.stuckDetectionHistory.length > this.stuckDetectionMaxHistory) {
            this.stuckDetectionHistory.shift(); // Remove oldest position
        }
    }

    loadModel(path) {
        super.loadModel(path);
    }
    
    /**
     * Find a safe position near the world boundary that doesn't collide with trees
     * @param {number} boundaryValue - The boundary coordinate value
     * @param {number} otherCoordinate - The other coordinate (x if finding safe z, z if finding safe x)
     * @param {string} axis - 'x' or 'z' to indicate which axis we're finding a safe position for
     * @returns {number} Safe coordinate value
     */
    findSafePositionNearBoundary(boundaryValue, otherCoordinate, axis) {
        const testRadius = 0.7; // Same radius used in collision detection
        const maxAttempts = 10;
        const stepSize = 2.0; // Try positions 2 units apart
        
        // Start from the boundary and work inward
        for (let i = 0; i < maxAttempts; i++) {
            const offset = i * stepSize;
            const testValue = boundaryValue > 0 ? boundaryValue - offset : boundaryValue + offset;
            
            // Create test position
            const testPosition = new THREE.Vector3();
            if (axis === 'x') {
                testPosition.set(testValue, this.model.position.y, otherCoordinate);
            } else {
                testPosition.set(otherCoordinate, this.model.position.y, testValue);
            }
            
            // Check if this position is safe (no tree collision)
            if (!gameContext.checkTreeCollision(testPosition, testRadius)) {
                return testValue;
            }
        }
        
        // If no safe position found, return a position well inside the boundary
        const safeOffset = 10; // 10 units inside boundary
        return boundaryValue > 0 ? boundaryValue - safeOffset : boundaryValue + safeOffset;
    }

    /**
     * Check if the player is visible to the deer (not concealed by trees or bushes)
     * Uses state-dependent frequency and event-driven checks for optimal performance
     * @returns {boolean} True if player is visible, false if concealed
     */
    isPlayerVisible() {
        if (!gameContext.player || !gameContext.trees) return true;
        
        const currentTime = gameContext.clock.getElapsedTime();

        const isKneeling = gameContext.playerControls?.isKneeling || false;
        let distanceToPlayer = this.model.position.distanceTo(gameContext.player.position);

        // Apply stealth bonus for kneeling
        if (isKneeling) {
            distanceToPlayer *= 1.3; // Player appears 30% further away when kneeling
        }
        
        // Skip visibility checks entirely if player is very far away (beyond detection range)
        if (distanceToPlayer > 150) {
            this.cachedVisibility = false;
            this.lastVisibilityCheck = currentTime;
            return false;
        }
        
        // Determine check frequency based on deer state (realistic behavior)
        let checkInterval;
        switch (this.state) {
            case 'ALERT':
                checkInterval = 0.3; // Alert deer check more frequently
                break;
            case 'FLEEING':
            case 'WOUNDED':
                checkInterval = 0.5; // Fleeing deer check moderately often
                break;
            case 'GRAZING':
            case 'DRINKING':
                checkInterval = 2.0; // Focused deer check infrequently
                break;
            case 'IDLE':
            case 'WANDERING':
            default:
                checkInterval = 1.0; // Normal scanning frequency
                break;
        }
        
        // Only perform expensive raycast if enough time has passed
        if (this.lastVisibilityCheck && currentTime - this.lastVisibilityCheck < checkInterval) {
            return this.cachedVisibility !== undefined ? this.cachedVisibility : true;
        }
        
        // Quick distance check - if player is very close, assume visible (no trees can hide at close range)
        if (distanceToPlayer < 8) {
            this.cachedVisibility = true;
            this.lastVisibilityCheck = currentTime;
            return true;
        }
        
        // Event-driven check: Only do expensive raycast if player has moved significantly since last check
        const currentPlayerPosition = gameContext.player.position.clone();
        if (this.lastPlayerPositionForVisibility) {
            const playerMovedDistance = this.lastPlayerPositionForVisibility.distanceTo(currentPlayerPosition);
            // If player hasn't moved much, return cached result
            if (playerMovedDistance < 2.0 && this.cachedVisibility !== undefined) {
                this.lastVisibilityCheck = currentTime; // Update check time but keep cached result
                return this.cachedVisibility;
            }
        }
        
        // Store player position for next movement check
        this.lastPlayerPositionForVisibility = currentPlayerPosition.clone();
        
        // Perform the expensive raycast visibility check
        const deerPosition = this.model.position.clone();
        const playerPosition = currentPlayerPosition.clone();
        
        // Adjust positions to eye level for more realistic line of sight
        deerPosition.y += 1.5; // Deer eye height
        playerPosition.y += isKneeling ? 0.9 : 1.7; // Lower player eye height when kneeling
        
        const direction = new THREE.Vector3().subVectors(playerPosition, deerPosition).normalize();
        
        // Use shared raycaster from gameContext to avoid creating new objects
        gameContext.raycaster.set(deerPosition, direction);
        gameContext.raycaster.far = distanceToPlayer; // Only check up to player distance
        
        // PERFORMANCE OPTIMIZATION: Only check nearby trees that could realistically block
        const nearbyTrees = [];
        const MAX_TREES_TO_CHECK = 12; // Reduced from 15
        
        if (gameContext.trees && gameContext.trees.children) {
            // Find trees that are roughly between deer and player
            for (const tree of gameContext.trees.children) {
                const treeDistance = deerPosition.distanceTo(tree.position);
                if (treeDistance < distanceToPlayer + 3) { // Reduced search radius
                    nearbyTrees.push(tree);
                    if (nearbyTrees.length >= MAX_TREES_TO_CHECK) break;
                }
            }
        }
        
        // Check for intersections with nearby trees only
        const intersects = gameContext.raycaster.intersectObjects(nearbyTrees, true);
        
        // Filter out intersections that are beyond the player
        const blockingIntersects = intersects.filter(intersect => intersect.distance < distanceToPlayer - 0.5);
        
        // Cache the result
        this.cachedVisibility = blockingIntersects.length === 0;
        this.lastVisibilityCheck = currentTime;
        
        // Player is visible if no trees are blocking the line of sight
        return this.cachedVisibility;
    }
}

function forceDeerRespawn() {
    if (gameContext.deer) {
        gameContext.deer.respawn();
    }
}

export const deer = new Deer();
