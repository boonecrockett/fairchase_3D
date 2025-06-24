import * as THREE from 'three';
import { gameContext } from './context.js';
import { Animal } from './animal.js';
import { updateDeerAudio, triggerDeerBlowSound } from './spatial-audio.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- DEER CONFIGURATION ---
const deerConfig = {
    name: 'deer',
    modelPath: 'assets/White_Tailed_Deer_Male.glb',
    scale: 4.4, // Increased by 10% from 4.0 for better realism
    yOffset: 0, // Add missing yOffset property
    bodyColor: 0x8B4513,
    bodySize: { x: 2, y: 1, z: 1 },
    heightOffset: 0.0, // Reduced from 0.3 to eliminate floating - deer feet should touch ground
    worldBoundaryMargin: 50, // Increased from 20 to 50 for more room near boundaries

    vitals: {
        size: { x: 0.252, y: 0.252, z: 0.252 }, // Shrunk by 10% from 0.28 to 0.252 (0.28 * 0.9)
        offset: { x: 0, y: 0.65, z: 0.3 }, // Moved forward 0.1 toward head (z: 0.2→0.3)
        debugColor: 0xFF0000,
    },

    brain: {
        size: { x: 0.1, y: 0.1, z: 0.1 }, // Resized to 0.1x0.1x0.1 units for maximum precision
        offset: { x: 0, y: 1.02, z: 0.6 }, // Moved down 0.03 (y: 1.05→1.02)
        debugColor: 0x00FF00, // Green color for brain hitbox
    },

    neck: {
        radiusTop: 0.2,
        radiusBottom: 0.2,
        height: 0.8,
        segments: 8,
        positionYOffset: 0.4,
        groupOffset: { x: 1, y: 0.5, z: 0 },
        rotationZ: -Math.PI / 4,
    },

    head: {
        size: { x: 0.6, y: 0.5, z: 0.7 },
        positionYOffset: 0.6,
    },

    legs: {
        radiusTop: 0.1,
        radiusBottom: 0.1,
        height: 1,
        segments: 8,
        yOffset: -0.5,
        positions: [
            { x: 0.8, z: 0.4 }, { x: 0.8, z: -0.4 },
            { x: -0.8, z: 0.4 }, { x: -0.8, z: -0.4 }
        ],
    },

    // AI Behavior
    alertDistanceThreshold: 250,  // Increased from 60 - deer becomes alert at longer distance
    fleeDistanceThreshold: 150,   // Increased from 35 - deer flees when player gets closer
    wanderMinRadius: 15,         // Reduced from 20 - deer stays closer to current area
    wanderMaxRadiusAddition: 40, // Reduced from 50 - less wandering range
    wanderTargetReachThreshold: 5.0,
    stateTimers: {
        grazing: 6,              // Increased from 4 - more time spent grazing for 40% total time
        drinking: 8,             // Reduced from 10 - less time spent drinking
        fleeing: 4,              // Updated from 3 to 4 - deer runs away for 4 seconds after alert
    },
    speeds: {
        wandering: 4.0,          // Increased from 3.42 - deer moves more, easier to spot
        thirsty: 7.5,            // Increased from 7.125 - more movement when seeking water
        fleeing: 27.0,           // Keep fleeing speed unchanged
        wounded: 13.5,           // Keep wounded speed unchanged for escape realism
    },
    rotationSpeed: 2.5, // Radians per second for smooth turning
    legAnimationSpeeds: {
        wandering: 12,
        thirsty: 12,
        fleeing: 35,
        wounded: 20,
    },
    legRotationAmplitude: 0.5,
    neckLerpFactor: 0.1,
    neckRotations: {
        grazing: Math.PI / 2.5,
        drinking: Math.PI / 2,
        alert: Math.PI / 4,
        default: Math.PI / 4,
    },

    // Tracking
    tracking: {
        trackColor: 0x4B3621,
        trackShapeRadius: 0.18, // Increased from 0.1536 - slightly larger, more visible tracks
        trackOpacityStart: 1.0,
        trackFadeDurationS: 5400, // Increased from 4500 - tracks last longer
        trackCreationDistanceThreshold: 1.8, // Reduced from 2.0 - more frequent tracks
        bloodDropColor: 0x880000,
        bloodDropSize: 0.15, // Increased from 0.13 - more visible blood drops
        bloodOpacityStart: 0.9, // Increased from 0.8 - more visible blood
        bloodFadeDurationS: 5400, // Increased from 4500 - blood lasts longer
        bloodDropCreationDistanceThreshold: 1.3, // Reduced from 1.5 - more frequent blood drops
    },

    // Spawning
    respawnBoundaryMargin: 100,
};


