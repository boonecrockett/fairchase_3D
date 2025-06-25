/**
 * DeerHitbox - Manages hitbox creation, positioning, and collision detection for deer
 * Extracted from deer.js as part of modularization effort
 */

import * as THREE from 'three';

export class DeerHitbox {
    constructor(deer, config) {
        this.deer = deer;
        this.config = config;
        this.permanentVitalsHitbox = null;
    }

    /**
     * Create vitals hitbox - overrides base Animal class method
     * @param {THREE.Object3D} parent - Parent object to attach hitbox to
     */
    createVitals(parent) {
        // Call base class method first
        this.createBaseVitals(parent);
        
        // Don't create any additional hitbox until we solve the underlying issue
        return;
    }

    /**
     * Base vitals creation from Animal class
     * @param {THREE.Object3D} parent - Parent object to attach hitbox to
     */
    createBaseVitals(parent) {
        if (!this.config.vitals) return;

        const vitalsGeometry = new THREE.BoxGeometry(
            this.config.vitals.size.x, 
            this.config.vitals.size.y, 
            this.config.vitals.size.z
        );
        const vitalsMaterial = new THREE.MeshBasicMaterial({ 
            color: this.config.vitals.debugColor 
        });
        const vitals = new THREE.Mesh(vitalsGeometry, vitalsMaterial);
        vitals.visible = false; // Hidden for normal gameplay
        vitals.position.set(
            this.config.vitals.offset.x, 
            this.config.vitals.offset.y, 
            this.config.vitals.offset.z
        );
        vitals.name = 'vitals';
        parent.add(vitals);
        this.deer.model.vitals = vitals;
    }

    /**
     * Create a simple, clean vitals hitbox
     */
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
        this.deer.model.add(this.permanentVitalsHitbox);
    }

    /**
     * Update hitbox positions based on current deer position and rotation
     */
    updateHitboxes() {
        // Update hitbox positions based on current deer position and rotation
        // (This method should update hitbox geometry, not trigger respawn)
        
        // TODO: Implement actual hitbox position updates when needed
        // For now, hitboxes are attached to the deer model and move automatically
        
        // If we had detached hitboxes, we would update their positions here:
        // if (this.permanentVitalsHitbox) {
        //     this.permanentVitalsHitbox.position.copy(this.deer.model.position);
        //     this.permanentVitalsHitbox.rotation.copy(this.deer.model.rotation);
        // }
    }

    /**
     * Make vitals hitbox temporarily visible for raycasting
     */
    showVitalsForRaycasting() {
        const vitalsBox = this.deer.model.vitals;
        if (vitalsBox) {
            vitalsBox.visible = true;
        }
    }

    /**
     * Hide vitals hitbox after raycasting
     */
    hideVitalsAfterRaycasting() {
        const vitalsBox = this.deer.model.vitals;
        if (vitalsBox) {
            vitalsBox.visible = false;
        }
    }

    /**
     * Check if a hit name corresponds to a vital area
     * @param {string} hitName - Name of the hit area
     * @returns {boolean} True if hit is vital
     */
    isVitalHit(hitName) {
        return hitName === 'vitals';
    }

    /**
     * Get vitals hitbox for external access
     * @returns {THREE.Mesh|null} The vitals hitbox mesh
     */
    getVitalsHitbox() {
        return this.deer.model.vitals || this.permanentVitalsHitbox;
    }

    /**
     * Clean up hitbox resources
     */
    dispose() {
        if (this.permanentVitalsHitbox) {
            if (this.permanentVitalsHitbox.parent) {
                this.permanentVitalsHitbox.parent.remove(this.permanentVitalsHitbox);
            }
            this.permanentVitalsHitbox.geometry?.dispose();
            this.permanentVitalsHitbox.material?.dispose();
            this.permanentVitalsHitbox = null;
        }

        if (this.deer.model.vitals) {
            if (this.deer.model.vitals.parent) {
                this.deer.model.vitals.parent.remove(this.deer.model.vitals);
            }
            this.deer.model.vitals.geometry?.dispose();
            this.deer.model.vitals.material?.dispose();
            this.deer.model.vitals = null;
        }
    }
}
