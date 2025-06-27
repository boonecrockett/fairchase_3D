// --- DEER VISUAL EFFECTS SYSTEM ---
// Handles blood drops, tracks, and visual indicators
// Extracted from deer.js for better modularity

import * as THREE from 'three';
import { gameContext } from './context.js';

export class DeerEffects {
    constructor(deer, config) {
        this.deer = deer;
        this.config = config;
        
        // Visual effects arrays
        this.bloodDrops = [];
        this.tracks = [];
        
        // Position tracking for effect creation
        this.lastBloodDropPosition = new THREE.Vector3();
        this.lastTrackPosition = new THREE.Vector3();
        
        // Materials (initialized lazily)
        this.trackMaterial = null;
        this.bloodDropMaterial = null;
    }

    createTrack() {
        // Only create tracks if deer has moved a reasonable distance
        const MIN_TRACK_DISTANCE = 1.5; // Minimum distance between tracks (in world units)
        const currentPosition = this.deer.model.position;
        
        // Check if we've moved far enough since the last track
        if (this.lastTrackPosition.distanceTo(currentPosition) < MIN_TRACK_DISTANCE) {
            return; // Don't create a track yet
        }
        
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

        track.position.copy(this.deer.model.position);
        
        // Add subtle left/right randomization (max half the width of a track)
        const trackWidth = this.config.tracking.trackShapeRadius * 2;
        const maxOffset = trackWidth * 0.5; // Half the width of a track
        const randomOffsetX = (Math.random() - 0.5) * maxOffset; // Random between -maxOffset/2 and +maxOffset/2
        const randomOffsetZ = (Math.random() - 0.5) * maxOffset;
        
        track.position.x += randomOffsetX;
        track.position.z += randomOffsetZ;
        
        // Use raycasting for more accurate terrain height detection
        let finalY;
        if (gameContext.terrain && gameContext.terrain.geometry) {
            const raycaster = new THREE.Raycaster();
            raycaster.set(new THREE.Vector3(track.position.x, 100, track.position.z), new THREE.Vector3(0, -1, 0));
            const intersects = raycaster.intersectObject(gameContext.terrain);
            
            if (intersects.length > 0) {
                finalY = intersects[0].point.y + 0.015; // Slightly above ground with more clearance
            } else {
                // Fallback to getHeightAt if raycasting fails
                finalY = gameContext.getHeightAt(track.position.x, track.position.z) + 0.015;
            }
        } else {
            // Fallback to getHeightAt if terrain is not available
            finalY = gameContext.getHeightAt(track.position.x, track.position.z) + 0.015;
        }
        
        track.position.y = finalY;
        track.rotation.x = -Math.PI / 2; // Lay flat on ground
        
        // Calculate actual movement direction from position change
        const movementDirection = new THREE.Vector3()
            .subVectors(this.deer.model.position, this.lastTrackPosition)
            .normalize();
        
        // Convert movement direction to rotation angle and add 180° correction
        const travelAngle = Math.atan2(movementDirection.x, movementDirection.z) + Math.PI;
        track.rotation.z = travelAngle; // Orient track to actual travel direction with correction
        
        this.lastTrackPosition.copy(this.deer.model.position);
        this.tracks.push({ mesh: track, creationTime: gameContext.clock.getElapsedTime() });
        
        // Ensure scene exists before adding
        if (gameContext.scene) {
            gameContext.scene.add(track);
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
        
        drop.position.copy(this.deer.model.position);
        drop.position.x += randomOffsetX;
        drop.position.z += randomOffsetZ;
        
        // Use raycasting for more accurate terrain height detection
        let finalY;
        if (gameContext.terrain && gameContext.terrain.geometry) {
            const raycaster = new THREE.Raycaster();
            raycaster.set(new THREE.Vector3(drop.position.x, 100, drop.position.z), new THREE.Vector3(0, -1, 0));
            const intersects = raycaster.intersectObject(gameContext.terrain);
            
            if (intersects.length > 0) {
                finalY = intersects[0].point.y + 0.02; // Slightly above ground with more clearance
            } else {
                // Fallback to getHeightAt if raycasting fails
                finalY = gameContext.getHeightAt(drop.position.x, drop.position.z) + 0.02;
            }
        } else {
            // Fallback to getHeightAt if terrain is not available
            finalY = gameContext.getHeightAt(drop.position.x, drop.position.z) + 0.02;
        }
        
        drop.position.y = finalY;
        drop.rotation.x = -Math.PI / 2; // Lay flat
        drop.rotation.z = Math.random() * Math.PI * 2; // Randomize rotation

        this.lastBloodDropPosition.copy(this.deer.model.position);
        this.bloodDrops.push({ mesh: drop, creationTime: gameContext.clock.getElapsedTime() });
        
        // Ensure scene exists before adding
        if (gameContext.scene) {
            gameContext.scene.add(drop);
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

    // Update all visual effects
    update() {
        this.updateTracks();
        this.updateBloodDrops();
    }

    // Check if blood drop should be created based on distance
    shouldCreateBloodDrop() {
        return this.deer.state === 'WOUNDED' && 
               this.deer.model.position.distanceTo(this.lastBloodDropPosition) > this.config.tracking.bloodDropCreationDistanceThreshold;
    }

    // Check if track should be created based on movement and distance
    shouldCreateTrack(speed) {
        return speed > 0 && 
               this.deer.model.position.distanceTo(this.lastTrackPosition) > this.config.tracking.trackCreationDistanceThreshold;
    }

    // Cleanup all effects (useful for respawning)
    cleanup() {
        // Remove all tracks
        this.tracks.forEach(track => {
            if (gameContext.scene) {
                gameContext.scene.remove(track.mesh);
            }
            track.mesh.material.dispose();
        });
        this.tracks = [];

        // Remove all blood drops
        this.bloodDrops.forEach(drop => {
            if (gameContext.scene) {
                gameContext.scene.remove(drop.mesh);
            }
            drop.mesh.material.dispose();
        });
        this.bloodDrops = [];

        // Reset positions
        this.lastTrackPosition.set(0, 0, 0);
        this.lastBloodDropPosition.set(0, 0, 0);
    }
}