class Deer extends Animal {
    constructor() {
        super(deerConfig);
        this.model.name = 'deer'; // Overriding generic name
        gameContext.deer = this; // The entire deer instance is the source of truth

        this.wanderTarget = new THREE.Vector3();
        this.timeSinceLastDrink = 0;
        this.lastBloodDropTime = 0;
        this.stationaryBloodInterval = 2.0; // seconds
        this.lastBloodDropPosition = new THREE.Vector3();
        this.bloodDrops = [];
        this.tracks = [];
        this.lastTrackPosition = new THREE.Vector3();
        this.currentAnimation = null; // Track current animation
        this.isMoving = false; // Track if deer is currently moving
        this.lastPosition = new THREE.Vector3(); // Track position for movement detection
        
        // Movement history for smooth animation transitions
        this.movementHistory = [0, 0, 0, 0, 0]; // Initialize with 5 zeros
        this.movementHistorySize = 5; // Size of movement history buffer
        
        this.generateNewWanderTarget();

        this.fallen = false;
        this.woundCount = 0; // Track number of wounds for 3-wound kill logic
        this.setState('IDLE'); // Initialize state to IDLE
        
        // Debugging option to disable fleeing behavior
        this.fleeingEnabled = true; // Default: deer can flee normally
        
        // For efficient track creation
        this.trackMaterial = null;
        this.trackGeometry = null;
        
        // Head turning properties for looking at hunter
        this.isLookingAtHunter = false;
        this.headTargetRotation = 0; // Target Y rotation for head
        this.headCurrentRotation = 0; // Current Y rotation for head
        this.headTurnSpeed = 3.0; // Radians per second for head turning

        // For efficient blood drop creation
        this.bloodDropMaterial = null;
        this.bloodDropGeometry = null;

        this.currentIdleBehavior = 'idle'; // Start with basic idle behavior
        this.idleBehaviorTimer = 0;
        this.idleBehaviorDuration = 3 + Math.random() * 4; // Random duration 3-7 seconds

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
        this.stuckCheckInterval = 1.0; // Check every 1 second (less frequent)
        this.emergencyEscapeActive = false;
        this.consecutiveStuckChecks = 0; // Require multiple consecutive stuck detections
        this.requiredStuckChecks = 3; // Must be stuck for 3 consecutive checks before activating escape

        this.previousState = 'IDLE'; // Initialize for spatial audio state change detection
        this.alertTurnDirection = false; // Reset alert turning behavior
        this.alertStartTime = 0;
        this.hasAlertedPlayer = false; // Track if deer has blown alarm for current detection event
        this.alertMovementDelay = 2.5; // Total delay before deer can move after becoming alert (0.5s sound delay + 2s movement delay)

        this.updateIdleBehavior = function(delta) {
            // Only update idle behavior when deer is actually stationary
            if (!this.isMoving && (this.state === 'WANDERING' || this.state === 'THIRSTY')) {
                this.idleBehaviorTimer += delta;
                if (this.idleBehaviorTimer > this.idleBehaviorDuration) {
                    this.idleBehaviorTimer = 0;
                    this.idleBehaviorDuration = 3 + Math.random() * 4; // Random duration 3-7 seconds
                    
                    // Weighted random selection of idle behaviors
                    const rand = Math.random();
                    if (rand < 0.6) {
                        this.currentIdleBehavior = 'grazing'; // 60% chance
                    } else if (rand < 0.8) {
                        this.currentIdleBehavior = 'alert'; // 20% chance
                    } else if (rand < 0.9) {
                        this.currentIdleBehavior = 'idle'; // 10% chance
                    } else {
                        this.currentIdleBehavior = 'pawing'; // 10% chance
                    }
                }
            } else {
                // Reset idle behavior when moving or in other states
                this.currentIdleBehavior = 'idle';
                this.idleBehaviorTimer = 0;
            }
        }
    }

    getCurrentIdleBehavior() {
        // Return animation based on current idle behavior
        // Only use special idle behaviors when deer is actually stationary in WANDERING/THIRSTY states
        switch (this.currentIdleBehavior) {
            case 'grazing':
                return 'Eat'; // Use the actual "Eat" animation
            case 'alert':
                return 'idle'; // Use idle for alert behavior
            case 'pawing':
                return 'idle'; // Use idle for pawing (no specific pawing animation)
            case 'idle':
            default:
                return 'idle';
        }
    }

    generateNewWanderTarget() {
        const angle = Math.random() * Math.PI * 2;
        const distance = this.config.wanderMinRadius + Math.random() * this.config.wanderMaxRadiusAddition;
        
        this.wanderTarget.set(
            this.model.position.x + Math.cos(angle) * distance,
            this.model.position.y,
            this.model.position.z + Math.sin(angle) * distance
        );
        
        // Ensure wander target stays within world boundaries
        const worldSize = gameContext.terrain ? gameContext.terrain.geometry.parameters.width : 1000;
        const boundary = worldSize / 2 - this.config.worldBoundaryMargin;
        
        this.wanderTarget.x = Math.max(-boundary, Math.min(boundary, this.wanderTarget.x));
        this.wanderTarget.z = Math.max(-boundary, Math.min(boundary, this.wanderTarget.z));
    }

