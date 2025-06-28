/**
 * DeerHitbox - Manages hitbox creation, positioning, and collision detection for deer.
 * This class wraps the global collision system, which uses Three.js raycasting.
 */

import * as THREE from 'three';
import { collisionSystem } from './collision.js';

export class DeerHitbox {
    constructor(deer, config) {
        this.deer = deer;
        this.config = config;
        this.collisionBody = null;
        this.debugMode = false;
    }

    /**
     * Create visible wireframe hitboxes for collision detection
     * @param {THREE.Object3D} parent - Parent object (deer model)
     */
    createVitals(parent) {
        // Create visible wireframe hitboxes that ARE the collision hitboxes
        collisionSystem.createDebugHitboxes(this.deer);
        console.log('Visible wireframe hitboxes created for collision detection');
    }



    /**
     * Toggle debug visualization of hit zones
     */
    toggleDebugMode() {
        this.debugMode = !this.debugMode;
        if (this.deer && this.deer.hitboxMeshes) {
            this.deer.hitboxMeshes.forEach(mesh => {
                mesh.visible = this.debugMode;
            });
        }
        console.log(`Hitbox debug mode set to: ${this.debugMode ? 'ON' : 'OFF'}`);
        return this.debugMode;
    }

    /**
     * Perform raycast hit detection using physics system
     * @param {THREE.Vector3} from - Ray start position
     * @param {THREE.Vector3} to - Ray end position
     * @returns {Object} Hit result with zone information
     */
    raycastHit(from, to) {
        return collisionSystem.raycast(from, to, this.deer);
    }

    /**
     * Check if a hit zone corresponds to a vital area
     * @param {string} hitZone - Name of the hit zone
     * @returns {boolean} True if hit is vital
     */
    isVitalHit(hitZone) {
        return hitZone === 'vitals' || hitZone === 'brain';
    }

    /**
     * Get hit zone name from legacy hitbox reference (for compatibility)
     * @param {THREE.Mesh} hitbox - Legacy hitbox mesh
     * @returns {string} Hit zone name
     */
    getHitZoneFromLegacyHitbox(hitbox) {
        if (!hitbox || !hitbox.name) return 'body';
        return hitbox.name;
    }

    /**
     * Legacy compatibility methods - no longer needed with Three.js raycasting
     */
    showVitalsForRaycasting() {
        // No longer needed - Three.js raycasting handles visibility
    }

    hideVitalsAfterRaycasting() {
        // No longer needed - Three.js raycasting handles visibility
    }

    /**
     * Get collision body for external access
     * @returns {null} The collision body (legacy, always null)
     */
    getCollisionBody() {
        return this.collisionBody;
    }

    /**
     * Clean up collision resources
     */
    dispose() {
        // Remove collision body from Three.js scene
        collisionSystem.removeDeerCollisionBody(this.deer);
        this.collisionBody = null;
        
        console.log('Deer collision system disposed');
    }
}
