// --- DEER VISUAL EFFECTS SYSTEM ---
// Handles blood drops, tracks, and visual indicators
// Extracted from deer.js for better modularity

import * as THREE from 'three';
import { gameContext } from './context.js';

// Shared scratch vector reused by effect creation (avoids a per-track
// Vector3 allocation for the travel-direction calculation).
const _tmpDir = new THREE.Vector3();

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
        
        // Materials and geometries (initialized lazily). Geometries are
        // intentionally shared across every track/blood instance so we don't
        // allocate and upload a fresh PlaneGeometry per step. Size variation
        // for blood drops is applied via mesh.scale instead. Materials are
        // still cloned per instance because each one animates its own
        // opacity as it fades out.
        this.trackMaterial = null;
        this.trackGeometry = null;
        this.bloodDropMaterial = null;
        this.bloodDropGeometry = null;
        this.shotBloodMaterial = null;
        this.shotBloodGeometry = null;
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

        if (!this.trackGeometry) {
            const size = this.config.tracking.trackShapeRadius * 2;
            this.trackGeometry = new THREE.PlaneGeometry(size, size);
        }

        // Share geometry across all tracks; clone material so each track can
        // fade out independently.
        const track = new THREE.Mesh(this.trackGeometry, this.trackMaterial.clone());

        track.position.copy(this.deer.model.position);
        
        // Add subtle left/right randomization (max quarter the width of a track)
        const trackWidth = this.config.tracking.trackShapeRadius * 2;
        const maxOffset = trackWidth * 0.25; // Quarter the width of a track for less randomization
        const randomOffsetX = (Math.random() - 0.5) * maxOffset; // Random between -maxOffset/4 and +maxOffset/4
        const randomOffsetZ = (Math.random() - 0.5) * maxOffset;
        
        track.position.x += randomOffsetX;
        track.position.z += randomOffsetZ;
        
        // Use optimized cached height detection for better performance
        const finalY = gameContext.getCachedHeightAt(track.position.x, track.position.z) + 0.015;
        
        track.position.y = finalY;
        track.rotation.x = -Math.PI / 2; // Lay flat on ground
        
        // Calculate actual movement direction from position change using a
        // reused scratch vector (no per-track Vector3 allocation).
        _tmpDir.subVectors(this.deer.model.position, this.lastTrackPosition).normalize();

        // Convert movement direction to rotation angle and add 180° correction
        const travelAngle = Math.atan2(_tmpDir.x, _tmpDir.z) + Math.PI;
        track.rotation.z = travelAngle; // Orient track to actual travel direction with correction
        
        this.lastTrackPosition.copy(this.deer.model.position);
        this.tracks.push({ mesh: track, creationTime: gameContext.clock.getElapsed() });
        
        // Ensure scene exists before adding
        if (gameContext.scene) {
            gameContext.scene.add(track);
        }
    }

    updateTracks() {
        const currentTime = gameContext.clock.getElapsed();
        // Use in-place removal to avoid creating new array every frame
        let writeIndex = 0;
        for (let i = 0; i < this.tracks.length; i++) {
            const track = this.tracks[i];
            const age = currentTime - track.creationTime;
            if (age > this.config.tracking.trackFadeDurationS) {
                gameContext.scene.remove(track.mesh);
                // Geometry is shared across all tracks - do NOT dispose here.
                track.mesh.material.dispose();
            } else {
                // Update opacity and keep in array
                track.mesh.material.opacity = 1.0 - (age / this.config.tracking.trackFadeDurationS);
                this.tracks[writeIndex++] = track;
            }
        }
        this.tracks.length = writeIndex; // Truncate array in place
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

        // Lazily create a single shared unit-size geometry and reuse it for
        // every blood drop. Size variation is applied via mesh.scale below.
        if (!this.bloodDropGeometry) {
            const baseDrop = this.config.tracking.bloodDropSize * 2;
            this.bloodDropGeometry = new THREE.PlaneGeometry(baseDrop, baseDrop);
        }
        const sizeVariation = 1 + (Math.random() * 0.3); // 1.0 to 1.3 (up to 30% bigger)

        const drop = new THREE.Mesh(this.bloodDropGeometry, this.bloodDropMaterial.clone());
        drop.scale.setScalar(sizeVariation);

        // Randomize position (±1 units left/right/forward/backward from deer position)
        const randomOffsetX = (Math.random() - 0.5) * 2; // -1 to +1 units (reduced from 4 to 2)
        const randomOffsetZ = (Math.random() - 0.5) * 2; // -1 to +1 units (reduced from 4 to 2)
        
        drop.position.copy(this.deer.model.position);
        drop.position.x += randomOffsetX;
        drop.position.z += randomOffsetZ;
        
        // Use optimized cached height detection for better performance
        const finalY = gameContext.getCachedHeightAt(drop.position.x, drop.position.z) + 0.02;
        
        drop.position.y = finalY;
        drop.rotation.x = -Math.PI / 2; // Lay flat
        drop.rotation.z = Math.random() * Math.PI * 2; // Randomize rotation

        this.lastBloodDropPosition.copy(this.deer.model.position);
        this.bloodDrops.push({ mesh: drop, creationTime: gameContext.clock.getElapsed() });
        
        // Store blood drop position for GPS map
        if (!gameContext.bloodDrops) gameContext.bloodDrops = [];
        gameContext.bloodDrops.push({ x: drop.position.x, z: drop.position.z });
        
        // Ensure scene exists before adding
        if (gameContext.scene) {
            gameContext.scene.add(drop);
        }
    }

    createShotBloodIndicator(hitPosition) {
        // Initialize material once for efficiency
        if (!this.shotBloodMaterial) {
            const textureLoader = new THREE.TextureLoader();
            
            this.shotBloodMaterial = new THREE.MeshLambertMaterial({
                color: 0xff0000, // Brighter red for shot indicators
                transparent: true,
                opacity: 0.9 // More visible than trail blood
            });
            
            // Try to load texture, but don't block on it
            textureLoader.load(
                'assets/textures/blood_drops.png',
                (texture) => {
                    this.shotBloodMaterial.map = texture;
                    this.shotBloodMaterial.needsUpdate = true;
                },
                undefined,
                (error) => {
                    // Error: keep using color-based fallback
                }
            );
        }
        const shotBloodMaterial = this.shotBloodMaterial;

        // Larger size for shot indicators. Share one geometry across all
        // shot-blood indicators; its size is fixed.
        if (!this.shotBloodGeometry) {
            const shotBloodSize = this.config.tracking.bloodDropSize * 3;
            this.shotBloodGeometry = new THREE.PlaneGeometry(shotBloodSize, shotBloodSize);
        }
        const shotBlood = new THREE.Mesh(this.shotBloodGeometry, shotBloodMaterial);

        // Position at hit location
        shotBlood.position.copy(hitPosition);
        shotBlood.position.y = gameContext.getHeightAt(shotBlood.position.x, shotBlood.position.z) + 0.02; // Slightly higher than trail blood
        shotBlood.rotation.x = -Math.PI / 2; // Lay flat
        shotBlood.rotation.z = Math.random() * Math.PI * 2; // Randomize rotation

        // Add to scene and track for cleanup
        if (gameContext.scene) {
            gameContext.scene.add(shotBlood);
            this.bloodDrops.push({ mesh: shotBlood, creationTime: gameContext.clock.getElapsed() });
        }
    }

    updateBloodDrops() {
        const currentTime = gameContext.clock.getElapsed();
        // Use in-place removal to avoid creating new array every frame
        let writeIndex = 0;
        for (let i = 0; i < this.bloodDrops.length; i++) {
            const drop = this.bloodDrops[i];
            const age = currentTime - drop.creationTime;
            const opacity = this.config.tracking.bloodOpacityStart - (age / this.config.tracking.bloodFadeDurationS);

            if (opacity <= 0) {
                // Remove from scene and dispose material. Geometry is shared
                // between blood drops and shot indicators - do NOT dispose.
                gameContext.scene.remove(drop.mesh);
                drop.mesh.material.dispose();
            } else {
                // Update opacity and keep in array
                drop.mesh.material.opacity = opacity;
                this.bloodDrops[writeIndex++] = drop;
            }
        }
        this.bloodDrops.length = writeIndex; // Truncate array in place
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
        // Remove all tracks. Only materials are per-instance; geometries are
        // shared and disposed in dispose() when the deer itself is torn down.
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

    // Full teardown: called when the deer instance is destroyed. Disposes
    // the shared geometries and material prototypes we created lazily.
    dispose() {
        this.cleanup();
        if (this.trackGeometry) { this.trackGeometry.dispose(); this.trackGeometry = null; }
        if (this.bloodDropGeometry) { this.bloodDropGeometry.dispose(); this.bloodDropGeometry = null; }
        if (this.shotBloodGeometry) { this.shotBloodGeometry.dispose(); this.shotBloodGeometry = null; }
        if (this.trackMaterial) { this.trackMaterial.dispose(); this.trackMaterial = null; }
        if (this.bloodDropMaterial) { this.bloodDropMaterial.dispose(); this.bloodDropMaterial = null; }
        if (this.shotBloodMaterial) { this.shotBloodMaterial.dispose(); this.shotBloodMaterial = null; }
    }
}