    setState(newState) {
        const oldState = this.state;
        
        // Add debug logging for state changes
        if (this.state !== newState) {
            // console.log(`Deer state change: ${this.state} -> ${newState}`); // Logging disabled
        }
        
        // Critical bug fix: Prevent any state changes if deer is locked in KILLED state
        if (this.stateLockedToKilled && oldState === 'KILLED' && newState !== 'KILLED') {
            // console.warn('Deer: Prevented state change from KILLED - deer is locked in death state'); // Logging disabled
            return;
        }
        
        // Critical bug fix: Prevent deer from entering KILLED state unless actually hit
        if (newState === 'KILLED') {
            // Only allow KILLED state if deer was previously WOUNDED or if explicitly hit
            if (oldState !== 'WOUNDED' && !this.wasActuallyHit) {
                // console.warn('Deer: Prevented invalid transition to KILLED state from', oldState); // Logging disabled
                return; // Block invalid transition to KILLED
            }
        }
        
        super.setState(newState);
        gameContext.deerState = newState; // For legacy access

        // Special debug logging for ALERT state
        if (newState === 'ALERT' && oldState !== 'ALERT') {
            // console.log('Deer is now ALERT - should trigger deer blow sound'); // Logging disabled
            // console.log('Deer has transitioned to ALERT state'); // Logging disabled
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
            const wanderAngle = Math.random() * 2 * Math.PI;
            const wanderRadius = this.config.wanderMinRadius + Math.random() * this.config.wanderMaxRadiusAddition;
            
            const originalTarget = new THREE.Vector3(
                this.model.position.x + Math.cos(wanderAngle) * wanderRadius,
                this.model.position.y,
                this.model.position.z + Math.sin(wanderAngle) * wanderRadius
            );
            
            const boundary = gameContext.worldSize / 2 - 20;
            
            this.wanderTarget.set(
                Math.max(-boundary, Math.min(boundary, originalTarget.x)),
                originalTarget.y,
                Math.max(-boundary, Math.min(boundary, originalTarget.z))
            );
        }
        
        if (newState === 'KILLED') {
            // Only start death sequence if not already started AND deer was actually hit
            if (!this.deathSequenceStarted && this.wasActuallyHit) {
                this.deathSequenceStarted = true;
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

    respawn() {
        this.fallen = false;
        
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
        
        this.generateNewWanderTarget();
        
        // Immediately play blow sound when new deer spawns, regardless of distance
        // This alerts the player that a new deer has appeared on the map
        setTimeout(() => {
            triggerDeerBlowSound(this);
            // console.log('New deer spawned and blow sound triggered'); // Logging disabled
        }, 500); // Small delay to ensure deer is fully spawned
    }

    fallDown() {
        if (this.fallen) return; // Already fallen
        
        this.fallen = true;
        
        // Simple death animation - just rotate the deer to lay on its side
        const fallDuration = 800;
        const startTime = Date.now();
        
        // Store original rotation
        const originalRotation = {
            x: this.model.rotation.x,
            y: this.model.rotation.y,
            z: this.model.rotation.z
        };
        
        const animateFall = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / fallDuration, 1);
            
            // Smooth easing
            const easeOut = 1 - Math.pow(1 - progress, 2);
            
            // Rotate around Z axis to lay on side
            this.model.rotation.x = originalRotation.x;
            this.model.rotation.y = originalRotation.y;  
            this.model.rotation.z = originalRotation.z + (Math.PI / 2) * easeOut;
            
            if (progress < 1) {
                requestAnimationFrame(animateFall);
            } else {
                // Final position
                this.model.rotation.x = originalRotation.x;
                this.model.rotation.y = originalRotation.y;  
                this.model.rotation.z = originalRotation.z + Math.PI / 2;
            }
        };
        
        animateFall();
    }

    createTrack() {
        // Initialize material and geometry once for efficiency
        if (!this.trackMaterial) {
            const textureLoader = new THREE.TextureLoader();
            
            // Create fallback material first
            this.trackMaterial = new THREE.MeshLambertMaterial({
                color: this.config.tracking.trackColor,
                transparent: true,
                opacity: this.config.tracking.trackOpacityStart
            });
            
            // Try to load texture, but don't block on it
            textureLoader.load(
                'assets/textures/deer_track.png',
                (texture) => {
                    // Success: update material with texture
                    this.trackMaterial.map = texture;
                    this.trackMaterial.needsUpdate = true;
                },
                undefined,
                (error) => {
                    // Error: keep using color-based fallback
                }
            );
        }

        const trackGeometry = new THREE.PlaneGeometry(this.config.tracking.trackShapeRadius * 2, this.config.tracking.trackShapeRadius * 2);
        const track = new THREE.Mesh(trackGeometry, this.trackMaterial.clone());

        track.position.copy(this.model.position);
        
        // Add subtle left/right randomization (max half the width of a track)
        const trackWidth = this.config.tracking.trackShapeRadius * 2;
        const maxOffset = trackWidth * 0.5; // Half the width of a track
        const randomOffsetX = (Math.random() - 0.5) * maxOffset; // Random between -maxOffset/2 and +maxOffset/2
        const randomOffsetZ = (Math.random() - 0.5) * maxOffset;
        
        track.position.x += randomOffsetX;
        track.position.z += randomOffsetZ;
        track.position.y = gameContext.getHeightAt(track.position.x, track.position.z) + 0.01; // Slightly above ground

        // Orient the track to match the deer's actual travel direction
        track.rotation.x = -Math.PI / 2; // Lay flat on ground
        
        // Calculate actual movement direction from position change
        const movementDirection = new THREE.Vector3()
            .subVectors(this.model.position, this.lastPosition)
            .normalize();
        
        // Convert movement direction to rotation angle and add 180° correction
        const travelAngle = Math.atan2(movementDirection.x, movementDirection.z) + Math.PI;
        track.rotation.z = travelAngle; // Orient track to actual travel direction with correction
        
        this.lastTrackPosition.copy(this.model.position);
        this.tracks.push({ mesh: track, creationTime: gameContext.clock.getElapsedTime() });
        
        // Ensure scene exists before adding
        if (gameContext.scene) {
            gameContext.scene.add(track);
        } else {
        }
    }

    updateTracks() {
        const currentTime = gameContext.clock.getElapsedTime();
        const initialCount = this.tracks.length;
        this.tracks = this.tracks.filter(track => {
            const age = currentTime - track.creationTime;
            if (age > this.config.tracking.trackFadeDurationS) {
                gameContext.scene.remove(track.mesh);
                track.mesh.material.dispose();
                // No need to dispose geometry as it's shared
                return false; // Remove from array
            }
            // Update opacity
            track.mesh.material.opacity = 1.0 - (age / this.config.tracking.trackFadeDurationS);
            return true; // Keep in array
        });
        if (this.tracks.length !== initialCount) {
        }
    }

    createBloodDrop() {
        // Initialize material and geometry once for efficiency
        if (!this.bloodDropMaterial) {
            const textureLoader = new THREE.TextureLoader();
            
            // Create fallback material first
            this.bloodDropMaterial = new THREE.MeshLambertMaterial({
                color: this.config.tracking.bloodDropColor,
                transparent: true,
                opacity: this.config.tracking.bloodOpacityStart
            });
            
            // Try to load texture, but don't block on it
            textureLoader.load(
                'assets/textures/blood_drops.png',
                (texture) => {
                    // Success: update material with texture
                    this.bloodDropMaterial.map = texture;
                    this.bloodDropMaterial.needsUpdate = true;
                },
                undefined,
                (error) => {
                    // Error: keep using color-based fallback
                }
            );
        }

        // Randomize blood drop size (current size to 30% bigger)
        const baseDrop = this.config.tracking.bloodDropSize * 2;
        const sizeVariation = 1 + (Math.random() * 0.3); // 1.0 to 1.3 (up to 30% bigger)
        const randomDropSize = baseDrop * sizeVariation;
        
        // Create geometry with randomized size
        const bloodDropGeometry = new THREE.PlaneGeometry(randomDropSize, randomDropSize);
        const drop = new THREE.Mesh(bloodDropGeometry, this.bloodDropMaterial.clone());

        // Randomize position (±2 units left/right/forward/backward from deer position)
        const randomOffsetX = (Math.random() - 0.5) * 4; // -2 to +2 units (reduced from 20 to 4)
        const randomOffsetZ = (Math.random() - 0.5) * 4; // -2 to +2 units (reduced from 20 to 4)
        
        drop.position.copy(this.model.position);
        drop.position.x += randomOffsetX;
        drop.position.z += randomOffsetZ;
        drop.position.y = gameContext.getHeightAt(drop.position.x, drop.position.z) + 0.015; // Slightly above ground
        drop.rotation.x = -Math.PI / 2; // Lay flat
        drop.rotation.z = Math.random() * Math.PI * 2; // Randomize rotation

        this.lastBloodDropPosition.copy(this.model.position);
        this.bloodDrops.push({ mesh: drop, creationTime: gameContext.clock.getElapsedTime() });
        
        // Ensure scene exists before adding
        if (gameContext.scene) {
            gameContext.scene.add(drop);
        } else {
        }
    }

    createShotBloodIndicator(hitPosition) {
        const textureLoader = new THREE.TextureLoader();
        
        // Create fallback material first
        const shotBloodMaterial = new THREE.MeshLambertMaterial({
            color: 0xff0000, // Brighter red for shot indicators
            transparent: true,
            opacity: 0.9 // More visible than trail blood
        });
        
        // Try to load texture, but don't block on it
        textureLoader.load(
            'assets/textures/blood_drops.png',
            (texture) => {
                // Success: update material with texture
                shotBloodMaterial.map = texture;
                shotBloodMaterial.needsUpdate = true;
            },
            undefined,
            (error) => {
                // Error: keep using color-based fallback
            }
        );

        // Larger size for shot indicators
        const shotBloodSize = this.config.tracking.bloodDropSize * 3;
        const shotBloodGeometry = new THREE.PlaneGeometry(shotBloodSize, shotBloodSize);
        const shotBlood = new THREE.Mesh(shotBloodGeometry, shotBloodMaterial);

        // Position at hit location
        shotBlood.position.copy(hitPosition);
        shotBlood.position.y = gameContext.getHeightAt(shotBlood.position.x, shotBlood.position.z) + 0.02; // Slightly higher than trail blood
        shotBlood.rotation.x = -Math.PI / 2; // Lay flat
        shotBlood.rotation.z = Math.random() * Math.PI * 2; // Randomize rotation

        // Add to scene and track for cleanup
        if (gameContext.scene) {
            gameContext.scene.add(shotBlood);
            this.bloodDrops.push({ mesh: shotBlood, creationTime: gameContext.clock.getElapsedTime() });
        } else {
        }
    }

    updateBloodDrops() {
        const currentTime = gameContext.clock.getElapsedTime();
        const initialCount = this.bloodDrops.length;
        this.bloodDrops = this.bloodDrops.filter(drop => {
            const age = currentTime - drop.creationTime;
            const opacity = this.config.tracking.bloodOpacityStart - (age / this.config.tracking.bloodFadeDurationS);

            if (opacity <= 0) {
                // Remove from scene and dispose material
                gameContext.scene.remove(drop.mesh);
                drop.mesh.material.dispose(); // Dispose cloned material
                return false; // Remove from array
            }
            
            // Update opacity
            drop.mesh.material.opacity = opacity;
            return true; // Keep in array
        });
    }

    getAnimationForState() {
        // Determine movement speed for animation selection
        const isWalking = this.isMoving && this.currentSpeed < this.config.speeds.fleeing * 0.7;
        const isRunning = this.isMoving && this.currentSpeed >= this.config.speeds.fleeing * 0.7;
        
        switch (this.state) {
            case 'IDLE':
                return 'idle';
            case 'WANDERING':
                if (isWalking) return 'Walk';
                if (isRunning) return 'Run';
                // Only use idle behaviors when actually stopped in wandering state
                return this.getCurrentIdleBehavior();
                
            case 'THIRSTY':
                if (isWalking) return 'Walk';
                if (isRunning) return 'Run';
                // Only use idle behaviors when actually stopped in thirsty state
                return this.getCurrentIdleBehavior();
                
            case 'GRAZING':
                return 'Eat'; // Use the actual "Eat" animation from the model
                
            case 'DRINKING':
                return 'idle'; // Use idle for drinking (no specific drinking animation)
                
            case 'ALERT':
                return 'idle'; // Use idle for alert state
                
            case 'FLEEING':
                return 'Run';
                
            case 'WOUNDED':
                if (this.stateTimer < 0.5) {
                    // Initial wounded reaction - use Attack animation as impact reaction
                    return 'Attack';
                } else {
                    return 'Run';
                }
                
            case 'KILLED':
                // Play death animation once, then stop all animation
                if (!this.deathAnimationStarted) {
                    this.deathAnimationStarted = true;
                    return 'Die';
                } else {
                    // After death animation starts, stop all animation to prevent leg movement
                    if (this.mixer && this.activeAction) {
                        this.activeAction.stop();
                        this.activeAction = null;
                    }
                    return null; // No animation after death
                }
                
            default:
                return 'idle';
        }
    }

    changeAnimationIfNecessary() {
        const desiredAnimation = this.getAnimationForState();
        
        // Special handling for KILLED state
        if (this.state === 'KILLED') {
            // Check if the desired animation exists for the current death phase
            let hasDesiredAnimation = false;
            
            // Check if animations exist and if the desired animation is available
            if (this.animations && desiredAnimation) {
                // Check the animations object directly instead of mixer._actions
                hasDesiredAnimation = this.animations.hasOwnProperty(desiredAnimation);
            }
            
            if (hasDesiredAnimation && desiredAnimation && desiredAnimation !== this.currentAnimation) {
                this.playAnimation(desiredAnimation);
                this.currentAnimation = desiredAnimation;
            } else if (!hasDesiredAnimation && desiredAnimation && desiredAnimation !== this.currentAnimation) {
                // Animation doesn't exist, log once and set fallback
                if (desiredAnimation === 'Die') {
                    // Use idle as fallback for missing Die animation (lowercase)
                    if (this.animations && this.animations.hasOwnProperty('idle')) {
                        this.playAnimation('idle');
                        this.currentAnimation = 'idle';
                    } else {
                        // Stop all animations if even idle doesn't exist
                        this.mixer.stopAllAction();
                        this.currentAnimation = null;
                    }
                } else {
                    // Stop all animations if animation doesn't exist
                    this.mixer.stopAllAction();
                    this.currentAnimation = null;
                }
            }
            return;
        }
        
        // Normal animation handling for other states
        if (desiredAnimation && desiredAnimation !== this.currentAnimation) {
            this.playAnimation(desiredAnimation);
            this.currentAnimation = desiredAnimation;
        }
    }

    updateHeadTurning(distanceToPlayer, delta, playerVisible) {
        // Only turn head if deer has a head component and is in alert/fleeing state
        if ((this.state === 'ALERT' || this.state === 'FLEEING') && this.model.head && playerVisible) {
            // Calculate direction from deer to player
            const directionToPlayer = new THREE.Vector3()
                .subVectors(gameContext.player.position, this.model.position)
                .normalize();
            
            // Calculate target angle for head to look at player
            // Relative to deer's current body orientation
            const deerForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.model.quaternion);
            const targetAngle = Math.atan2(directionToPlayer.x, directionToPlayer.z) - Math.atan2(deerForward.x, deerForward.z);
            
            // Normalize angle to [-π, π] range
            let normalizedAngle = targetAngle;
            while (normalizedAngle > Math.PI) normalizedAngle -= 2 * Math.PI;
            while (normalizedAngle < -Math.PI) normalizedAngle += 2 * Math.PI;
            
            // Limit head turn to realistic range (±90 degrees)
            const maxHeadTurn = Math.PI / 2;
            const clampedAngle = Math.max(-maxHeadTurn, Math.min(maxHeadTurn, normalizedAngle));
            
            // Smoothly interpolate head rotation
            const rotationStep = this.headTurnSpeed * delta;
            
            // Apply rotation step in the correct direction
            if (clampedAngle > this.headCurrentRotation) {
                this.headCurrentRotation += Math.min(rotationStep, clampedAngle - this.headCurrentRotation);
            } else {
                this.headCurrentRotation += Math.max(-rotationStep, clampedAngle - this.headCurrentRotation);
            }
            
            // Apply rotation to head only
            this.model.head.rotation.y = this.headCurrentRotation;
            this.isLookingAtHunter = true;
        } else {
            // Reset head to neutral position when not alerting
            if (this.isLookingAtHunter && this.model.head) {
                const resetStep = this.headTurnSpeed * delta;
                if (Math.abs(this.headCurrentRotation) > 0.01) {
                    if (this.headCurrentRotation > 0) {
                        this.headCurrentRotation -= Math.min(resetStep, this.headCurrentRotation);
                    } else {
                        this.headCurrentRotation += Math.min(resetStep, -this.headCurrentRotation);
                    }
                    this.model.head.rotation.y = this.headCurrentRotation;
                } else {
                    this.headCurrentRotation = 0;
                    this.model.head.rotation.y = 0;
                    this.isLookingAtHunter = false;
                }
            }
        }
    }

