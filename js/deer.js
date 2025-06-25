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
    }

    setState(newState) {
        const oldState = this.state;
        
        // Critical bug fix: Prevent any state changes if deer is locked in KILLED state
        if (this.stateLockedToKilled && newState !== 'KILLED') {
            return;
        }
        
        // Also prevent transitions OUT of KILLED state once it's been set
        // EXCEPTION: Allow transitions during respawn when stateLockedToKilled is explicitly false
        if (this.state === 'KILLED' && newState !== 'KILLED' && this.stateLockedToKilled === true) {
            return;
        }
        
        // Critical bug fix: Set state lock BEFORE entering KILLED state to prevent race conditions
        if (newState === 'KILLED') {
            // Only allow KILLED state if deer was actually hit
            if (!this.wasActuallyHit) {
                return; // Block invalid transition to KILLED
            }
            
            // Set state lock BEFORE entering KILLED state to prevent immediate transitions out
            if (!this.deathSequenceStarted) {
                this.stateLockedToKilled = true;
                this.deathSequenceStarted = true;
            }
        }
        
        super.setState(newState);
        gameContext.deerState = newState; // For legacy access

        // Special debug logging for ALERT state
        if (newState === 'ALERT' && oldState !== 'ALERT') {
            this.alertStartTime = gameContext.clock.getElapsedTime(); // Record when deer became alert
            if (!this.hasAlertedPlayer) {
                triggerDeerBlowSound(this); // Trigger deer blow sound immediately
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
            if (this.deathSequenceStarted && !this.deathSequenceInProgress) {
                this.startDeathSequence();
            }
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
        this.deathSequenceInProgress = true;
        this.fallen = true; // CRITICAL: Set fallen flag so deer can be tagged
        
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

    updateHitboxes() {
        this.hitbox.updateHitboxes();
    }

    spawn(position, rotationY) {
        // Call parent spawn method first
        super.spawn(position, rotationY);
        
        // Now update hitbox positions if they exist
        this.hitbox.updateHitboxes();
    }

    createVitals(parent) {
        this.hitbox.createVitals(parent);
    }
    
    createSimpleVitalsHitbox() {
        this.hitbox.createSimpleVitalsHitbox();
    }

    update(delta) {
        if (!this.isModelLoaded) return;

        // CRITICAL: Handle KILLED state first - prevent any other logic from running
        // This must be the first check to prevent state transitions out of KILLED
        if (this.state === 'KILLED' || this.stateLockedToKilled) {
            // Force state to KILLED if locked (in case something tried to change it)
            if (this.stateLockedToKilled && this.state !== 'KILLED') {
                this.state = 'KILLED';
                gameContext.deerState = 'KILLED';
            }
            
            // Only update position based on terrain height (no movement, no AI)
            this.model.position.y = gameContext.getHeightAt(this.model.position.x, this.model.position.z) + this.config.heightOffset;
            
            // Update state timer for death sequence timing
            this.stateTimer += delta;
            
            // Allow animation mixer to run for death animation
            if (this.mixer) {
                this.mixer.update(delta);
            }
            
            // Update animation system to handle death animation properly
            this.animation.update(delta);
            
            return; // Exit immediately - no other logic should run
        }

        // Always call super.update for proper height positioning, even when dead
        super.update(delta);

        // Only continue with AI behavior if deer is alive
        if (this.state === 'KILLED') return;
        
        // Update spatial audio for this deer
        updateDeerAudio(this, delta);

        // Track deer movement distance for journal when wounded or fleeing
        if ((this.state === 'WOUNDED' || this.state === 'FLEEING') && gameContext.huntLog && gameContext.huntLog.deerInitialPosition) {
            const currentDistance = gameContext.huntLog.deerInitialPosition.distanceTo(this.model.position);
            gameContext.huntLog.distanceTrailed = Math.max(gameContext.huntLog.distanceTrailed, currentDistance);
        }

        this.timeSinceLastDrink += delta;

        this.effects.update();

        this.animation.update(delta);

        let speed = 0;
        let legAnimationSpeed = this.animation.getLegAnimationSpeed();

        const distanceToPlayer = this.model.position.distanceTo(gameContext.player.position);

        // Check if player is visible (not concealed by trees or bushes)
        const playerVisible = this.isPlayerVisible();

        // Track player movement for detection logic
        const currentPlayerPosition = gameContext.player.position.clone();
        const playerMoved = this.lastPlayerPosition.distanceTo(currentPlayerPosition) > this.MOVEMENT_DISTANCE_THRESHOLD;
        
        if (playerVisible) {
            if (playerMoved) {
                // Player is moving - increment sample count
                this.movementSampleCount++;
                
                if (!this.isTrackingPlayerMovement && this.movementSampleCount >= this.REQUIRED_MOVEMENT_SAMPLES) {
                    // Start tracking movement after enough consecutive movement samples
                    this.isTrackingPlayerMovement = true;
                    this.playerMovementStartTime = gameContext.clock.getElapsedTime();
                    this.hasDetectedMovingPlayer = false;
                } else if (this.isTrackingPlayerMovement) {
                    // Continue tracking - check if player has been moving long enough
                    const movementDuration = gameContext.clock.getElapsedTime() - this.playerMovementStartTime;
                    if (movementDuration >= this.MOVEMENT_DETECTION_THRESHOLD && !this.hasDetectedMovingPlayer) {
                        this.hasDetectedMovingPlayer = true;
                    }
                }
            } else {
                // Player is not moving - reset movement sample count
                this.movementSampleCount = Math.max(0, this.movementSampleCount - 1);
                
                if (this.movementSampleCount === 0 && this.isTrackingPlayerMovement) {
                    // Player has stopped moving - reset tracking
                    this.isTrackingPlayerMovement = false;
                    this.hasDetectedMovingPlayer = false;
                }
            }
        } else {
            // Player is not visible - reset everything
            if (this.isTrackingPlayerMovement) {
                this.isTrackingPlayerMovement = false;
                this.hasDetectedMovingPlayer = false;
            }
            this.movementSampleCount = 0;
        }
        
        // Update last player position for next frame (AFTER movement detection)
        this.lastPlayerPosition.copy(currentPlayerPosition);

        // Only react to player if they are visible AND have been detected moving for 2 seconds
        if (this.state !== 'FLEEING' && this.state !== 'WOUNDED' && this.state !== 'KILLED') {
            // Check if deer is in alert delay period
            const currentTime = gameContext.clock.getElapsedTime();
            const inAlertDelay = this.state === 'ALERT' && (currentTime - this.alertStartTime < this.alertMovementDelay);
            
            if (playerVisible && this.hasDetectedMovingPlayer && distanceToPlayer < this.config.fleeDistanceThreshold && this.fleeingEnabled && !inAlertDelay) {
                this.setState('FLEEING');
            } else if (playerVisible && this.hasDetectedMovingPlayer && distanceToPlayer < this.config.alertDistanceThreshold) {
                if (this.state !== 'ALERT') {
                    this.setState('ALERT');
                }
            } else if (this.state === 'ALERT' && (!playerVisible || !this.hasDetectedMovingPlayer || distanceToPlayer >= this.config.alertDistanceThreshold)) {
                // Only allow transition out of ALERT if not in delay period
                if (!inAlertDelay) {
                    this.setState('WANDERING');
                }
            }
        }

        switch (this.state) {
            case 'IDLE':
                speed = 0;
                if (this.stateTimer > 1.0) { // Wait 1 second, then start normal behavior
                    this.setState(Math.random() < 0.6 ? 'GRAZING' : 'WANDERING'); // 60% chance to graze
                }
                break;
            case 'WANDERING':
                speed = this.config.speeds.wandering * delta;
                if (this.model.position.distanceTo(this.movement.getWanderTarget()) < this.config.wanderTargetReachThreshold) {
                    this.setState(Math.random() < 0.6 ? 'GRAZING' : 'WANDERING'); // 60% chance to graze
                } else {
                    this.movement.smoothRotateTowards(this.movement.getWanderTarget(), delta);
                    this.movement.moveWithCollisionDetection(speed); // Move while rotating towards target
                }
                break;
            case 'THIRSTY':
                speed = this.config.speeds.thirsty * delta;
                const waterSource = gameContext.findClosestWaterSource(this.model.position);
                if (waterSource) {
                    if (this.model.position.distanceTo(waterSource) < 10) {
                        this.setState('DRINKING');
                    } else {
                        this.movement.smoothRotateTowards(waterSource, delta);
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
                const woundFleeDir = new THREE.Vector3().subVectors(this.model.position, gameContext.player.position).normalize();
                this.movement.smoothRotateTowards(new THREE.Vector3().addVectors(this.model.position, woundFleeDir), delta);
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
            this.model.position.x = boundary;
            wasOutsideBoundary = true;
            needsBoundaryEscape = true;
        } else if (this.model.position.x < -boundary) {
            this.model.position.x = -boundary;
            wasOutsideBoundary = true;
            needsBoundaryEscape = true;
        }
        
        if (this.model.position.z > boundary) {
            this.model.position.z = boundary;
            wasOutsideBoundary = true;
            needsBoundaryEscape = true;
        } else if (this.model.position.z < -boundary) {
            this.model.position.z = -boundary;
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

        // Stuck detection
        const currentTime = gameContext.clock.getElapsedTime();
        if (currentTime - this.lastStuckCheckTime > this.stuckCheckInterval) {
            this.lastStuckCheckTime = currentTime;
            
            // Only check if we have enough history
            if (this.stuckDetectionHistory.length > 0) {
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

        // moveWithCollisionDetection(speed);
    }

    loadModel(path) {
        super.loadModel(path);
    }
    
    /**
     * Check if the player is visible to the deer (not concealed by trees or bushes)
     * Uses raycasting to detect obstacles between deer and player
     * @returns {boolean} True if player is visible, false if concealed
     */
    isPlayerVisible() {
        if (!gameContext.player || !gameContext.trees) return true;
        
        // Performance optimization: Only check visibility every few frames
        const currentTime = gameContext.clock.getElapsedTime();
        if (!this.lastVisibilityCheck || currentTime - this.lastVisibilityCheck < 0.1) {
            // Return cached result if checked recently (within 100ms)
            return this.cachedVisibility !== undefined ? this.cachedVisibility : true;
        }
        
        // Create a ray from deer to player
        const deerPosition = this.model.position.clone();
        const playerPosition = gameContext.player.position.clone();
        
        // Quick distance check - if player is very close, assume visible
        const distance = deerPosition.distanceTo(playerPosition);
        if (distance < 5) {
            this.cachedVisibility = true;
            this.lastVisibilityCheck = currentTime;
            return true;
        }
        
        // Adjust positions to eye level for more realistic line of sight
        deerPosition.y += 1.5; // Deer eye height
        playerPosition.y += 1.7; // Player eye height
        
        const direction = new THREE.Vector3().subVectors(playerPosition, deerPosition).normalize();
        
        // Use shared raycaster from gameContext to avoid creating new objects
        gameContext.raycaster.set(deerPosition, direction);
        gameContext.raycaster.far = distance; // Only check up to player distance
        
        // PERFORMANCE OPTIMIZATION: Only check nearby trees instead of all trees
        const nearbyTrees = [];
        const MAX_TREES_TO_CHECK = 15; // Limit raycasting to nearby trees only
        
        if (gameContext.trees && gameContext.trees.children) {
            // Find trees that are roughly between deer and player
            for (const tree of gameContext.trees.children) {
                const treeDistance = deerPosition.distanceTo(tree.position);
                if (treeDistance < distance + 5) { // Only check trees that could potentially block
                    nearbyTrees.push(tree);
                    if (nearbyTrees.length >= MAX_TREES_TO_CHECK) break;
                }
            }
        }
        
        // Check for intersections with nearby trees only
        const intersects = gameContext.raycaster.intersectObjects(nearbyTrees, true);
        
        // Filter out intersections that are beyond the player
        const blockingIntersects = intersects.filter(intersect => intersect.distance < distance - 0.5);
        
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
