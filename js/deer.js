import * as THREE from 'three';
import { gameContext } from './context.js';
import { Animal } from './animal.js';

// --- DEER CONFIGURATION ---
const deerConfig = {
    name: 'deer',
    modelPath: 'assets/White_Tailed_Deer_Male.glb',
    scale: 4.4, // Increased by 10% from 4.0 for better realism
    yOffset: 0, // Add missing yOffset property
    bodyColor: 0x8B4513,
    bodySize: { x: 2, y: 1, z: 1 },
    heightOffset: 0.0, // Reduced from 0.3 to eliminate floating - deer feet should touch ground
    worldBoundaryMargin: 20,

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
    alertDistanceThreshold: 80,
    fleeDistanceThreshold: 60,
    wanderMinRadius: 20,
    wanderMaxRadiusAddition: 50,
    wanderTargetReachThreshold: 5.0,
    stateTimers: {
        grazing: 5,
        drinking: 10,
        fleeing: 12,
    },
    speeds: {
        wandering: 3.42,   // Reverted back to original value
        thirsty: 7.125,    // Reduced by 5% from 7.5
        fleeing: 27.0,     // Keep fleeing speed unchanged
        wounded: 13.5,     // Keep wounded speed unchanged for escape realism
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
        trackShapeRadius: 0.1536, // Reduced by another 20% from 0.192 for smaller tracks
        trackOpacityStart: 1.0,
        trackFadeDurationS: 4500, // Increased from 600 to last more than one game day (4320s)
        trackCreationDistanceThreshold: 2.0,
        bloodDropColor: 0x880000,
        bloodDropSize: 0.13, // Increased by 30% from 0.1 to 0.13
        bloodOpacityStart: 0.8,
        bloodFadeDurationS: 4500, // Increased from 900 to last more than one game day (4320s)
        bloodDropCreationDistanceThreshold: 1.5,
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
        this.setState('WANDERING'); // Initialize state to wandering
        
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

        this.updateIdleBehavior = function(delta) {
            // Only update idle behavior when deer is actually stationary
            if (!this.isMoving && (this.state === 'WANDERING' || this.state === 'THIRSTY')) {
                this.idleBehaviorTimer += delta;
                if (this.idleBehaviorTimer > this.idleBehaviorDuration) {
                    this.idleBehaviorTimer = 0;
                    this.idleBehaviorDuration = 3 + Math.random() * 4; // Random duration 3-7 seconds
                    
                    // Weighted random selection of idle behaviors
                    const rand = Math.random();
                    if (rand < 0.4) {
                        this.currentIdleBehavior = 'grazing'; // 40% chance
                    } else if (rand < 0.7) {
                        this.currentIdleBehavior = 'alert'; // 30% chance
                    } else if (rand < 0.9) {
                        this.currentIdleBehavior = 'idle'; // 20% chance
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

    respawn() {
        this.fallen = false;
        
        // TEMPORARY: Check spawn mode radio buttons for testing
        const spawnModeRadios = document.getElementsByName('deer-spawn-mode');
        
        let spawnMode = 'random'; // default
        for (const radio of spawnModeRadios) {
            if (radio.checked) {
                spawnMode = radio.value;
                break;
            }
        }
        
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
            console.warn(`Could not find safe deer spawn position after ${maxAttempts} attempts, using last position`);
            safePosition = new THREE.Vector3(x, y, z);
        }

        this.spawn(safePosition, Math.PI); // Facing the player
        
        this.generateNewWanderTarget();
    }

    setState(newState) {
        super.setState(newState);
        gameContext.deerState = newState; // For legacy access

        if (newState === 'WANDERING') {
            const wanderAngle = Math.random() * 2 * Math.PI;
            const wanderRadius = this.config.wanderMinRadius + Math.random() * this.config.wanderMaxRadiusAddition;
            this.wanderTarget.set(
                this.model.position.x + Math.sin(wanderAngle) * wanderRadius,
                0, // y is determined by terrain height
                this.model.position.z + Math.cos(wanderAngle) * wanderRadius
            );
            
            // Ensure wander target stays within world boundaries
            const worldSize = gameContext.terrain ? gameContext.terrain.geometry.parameters.width : 1000;
            const boundary = worldSize / 2 - this.config.worldBoundaryMargin;
            
            this.wanderTarget.x = Math.max(-boundary, Math.min(boundary, this.wanderTarget.x));
            this.wanderTarget.z = Math.max(-boundary, Math.min(boundary, this.wanderTarget.z));
        }
        
        if (newState === 'KILLED') {
            // Only start death sequence if not already started
            if (!this.deathSequenceStarted) {
                this.deathSequenceStarted = true;
                this.startDeathSequence();
            }
        }
        
    }

    fallDown() {
        if (this.fallen) return; // Already fallen
        
        this.fallen = true;
        
        // Simple, reliable death animation - no complex rotation
        const fallDuration = 800; // Shorter animation
        const startTime = Date.now();
        
        // Store original position and rotation
        const originalPosition = {
            x: this.model.position.x,
            y: this.model.position.y,
            z: this.model.position.z
        };
        const originalRotation = {
            x: this.model.rotation.x,
            y: this.model.rotation.y,
            z: this.model.rotation.z
        };
        
        // Calculate safe final position - on the ground with minimal offset
        const groundHeight = gameContext.getHeightAt(originalPosition.x, originalPosition.z);
        const safeHeight = groundHeight + 0.1; // Just 0.1 units above ground to prevent clipping
        const finalY = Math.max(safeHeight, originalPosition.y);
        
        const animateFall = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / fallDuration, 1);
            
            // Smooth easing
            const easeOut = 1 - Math.pow(1 - progress, 2);
            
            // ONLY rotate around Z axis to lay on side - no other rotation
            this.model.rotation.x = originalRotation.x; // Keep original X rotation
            this.model.rotation.y = originalRotation.y; // Keep original Y rotation  
            this.model.rotation.z = originalRotation.z + (Math.PI / 2) * easeOut; // Only Z rotation to 90 degrees
            
            // Keep X and Z position absolutely fixed
            this.model.position.x = originalPosition.x;
            this.model.position.z = originalPosition.z;
            
            // Animate Y position to safe height (never below ground)
            this.model.position.y = originalPosition.y + (finalY - originalPosition.y) * easeOut;
            
            // Double-check ground collision every frame
            const currentGround = gameContext.getHeightAt(this.model.position.x, this.model.position.z);
            const minY = currentGround + 0.1;
            if (this.model.position.y < minY) {
                this.model.position.y = minY;
            }
            
            if (progress < 1) {
                requestAnimationFrame(animateFall);
            } else {
                // Final position - absolutely ensure deer is above ground
                this.model.rotation.z = originalRotation.z + Math.PI / 2; // Exactly 90 degrees
                this.model.position.x = originalPosition.x;
                this.model.position.z = originalPosition.z;
                
                const finalGround = gameContext.getHeightAt(this.model.position.x, this.model.position.z);
                this.model.position.y = Math.max(finalGround + 0.1, finalY);
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
                return 'idle'; // Use idle for drinking (no specific drinking animation available)
                
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

    updateHeadTurning(distanceToPlayer, delta) {
        // Only turn head if deer has a head component and is in alert/fleeing state
        if ((this.state === 'ALERT' || this.state === 'FLEEING') && this.model.head) {
            // Calculate direction from deer to player
            const directionToPlayer = new THREE.Vector3()
                .subVectors(gameContext.player.position, this.model.position)
                .normalize();
            
            // Calculate target angle for head to look at player
            // Relative to deer's current body orientation
            const deerForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.model.quaternion);
            const targetAngle = Math.atan2(directionToPlayer.x, directionToPlayer.z) - Math.atan2(deerForward.x, deerForward.z);
            
            // Normalize angle to [-π, π]
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

        this.timeSinceLastDrink += delta;

        this.updateTracks();
        this.updateBloodDrops();

        this.updateIdleBehavior(delta);

        let speed = 0;
        let legAnimationSpeed = 0;

        const distanceToPlayer = this.model.position.distanceTo(gameContext.player.position);

        // Update head turning behavior based on deer state and player proximity
        this.updateHeadTurning(distanceToPlayer, delta);

        if (this.state !== 'FLEEING' && this.state !== 'WOUNDED' && this.state !== 'KILLED') {
            if (distanceToPlayer < this.config.fleeDistanceThreshold && this.fleeingEnabled) {
                this.setState('FLEEING');
            } else if (distanceToPlayer < this.config.alertDistanceThreshold) {
                if (this.state !== 'ALERT') {
                    this.setState('ALERT');
                }
            } else if (this.state === 'ALERT') {
                this.setState('WANDERING');
            }
        }

        switch (this.state) {
            case 'WANDERING':
                speed = this.config.speeds.wandering * delta;
                legAnimationSpeed = this.config.legAnimationSpeeds.wandering;
                if (this.model.position.distanceTo(this.wanderTarget) < this.config.wanderTargetReachThreshold) {
                    this.setState(Math.random() < 0.5 ? 'GRAZING' : 'WANDERING');
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
                this.smoothRotateTowards(gameContext.player.position, delta);
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
            const escapeDistance = Math.min(50, boundary * 0.3); // Move at least 30% toward center
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
            this.isMoving = isMoving;
        }
        
        // Movement-based blood drops for wounded deer
        if (this.state === 'WOUNDED' && this.model.position.distanceTo(this.lastBloodDropPosition) > this.config.tracking.bloodDropCreationDistanceThreshold) {
            this.createBloodDrop();
        }
        
        // Create tracks when deer is moving
        if (speed > 0 && this.model.position.distanceTo(this.lastTrackPosition) > this.config.tracking.trackCreationDistanceThreshold) {
            this.createTrack();
        }
        
        this.lastPosition.copy(this.model.position);
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

    /**
     * Smoothly rotate the deer towards a target position over time
     * @param {THREE.Vector3} targetPosition - The position to rotate towards
     * @param {number} delta - Time delta for smooth interpolation
     * @returns {boolean} - True if rotation is complete, false if still rotating
     */
    smoothRotateTowards(targetPosition, delta) {
        // Calculate the direction to the target
        const direction = new THREE.Vector3().subVectors(targetPosition, this.model.position);
        direction.y = 0; // Keep rotation only on Y axis (horizontal)
        
        // Prevent rotation if target is too close (prevents oscillation)
        if (direction.length() < 1.0) {
            return true; // Consider rotation complete if target is very close
        }
        
        direction.normalize();
        
        // Calculate the target rotation angle
        // Adjust for the deer model's natural orientation (model faces +X instead of -Z)
        const targetAngle = Math.atan2(-direction.z, direction.x);
        
        // Get current rotation angle
        let currentAngle = this.model.rotation.y;
        
        // Normalize angles to [-π, π] range
        while (currentAngle > Math.PI) currentAngle -= 2 * Math.PI;
        while (currentAngle < -Math.PI) currentAngle += 2 * Math.PI;
        
        let normalizedTargetAngle = targetAngle;
        while (normalizedTargetAngle > Math.PI) normalizedTargetAngle -= 2 * Math.PI;
        while (normalizedTargetAngle < -Math.PI) normalizedTargetAngle += 2 * Math.PI;
        
        // Calculate the shortest rotation direction
        let angleDifference = normalizedTargetAngle - currentAngle;
        if (angleDifference > Math.PI) angleDifference -= 2 * Math.PI;
        if (angleDifference < -Math.PI) angleDifference += 2 * Math.PI;
        
        // Check if we're close enough to the target angle (increased threshold)
        const rotationThreshold = 0.2; // Increased threshold to prevent oscillation
        if (Math.abs(angleDifference) < rotationThreshold) {
            return true; // Rotation complete - don't snap to exact angle to prevent jitter
        }
        
        // Calculate rotation step based on rotation speed and delta
        const rotationStep = this.config.rotationSpeed * delta;
        
        // Apply rotation step in the correct direction
        if (angleDifference > 0) {
            this.model.rotation.y += Math.min(rotationStep, angleDifference);
        } else {
            this.model.rotation.y += Math.max(-rotationStep, angleDifference);
        }
        
        return false; // Still rotating
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
        this.deathSequenceInProgress = true;
        
        // Simple death sequence - just play die animation and fall after a short delay
        this.deathAnimationStarted = true;
        this.changeAnimationIfNecessary();
        
        // Start the fall down animation after a short delay to let die animation begin
        setTimeout(() => {
            if (!this.fallen) { // Only fall if not already fallen
                this.fallDown();
            }
        }, 1000); // Wait 1 second before falling
    }
}

function forceDeerRespawn() {
    if (gameContext.deer) {
        gameContext.deer.respawn();
    }
}

export const deer = new Deer();