    update(delta) {
        if (!this.isModelLoaded) return;

        // Always call super.update for proper height positioning, even when dead
        super.update(delta);

        // Only continue with AI behavior if deer is alive
        if (this.state === 'DEAD') return;
        
        // Update spatial audio for this deer
        updateDeerAudio(this, delta);

        // Track deer movement distance for journal when wounded or fleeing
        if ((this.state === 'WOUNDED' || this.state === 'FLEEING') && gameContext.huntLog && gameContext.huntLog.deerInitialPosition) {
            const currentDistance = gameContext.huntLog.deerInitialPosition.distanceTo(this.model.position);
            gameContext.huntLog.distanceTrailed = Math.max(gameContext.huntLog.distanceTrailed, currentDistance);
        }

        this.timeSinceLastDrink += delta;

        this.updateTracks();
        this.updateBloodDrops();

        this.updateIdleBehavior(delta);

        let speed = 0;
        let legAnimationSpeed = 0;

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
                legAnimationSpeed = 0;
                if (this.stateTimer > 1.0) { // Wait 1 second, then start normal behavior
                    this.setState(Math.random() < 0.6 ? 'GRAZING' : 'WANDERING'); // 60% chance to graze
                }
                break;
            case 'WANDERING':
                speed = this.config.speeds.wandering * delta;
                legAnimationSpeed = this.config.legAnimationSpeeds.wandering;
                if (this.model.position.distanceTo(this.wanderTarget) < this.config.wanderTargetReachThreshold) {
                    this.setState(Math.random() < 0.6 ? 'GRAZING' : 'WANDERING'); // 60% chance to graze
                } else {
                    this.smoothRotateTowards(this.wanderTarget, delta);
                    this.moveWithCollisionDetection(speed); // Move while rotating towards target
                }
                break;
            case 'THIRSTY':
                speed = this.config.speeds.thirsty * delta;
                legAnimationSpeed = this.config.legAnimationSpeeds.thirsty;
                const waterSource = gameContext.findClosestWaterSource(this.model.position);
                if (waterSource) {
                    if (this.model.position.distanceTo(waterSource) < 10) {
                        this.setState('DRINKING');
                    } else {
                        this.smoothRotateTowards(waterSource, delta);
                        this.moveWithCollisionDetection(speed); // Move while rotating towards water
                    }
                } else {
                    this.setState('WANDERING'); // No water found
                }
                break;
            case 'GRAZING':
                // Deer should be completely stationary while grazing
                speed = 0;
                legAnimationSpeed = 0;
                if (this.stateTimer > this.config.stateTimers.grazing) {
                    this.setState('WANDERING');
                }
                break;
            case 'DRINKING':
                // Deer should be completely stationary while drinking
                speed = 0;
                legAnimationSpeed = 0;
                if (this.stateTimer > this.config.stateTimers.drinking) {
                    this.timeSinceLastDrink = 0;
                    this.setState('WANDERING');
                }
                break;
            case 'ALERT':
                speed = 0;
                legAnimationSpeed = 0;
                
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
                legAnimationSpeed = this.config.legAnimationSpeeds.fleeing;
                const fleeDirFromPlayer = new THREE.Vector3().subVectors(this.model.position, gameContext.player.position).normalize();
                this.smoothRotateTowards(new THREE.Vector3().addVectors(this.model.position, fleeDirFromPlayer), delta);
                this.moveWithCollisionDetection(speed); // Move while rotating away from player
                if (this.stateTimer > this.config.stateTimers.fleeing) this.setState('WANDERING');
                break;
            case 'WOUNDED':
                speed = this.config.speeds.wounded * delta;
                legAnimationSpeed = this.config.legAnimationSpeeds.wounded;
                const woundFleeDir = new THREE.Vector3().subVectors(this.model.position, gameContext.player.position).normalize();
                this.smoothRotateTowards(new THREE.Vector3().addVectors(this.model.position, woundFleeDir), delta);
                this.moveWithCollisionDetection(speed);
                
                const currentTime = gameContext.clock.getElapsedTime();
                if (currentTime - this.lastBloodDropTime > this.stationaryBloodInterval) {
                    this.createBloodDrop();
                    this.lastBloodDropTime = currentTime;
                }
                break;
            case 'KILLED':
                speed = 0;
                legAnimationSpeed = 0;
                break;
        }

