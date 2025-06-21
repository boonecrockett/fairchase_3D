import * as THREE from 'three';
import { gameContext } from './context.js';
import { Animal } from './animal.js';

// --- DEER CONFIGURATION ---
const deerConfig = {
    name: 'deer',
    modelPath: 'assets/lowpolydeer/deer_buck.glb',
    scale: 0.5,
    yOffset: 0, // Add missing yOffset property
    bodyColor: 0x8B4513,
    bodySize: { x: 2, y: 1, z: 1 },
    heightOffset: 0.8,
    worldBoundaryMargin: 20,

    vitals: {
        size: { x: 0.5, y: 0.5, z: 0.5 },
        offset: { x: -0.2, y: 1.2, z: 0 }, // Moved up to chest level from 0.1 to 1.2
        debugColor: 0xFF0000,
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
        wandering: 1.2,
        thirsty: 2.5,
        fleeing: 9.0,
        wounded: 4.5,
    },
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
        trackShapeRadius: 0.24, // Tripled from 0.08 to 0.24 for better visibility
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

        this.fallen = false;
        this.woundCount = 0; // Track number of wounds for 3-wound kill logic
        this.timeSinceLastDrink = 0;
        this.wanderTarget = new THREE.Vector3();
        this.lastTrackPosition = new THREE.Vector3();
        this.lastBloodDropPosition = new THREE.Vector3();
        this.tracks = [];
        this.bloodDrops = [];

        // For efficient track creation
        this.trackMaterial = null;
        this.trackGeometry = null;

        // For efficient blood drop creation
        this.bloodDropMaterial = null;
        this.bloodDropGeometry = null;
        
        // Time-based blood accumulation for stationary wounded deer
        this.lastBloodDropTime = 0;
        this.stationaryBloodInterval = 3.0; // Create blood drop every 3 seconds when stationary and wounded
    }

    respawn() {
        this.fallen = false;
        
        // TEMPORARY: Check spawn mode radio buttons for testing
        const spawnModeRadios = document.getElementsByName('deer-spawn-mode');
        console.log(`🔍 DEBUG: Found ${spawnModeRadios.length} radio buttons`);
        
        let spawnMode = 'random'; // default
        for (const radio of spawnModeRadios) {
            console.log(`🔍 DEBUG: Radio ${radio.value} checked: ${radio.checked}`);
            if (radio.checked) {
                spawnMode = radio.value;
                break;
            }
        }
        
        console.log(`🔍 DEBUG: Selected spawn mode: ${spawnMode}`);
        
        let x, z, y;
        
        if (spawnMode === 'front') {
            // Spawn deer in front of player for testing
            x = 0;
            z = -60;
            y = gameContext.getHeightAt(x, z) + this.config.heightOffset;
            console.log('🧪 TESTING MODE: Spawning deer in front of player');
        } else {
            // Randomized spawning (production mode)
            const worldSize = gameContext.terrain?.geometry?.parameters?.width || 1000;
            const margin = this.config.respawnBoundaryMargin || 100;
            
            console.log(`🔍 DEBUG: worldSize = ${worldSize}, margin = ${margin}`);
            
            x = (Math.random() - 0.5) * (worldSize - margin * 2);
            z = (Math.random() - 0.5) * (worldSize - margin * 2);
            y = gameContext.getHeightAt(x, z) + this.config.heightOffset;
            console.log(`🌍 PRODUCTION MODE: Randomized deer spawning (worldSize: ${worldSize})`);
            console.log(`🔍 DEBUG: Random calculation: x=${x}, z=${z}`);
        }

        this.spawn(new THREE.Vector3(x, y, z), Math.PI); // Facing the player
        this.setState('WANDERING');
        
        console.log(`Deer respawned at position: ${x}, ${y}, ${z} (mode: ${spawnMode})`);
        console.log(`Deer model children count: ${this.model.children.length}`);
        console.log(`Deer isModelLoaded: ${this.isModelLoaded}`);
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
        }
        
        if (newState === 'KILLED') {
            this.fallDown();
        }
        
        console.log(`Deer state changed to: ${newState}`);
    }

    fallDown() {
        if (this.fallen) return; // Already fallen
        
        this.fallen = true;
        console.log('Deer falling down...');
        
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
        
        // Calculate safe final position - well above ground
        const groundHeight = gameContext.getHeightAt(originalPosition.x, originalPosition.z);
        const safeHeight = groundHeight + 3.0; // 3 units above ground for safety
        const finalY = Math.max(safeHeight, originalPosition.y);
        
        console.log(`Death animation: original Y=${originalPosition.y}, ground=${groundHeight}, final Y=${finalY}`);
        
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
            const minY = currentGround + 3.0;
            if (this.model.position.y < minY) {
                this.model.position.y = minY;
                console.log(`Ground collision prevented: forced Y to ${minY}`);
            }
            
            if (progress < 1) {
                requestAnimationFrame(animateFall);
            } else {
                // Final position - absolutely ensure deer is above ground
                this.model.rotation.z = originalRotation.z + Math.PI / 2; // Exactly 90 degrees
                this.model.position.x = originalPosition.x;
                this.model.position.z = originalPosition.z;
                
                const finalGround = gameContext.getHeightAt(this.model.position.x, this.model.position.z);
                this.model.position.y = Math.max(finalGround + 3.0, finalY);
                
                console.log(`Death animation complete: final position (${this.model.position.x}, ${this.model.position.y}, ${this.model.position.z})`);
                console.log(`Final ground height: ${finalGround}, deer Y: ${this.model.position.y}`);
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
                    console.warn('Track texture failed to load, using fallback color:', error);
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

        // Orient the track to match the deer's direction
        track.rotation.x = -Math.PI / 2; // Lay flat
        track.rotation.z = this.model.rotation.y; // Align with deer's yaw

        this.lastTrackPosition.copy(this.model.position);
        this.tracks.push({ mesh: track, creationTime: gameContext.clock.getElapsedTime() });
        
        // Ensure scene exists before adding
        if (gameContext.scene) {
            gameContext.scene.add(track);
        } else {
            console.error('Cannot add track: gameContext.scene is null');
        }
    }

    updateTracks() {
        const currentTime = gameContext.clock.getElapsedTime();
        const initialCount = this.tracks.length;
        this.tracks = this.tracks.filter(track => {
            const age = currentTime - track.creationTime;
            if (age > this.config.tracking.trackFadeDurationS) {
                console.log(`Track removed: age=${age.toFixed(1)}s, fadeTime=${this.config.tracking.trackFadeDurationS}s, currentTime=${currentTime.toFixed(1)}s`);
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
            console.log(`Track count changed: ${initialCount} -> ${this.tracks.length}, currentTime=${currentTime.toFixed(1)}s`);
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
                    console.log('Blood texture loaded successfully');
                },
                undefined,
                (error) => {
                    // Error: keep using color-based fallback
                    console.warn('Blood texture failed to load, using fallback color:', error);
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
            console.log('Blood drop created at position:', drop.position.x, drop.position.y, drop.position.z);
        } else {
            console.error('Cannot add blood drop: gameContext.scene is null');
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
                console.warn('Shot blood texture failed to load, using fallback color:', error);
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
            console.log('Shot blood indicator created at hit location');
        } else {
            console.error('Cannot add shot blood indicator: gameContext.scene is null');
        }
    }

    updateBloodDrops() {
        const currentTime = gameContext.clock.getElapsedTime();
        const initialCount = this.bloodDrops.length;
        this.bloodDrops = this.bloodDrops.filter(drop => {
            const age = currentTime - drop.creationTime;
            const opacity = this.config.tracking.bloodOpacityStart - (age / this.config.tracking.bloodFadeDurationS);

            if (opacity <= 0) {
                console.log(`Blood drop removed: age=${age.toFixed(1)}s, fadeTime=${this.config.tracking.bloodFadeDurationS}s, currentTime=${currentTime.toFixed(1)}s`);
                gameContext.scene.remove(drop.mesh);
                drop.mesh.material.dispose(); // Dispose cloned material
                return false; // Remove from array
            }
            
            // Update opacity
            drop.mesh.material.opacity = opacity;
            return true; // Keep in array
        });
        if (this.bloodDrops.length !== initialCount) {
            console.log(`Blood drop count changed: ${initialCount} -> ${this.bloodDrops.length}, currentTime=${currentTime.toFixed(1)}s`);
        }
    }

    update(delta) {
        if (!this.isModelLoaded || this.state === 'DEAD') return;

        super.update(delta);
        this.timeSinceLastDrink += delta;

        this.updateTracks();
        this.updateBloodDrops();

        let speed = 0;
        let legAnimationSpeed = 0;

        const distanceToPlayer = this.model.position.distanceTo(gameContext.player.position);

        if (this.state !== 'FLEEING' && this.state !== 'WOUNDED' && this.state !== 'KILLED') {
            if (distanceToPlayer < this.config.fleeDistanceThreshold) {
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
                    this.model.lookAt(this.wanderTarget.x, this.model.position.y, this.wanderTarget.z);
                    this.model.translateZ(speed); // Positive translateZ like original working code
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
                        this.model.lookAt(waterSource);
                        this.model.translateZ(speed); // Positive translateZ like original working code
                    }
                } else {
                    this.setState('WANDERING'); // No water found
                }
                break;
            case 'GRAZING':
                if (this.stateTimer > this.config.stateTimers.grazing) {
                    this.setState('WANDERING');
                }
                break;
            case 'DRINKING':
                if (this.stateTimer > this.config.stateTimers.drinking) {
                    this.timeSinceLastDrink = 0;
                    this.setState('WANDERING');
                }
                break;
            case 'ALERT':
                this.model.lookAt(gameContext.player.position.x, this.model.position.y, gameContext.player.position.z);
                break;
            case 'FLEEING':
                speed = this.config.speeds.fleeing * delta;
                legAnimationSpeed = this.config.legAnimationSpeeds.fleeing;
                const fleeDirFromPlayer = new THREE.Vector3().subVectors(this.model.position, gameContext.player.position).normalize();
                this.model.lookAt(new THREE.Vector3().addVectors(this.model.position, fleeDirFromPlayer));
                this.model.translateZ(speed); // Positive translateZ like original working code
                if (this.stateTimer > this.config.stateTimers.fleeing) this.setState('WANDERING');
                break;
            case 'WOUNDED':
                speed = this.config.speeds.wounded * delta;
                legAnimationSpeed = this.config.legAnimationSpeeds.wounded;
                const woundFleeDir = new THREE.Vector3().subVectors(this.model.position, gameContext.player.position).normalize();
                this.model.lookAt(new THREE.Vector3().addVectors(this.model.position, woundFleeDir));
                this.model.translateZ(speed); // Positive translateZ like original working code
                
                // Time-based blood accumulation for stationary wounded deer
                const currentTime = gameContext.clock.getElapsedTime();
                if (currentTime - this.lastBloodDropTime > this.stationaryBloodInterval) {
                    this.createBloodDrop();
                    this.lastBloodDropTime = currentTime;
                }
                break;
        }

        // --- Boundary Checking ---
        const worldSize = gameContext.terrain.geometry.parameters.width;
        const boundary = worldSize / 2 - this.config.worldBoundaryMargin;
        
        // Check if deer is outside boundaries and clamp position
        let wasOutsideBoundary = false;
        if (this.model.position.x > boundary) {
            this.model.position.x = boundary;
            wasOutsideBoundary = true;
        } else if (this.model.position.x < -boundary) {
            this.model.position.x = -boundary;
            wasOutsideBoundary = true;
        }
        
        if (this.model.position.z > boundary) {
            this.model.position.z = boundary;
            wasOutsideBoundary = true;
        } else if (this.model.position.z < -boundary) {
            this.model.position.z = -boundary;
            wasOutsideBoundary = true;
        }

        // If deer was outside boundary, redirect it toward center
        if (wasOutsideBoundary) {
            const centerDir = new THREE.Vector3(0, this.model.position.y, 0).sub(this.model.position).normalize();
            this.model.lookAt(this.model.position.clone().add(centerDir));
            // Force a new wandering state to get a valid target inside the map
            if (this.state !== 'FLEEING' && this.state !== 'WOUNDED' && this.state !== 'KILLED') {
                this.setState('WANDERING');
            }
        }

        if (speed > 0) {
            if (this.model.position.distanceTo(this.lastTrackPosition) > this.config.tracking.trackCreationDistanceThreshold) {
                this.createTrack();
            }
            // Movement-based blood drops for wounded deer
            if (this.state === 'WOUNDED' && this.model.position.distanceTo(this.lastBloodDropPosition) > this.config.tracking.bloodDropCreationDistanceThreshold) {
                this.createBloodDrop();
            }
        }
    }

    // Override createVitals to add a permanent, oversized primitive hitbox
    createVitals(parent) {
        // Call the parent class method to create the actual vitals hitbox
        super.createVitals(parent);
        
        console.log('=== DEER CREATEVITALS DEBUG ===');
        console.log('createVitals called with parent:', parent ? parent.name || 'unnamed parent' : 'null parent');
        console.log('this.model exists:', !!this.model);
        console.log('Deer model position:', this.model.position.x, this.model.position.y, this.model.position.z);
        
        // Create permanent oversized vitals hitbox for debugging (now invisible)
        const vitalsHitboxGeometry = new THREE.BoxGeometry(200, 200, 200);
        const vitalsHitboxMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0, // Make completely invisible
            wireframe: true, // Use wireframe so it's always visible
            depthTest: false, // Render on top of everything
            depthWrite: false
        });
        
        this.permanentVitalsHitbox = new THREE.Mesh(vitalsHitboxGeometry, vitalsHitboxMaterial);
        this.permanentVitalsHitbox.position.set(
            this.config.vitals.offset.x,
            this.config.vitals.offset.y + 1.5 + 900 - 250, // Adjusted height
            this.config.vitals.offset.z - 125 // Moved forward by 75 units, then back 200 (net -125)
        );
        this.permanentVitalsHitbox.name = 'vitals'; // Make it register as vitals for hit detection
        this.permanentVitalsHitbox.visible = false; // Make completely invisible
        this.permanentVitalsHitbox.renderOrder = 999; // High render order
        
        console.log('Vitals hitbox mesh created');
        
        // Add to the body mesh parent so it moves with the deer
        parent.add(this.permanentVitalsHitbox);
        
        console.log('Permanent vitals hitbox created and added to deer body mesh');
        console.log('Vitals hitbox size: 200x200x200 units (larger size for better visibility)');
        console.log('Vitals hitbox position:', this.config.vitals.offset.x, this.config.vitals.offset.y, this.config.vitals.offset.z);
        console.log('Vitals hitbox material: red semi-transparent wireframe');
        console.log('Vitals hitbox added to body mesh parent');
        console.log('Vitals hitbox visible:', this.permanentVitalsHitbox.visible);
        
        // Create a permanent brain hitbox for debugging
        if (!this.permanentBrainHitbox) {
            console.log('Creating permanent brain hitbox...');
            
            // Brain hitbox - smaller than vitals, positioned at head
            const brainHitboxGeometry = new THREE.BoxGeometry(
                80, // 80 units wide - smaller than vitals
                80, // 80 units tall - smaller than vitals
                80  // 80 units deep - smaller than vitals
            );
            const brainHitboxMaterial = new THREE.MeshBasicMaterial({ 
                color: 0x00ff00, // Bright green to distinguish from vitals
                transparent: true, // Make it semi-transparent
                opacity: 0, // Make completely invisible
                wireframe: true, // Use wireframe so it's always visible
                depthTest: false, // Render on top of everything
                depthWrite: false // Don't write to depth buffer
            });
            this.permanentBrainHitbox = new THREE.Mesh(brainHitboxGeometry, brainHitboxMaterial);
            
            console.log('Brain hitbox mesh created');
            
            // Position it at the head area - forward and higher than vitals
            this.permanentBrainHitbox.position.set(
                this.config.vitals.offset.x, // Same X as vitals
                this.config.vitals.offset.y + 1.5 + 900 - 250 + 50 + 800 - 400 - 70, // Higher than vitals by 50 units + 800 more - 400 - 70
                this.config.vitals.offset.z - 125 - 50 - 300  // Further forward than vitals by 50 units + 300 more
            );
            this.permanentBrainHitbox.name = 'brain'; // Make it register as brain for hit detection
            this.permanentBrainHitbox.visible = false; // Make completely invisible
            this.permanentBrainHitbox.renderOrder = 1000; // Render on top of vitals hitbox
            
            console.log('Brain hitbox configured, adding to parent (body mesh)...');
            
            // Add to the body mesh parent so it moves with the deer
            parent.add(this.permanentBrainHitbox);
            
            console.log('Permanent brain hitbox created and added to deer body mesh');
            console.log('Brain hitbox size: 80x80x80 units (smaller than vitals)');
            console.log('Brain hitbox position: forward and higher than vitals');
            console.log('Brain hitbox material: green semi-transparent wireframe');
            console.log('Brain hitbox added to body mesh parent');
            console.log('Brain hitbox visible:', this.permanentBrainHitbox.visible);
        } else {
            console.log('Permanent brain hitbox already exists');
        }
    }

}

export const deer = new Deer();