        // Store movement speed for animation decisions
        this.movementSpeed = speed / delta; // Convert back to units per second
        this.currentSpeed = this.movementSpeed;

        this.changeAnimationIfNecessary();

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
            
            // Generate new wander target closer to center
            const escapeDistance = 50; // Move at least 30% toward center
            this.wanderTarget.set(
                this.model.position.x + centerDirection.x * escapeDistance,
                0,
                this.model.position.z + centerDirection.z * escapeDistance
            );
            
            // Ensure the new target is well within boundaries
            const safeBoundary = boundary * 0.8; // Use 80% of boundary for safety
            this.wanderTarget.x = Math.max(-safeBoundary, Math.min(safeBoundary, this.wanderTarget.x));
            this.wanderTarget.z = Math.max(-safeBoundary, Math.min(safeBoundary, this.wanderTarget.z));
        } else if (wasOutsideBoundary) {
            // Just generate a new target if we were outside but didn't need escape
            this.generateNewWanderTarget();
        }

        // Enhanced movement detection
        const distanceMoved = this.model.position.distanceTo(this.lastPosition);
        const movementThreshold = 0.05;
        
        // For stationary states, clear movement history to ensure proper animation
        if (this.state === 'GRAZING' || this.state === 'DRINKING' || this.state === 'ALERT' || this.state === 'KILLED') {
            this.movementHistory = [0, 0, 0, 0, 0]; // Clear movement history
            this.isMoving = false;
        } else {
            // Update movement history for moving states
            this.movementHistory.push(distanceMoved);
            if (this.movementHistory.length > this.movementHistorySize) {
                this.movementHistory.shift();
            }
            
            // Check if deer is moving based on movement history
            const isMoving = this.movementHistory.some(movement => movement > movementThreshold);
            
            // Set the deer's isMoving flag for animation purposes
            this.isMoving = isMoving;
        }

        // moveWithCollisionDetection(speed);

        // Movement-based blood drops for wounded deer
        if (this.state === 'WOUNDED' && this.model.position.distanceTo(this.lastBloodDropPosition) > this.config.tracking.bloodDropCreationDistanceThreshold) {
            this.createBloodDrop();
        }
        
        // Create tracks when deer is moving
        if (speed > 0 && this.model.position.distanceTo(this.lastTrackPosition) > this.config.tracking.trackCreationDistanceThreshold) {
            this.createTrack();
        }
        
        this.lastPosition.copy(this.model.position);

        // Stuck detection
        const currentTime = gameContext.clock.getElapsedTime();
        if (currentTime - this.lastStuckCheckTime > this.stuckCheckInterval) {
            this.lastStuckCheckTime = currentTime;
            
            // Only check if we have enough history
            if (this.stuckDetectionHistory.length > 0) {
                const oldestPosition = this.stuckDetectionHistory[0];
                const distanceSinceLastCheck = this.model.position.distanceTo(oldestPosition);
                
                // Check if deer is in a moving animation (Walk or Run) but not actually moving
                const currentAnimation = this.getAnimationForState();
                const isInMovingAnimation = currentAnimation === 'Walk' || currentAnimation === 'Run';
                
                // Enhanced stuck detection - check multiple conditions:
                // 1. Deer is in moving animation but not moving (original logic)
                // 2. Deer is WANDERING but can't reach its wander target for extended time
                // 3. Deer is FLEEING but not moving much (trapped while trying to escape)
                const isWanderingButStuck = this.state === 'WANDERING' && 
                    this.model.position.distanceTo(this.wanderTarget) > this.config.wanderTargetReachThreshold &&
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
                        // console.log(`Deer stuck detected: state=${this.state}, animation=${currentAnimation}, distance=${distanceSinceLastCheck.toFixed(2)}`); // Logging disabled
                    }
                } else {
                    // Deer is not stuck - reset emergency escape
                    this.consecutiveStuckChecks = 0;
                    this.emergencyEscapeActive = false;
                }
            }
        }

        // Emergency escape
        if (this.state === 'ALERT') {
            const currentTime = gameContext.clock.getElapsedTime();
            if (currentTime - this.alertStartTime > this.alertMovementDelay) {
                // After alert delay, automatically flee if player is still visible and close
                if (playerVisible && this.hasDetectedMovingPlayer && distanceToPlayer < this.config.fleeDistanceThreshold && this.fleeingEnabled) {
                    this.setState('FLEEING');
                } else if (playerVisible && this.hasDetectedMovingPlayer) {
                    // Even if not in immediate flee distance, still flee after alert sequence
                    this.setState('FLEEING');
                } else {
                    // Player no longer visible or detected, return to wandering
                    this.setState('WANDERING');
                }
            } else {
                speed = 0; // Prevent movement during alert delay
            }
        }

        // moveWithCollisionDetection(speed);

        // Emergency escape
        if (this.emergencyEscapeActive) {
            // Clear stuck detection history immediately to prevent re-triggering
            this.stuckDetectionHistory = [];
            
            // Try to find a safe position by testing multiple directions
            const testDirections = [
                new THREE.Vector3(1, 0, 0),   // East
                new THREE.Vector3(-1, 0, 0),  // West
                new THREE.Vector3(0, 0, 1),   // North
                new THREE.Vector3(0, 0, -1),  // South
                new THREE.Vector3(1, 0, 1).normalize(),   // Northeast
                new THREE.Vector3(-1, 0, 1).normalize(),  // Northwest
                new THREE.Vector3(1, 0, -1).normalize(),  // Southeast
                new THREE.Vector3(-1, 0, -1).normalize()  // Southwest
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
                    // Found a safe position - move deer there gradually, not teleport
                    const moveDirection = direction.clone().multiplyScalar(escapeDistance * 0.5); // Move half the distance
                    this.model.position.add(moveDirection);
                    this.model.position.y = gameContext.getHeightAt(this.model.position.x, this.model.position.z) + this.heightOffset;
                    
                    // Generate a new wander target in a safe direction
                    this.generateNewWanderTarget();
                    
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
                this.generateNewWanderTarget();
                
                this.emergencyEscapeActive = false;
                this.consecutiveStuckChecks = 0; // Reset stuck counter
            }
        }

        // Emergency escape
        if (this.state === 'ALERT') {
            const currentTime = gameContext.clock.getElapsedTime();
            if (currentTime - this.alertStartTime > this.alertMovementDelay) {
                if (playerVisible && this.hasDetectedMovingPlayer && distanceToPlayer < this.config.fleeDistanceThreshold && this.fleeingEnabled) {
                    this.setState('FLEEING');
                }
            } else {
                speed = 0; // Prevent movement during alert delay
            }
        }

        // moveWithCollisionDetection(speed);
    }

    moveWithCollisionDetection(speed) {
        // Store original position before any movement
        const originalPosition = this.model.position.clone();
        
        // First, try to move forward normally
        this.model.translateZ(speed);
        
        // Check if the new position collides with any trees
        const newPosition = this.model.position.clone();
        const collision = gameContext.checkTreeCollision(newPosition, 0.7);
        
        if (collision) {
            // Collision detected - immediately back up to original position
            this.model.position.copy(originalPosition);
            
            // Try multiple escape strategies in order of preference
            const escapeStrategies = [
                { angle: Math.PI / 4, description: "45° left" },      // Try left first
                { angle: -Math.PI / 4, description: "45° right" },    // Then right
                { angle: Math.PI / 2, description: "90° left" },      // Sharp left
                { angle: -Math.PI / 2, description: "90° right" },    // Sharp right
                { angle: Math.PI, description: "180° turn" }          // Complete turnaround
            ];
            
            let escaped = false;
            
            for (const strategy of escapeStrategies) {
                // Test movement in this direction
                const testDirection = new THREE.Vector3(0, 0, speed);
                testDirection.applyQuaternion(this.model.quaternion);
                testDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), strategy.angle);
                
                const testPosition = originalPosition.clone().add(testDirection);
                
                if (!gameContext.checkTreeCollision(testPosition, 0.7)) {
                    // This direction is clear - move there and rotate toward it
                    this.model.position.copy(testPosition);
                    this.model.rotateY(strategy.angle * 0.5); // Rotate halfway toward escape direction
                    escaped = true;
                    break;
                }
            }
            
            // If all escape strategies failed, generate new wander target and force rotation
            if (!escaped) {
                this.generateNewWanderTarget();
                
                // Force immediate significant rotation to break free
                const randomRotation = (Math.random() - 0.5) * Math.PI; // Random rotation up to ±90°
                this.model.rotateY(randomRotation);
                
                // Try to move in the new direction
                const escapeDirection = new THREE.Vector3(0, 0, speed * 0.5); // Half speed for safety
                escapeDirection.applyQuaternion(this.model.quaternion);
                const escapePosition = originalPosition.clone().add(escapeDirection);
                
                if (!gameContext.checkTreeCollision(escapePosition, 0.7)) {
                    this.model.position.copy(escapePosition);
                } else {
                    // Still stuck - stay at original position and keep rotating
                    this.model.position.copy(originalPosition);
                }
            }
        }
        
        // Final safety check - if somehow still in collision, force separation
        const finalPosition = this.model.position.clone();
        if (gameContext.checkTreeCollision(finalPosition, 0.7)) {
            // Emergency: push deer away from nearest tree
            let nearestTree = null;
            let nearestDistance = Infinity;
            
            if (gameContext.trees && gameContext.trees.children) {
                for (const tree of gameContext.trees.children) {
                    const distance = this.model.position.distanceTo(tree.position);
                    if (distance < nearestDistance) {
                        nearestDistance = distance;
                        nearestTree = tree;
                    }
                }
            }
            
            if (nearestTree) {
                // Push deer directly away from the nearest tree
                const awayFromTree = new THREE.Vector3()
                    .subVectors(this.model.position, nearestTree.position)
                    .normalize()
                    .multiplyScalar(1.5); // Push 1.5 units away
                
                this.model.position.copy(nearestTree.position).add(awayFromTree);
                
                // Height will be automatically adjusted by Animal.update() using heightOffset
            }
        }
    }

    updateHitboxes() {
        this.respawn();
    }

    // Override spawn to ensure hitbox positioning happens after deer is positioned
    spawn(position, rotationY) {
        // Call parent spawn method first
        super.spawn(position, rotationY);
        
        // Now update hitbox positions if they exist
        if (this.permanentVitalsHitbox) {
            this.permanentVitalsHitbox.position.copy(this.model.position);
        }
    }

    // Override createVitals to add a permanent, oversized primitive hitbox
    createVitals(parent) {
        super.createVitals(parent);
        
        // Don't create any hitbox until we solve the underlying issue
        return;
    }
    
    // Brand new, clean hitbox creation method
    createSimpleVitalsHitbox() {
        // Create geometry and material
        const geometry = new THREE.BoxGeometry(5, 5, 5); // Reduced to 10% of original size (50 -> 5)
        const material = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.3,
            wireframe: true
        });
        
        // Create the mesh
        this.permanentVitalsHitbox = new THREE.Mesh(geometry, material);
        this.permanentVitalsHitbox.name = 'vitals';
        
        // Position it relative to deer center
        this.permanentVitalsHitbox.position.set(0, 2, 0); // 2 units above deer
        
        // Add directly to the deer's model group
        this.model.add(this.permanentVitalsHitbox);
    }

    setFleeingEnabled(enabled) {
        this.fleeingEnabled = enabled;
    }

    startDeathSequence() {
        // Prevent multiple death sequences from starting
        if (this.deathSequenceInProgress) {
            return;
        }
        
        // Critical bug fix: Only start death sequence if deer was actually hit
        if (!this.wasActuallyHit) {
            // console.warn('Deer: Prevented death sequence start - deer was not actually hit'); // Logging disabled
            return;
        }
        
        this.deathSequenceInProgress = true;
        
        // Lock the deer in KILLED state to prevent erratic cycling
        this.stateLockedToKilled = true;
        
        // Simple death sequence - just play die animation and fall after a short delay
        this.deathAnimationStarted = true;
        this.changeAnimationIfNecessary();
        
        // Start the fall down animation after a short delay to let die animation begin
        setTimeout(() => {
            if (!this.fallen && this.stateLockedToKilled) { // Only fall if not already fallen and still in valid death state
                this.fallDown();
            }
        }, 1000); // Wait 1 second before falling
    }

    /**
     * Checks if the player is visible to the deer (not concealed by trees, bushes, or terrain)
     * Uses raycasting to detect if trees, bushes, or terrain block the line of sight
     * @returns {boolean} - True if player is visible, false if concealed
     */
    isPlayerVisible() {
        if (!gameContext.player || !gameContext.player.position) {
            return false;
        }

        // Only check visibility every few frames to improve performance
        if (!this.lastVisibilityCheck) this.lastVisibilityCheck = 0;
        const currentTime = gameContext.clock.getElapsedTime();
        if (currentTime - this.lastVisibilityCheck < 0.2) { // Check only every 200ms
            return this.lastVisibilityResult !== undefined ? this.lastVisibilityResult : true;
        }
        this.lastVisibilityCheck = currentTime;

        // Create a ray from deer's eye level to player's eye level
        const deerEyePosition = this.model.position.clone();
        deerEyePosition.y += 2.5; // Deer eye height
        
        const playerEyePosition = gameContext.player.position.clone();
        playerEyePosition.y += 6.0; // Player eye height
        
        const direction = new THREE.Vector3().subVectors(playerEyePosition, deerEyePosition).normalize();
        const distance = deerEyePosition.distanceTo(playerEyePosition);
        
        // Use shared raycaster instead of creating new one
        if (!gameContext.visibilityRaycaster) {
            gameContext.visibilityRaycaster = new THREE.Raycaster();
        }
        gameContext.visibilityRaycaster.set(deerEyePosition, direction);
        gameContext.visibilityRaycaster.far = distance - 0.5; // Stop just before reaching player
        
        // Check terrain first - if blocked by terrain, no need to check trees/bushes
        let isVisible = true;
        if (gameContext.terrain) {
            const terrainIntersections = gameContext.visibilityRaycaster.intersectObject(gameContext.terrain, false);
            if (terrainIntersections.length > 0) {
                // Check if terrain intersection is between deer and player (not behind player)
                const intersectionDistance = deerEyePosition.distanceTo(terrainIntersections[0].point);
                if (intersectionDistance < distance - 1.0) { // Allow 1 unit buffer
                    isVisible = false;
                }
            }
        }
        
        // Check trees if not already blocked by terrain
        if (isVisible && gameContext.trees && gameContext.trees.children.length > 0) {
            const treeIntersections = gameContext.visibilityRaycaster.intersectObjects(gameContext.trees.children, true);
            if (treeIntersections.length > 0) {
                isVisible = false;
            }
        }
        
        // Only check bushes if not already blocked by terrain or trees
        if (isVisible && gameContext.bushes && gameContext.bushes.children.length > 0) {
            const bushIntersections = gameContext.visibilityRaycaster.intersectObjects(gameContext.bushes.children, true);
            if (bushIntersections.length > 0) {
                isVisible = false;
            }
        }
        
        // Cache result for performance
        this.lastVisibilityResult = isVisible;
        return isVisible;
    }

    getCurrentIdleBehavior() {
        // Return animation based on current idle behavior
        // Only use special idle behaviors when deer is actually stationary in WANDERING/THIRSTY states
        switch (this.currentIdleBehavior) {
            case 'grazing':
                return 'Eat'; // Use the actual "Eat" animation
            case 'alert':
                return 'idle'; // Use idle for alert behavior
            case 'pawing':
                return 'idle'; // Use idle for pawing (no specific pawing animation)
            case 'idle':
            default:
                return 'idle';
        }
    }

    isActivelyTryingToMove() {
        // Check if deer is in a state where it should be moving
        return this.state === 'WANDERING' || this.state === 'THIRSTY' || this.state === 'FLEEING' || this.state === 'WOUNDED';
    }

    /**
     * Smoothly rotate the deer towards a target position
     * @param {THREE.Vector3} targetPosition - The position to rotate towards
     * @param {number} delta - Time delta for smooth rotation
     */
    smoothRotateTowards(targetPosition, delta) {
        // Calculate direction from deer to target
        const direction = new THREE.Vector3()
            .subVectors(targetPosition, this.model.position)
            .normalize();
        
        // Calculate target rotation angle
        const targetAngle = Math.atan2(direction.x, direction.z);
        
        // Create target quaternion
        const targetQuaternion = new THREE.Quaternion();
        targetQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetAngle);
        
        // Smoothly interpolate towards target rotation
        // Use a rotation speed that feels natural (adjust multiplier as needed)
        const rotationSpeed = 3.0; // radians per second
        const maxRotationThisFrame = rotationSpeed * delta;
        
        // Calculate how much we need to rotate
        const currentQuaternion = this.model.quaternion.clone();
        const rotationNeeded = currentQuaternion.angleTo(targetQuaternion);
        
        // Limit rotation to max rotation per frame for smooth movement
        const rotationAmount = Math.min(rotationNeeded, maxRotationThisFrame);
        const t = rotationNeeded > 0 ? rotationAmount / rotationNeeded : 0;
        
        // Apply smooth rotation
        this.model.quaternion.slerp(targetQuaternion, t);
    }

    loadModel(path) {
        super.loadModel(path);
    }
}

function forceDeerRespawn() {
    if (gameContext.deer) {
        gameContext.deer.respawn();
    }
}

export const deer = new Deer();
