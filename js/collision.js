// --- COLLISION SYSTEM ---
// Three.js-based hit detection using raycasting
// Replaces manual hitbox system with robust collision detection

import { deerConfig } from './deer-config.js';
import { gameContext } from './context.js';
import * as THREE from 'three';

class CollisionSystem {
    constructor() {
        this.raycaster = null;
        this.debugMode = false; // Disable debug visualization
        this.init();
    }

    init() {
        // Create Three.js raycaster for hit detection
        this.raycaster = new THREE.Raycaster();
        
        console.log('Collision system initialized');
    }

    // Create debug hitboxes that ARE the actual collision hitboxes
    createDebugHitboxes(deer) {
        if (!deer.model) {
            console.warn('Cannot create collision body: deer model not loaded');
            return null;
        }

        // Create hitbox meshes for each hit zone using current config
        const hitZones = ['vitals', 'gut', 'rear', 'brain', 'spine', 'neck', 'shoulderLeft', 'shoulderRight'];
        const hitboxes = {};
        
        hitZones.forEach(zoneName => {
            const config = deerConfig[zoneName];
            if (!config) return;

            // --- Hitbox Adjustments ---
            let size = { ...config.size };
            let offset = { ...config.offset };

            // --- Base Scaling ---
            let scale = 1.0;
            if (zoneName === 'brain') {
                // All brain scaling requests combined: 1.1 * 0.95 * 0.80 * 0.90 * 0.90
                scale = 0.67716;
            } else {
                // All other boxes scaling requests combined: 1.1 * 1.1
                scale = 1.21;
            }
            size.x *= scale;
            size.y *= scale;
            size.z *= scale;

            // --- Per-Zone Dimension & Position Adjustments ---
            if (['vitals', 'gut', 'rear'].includes(zoneName)) {
                size.y *= 1.25; // Increase vertical by 25%
            }

            if (zoneName === 'vitals') {
                size.z *= 1.20; // Increase depth by 20%
            }

            if (zoneName === 'gut') {
                const originalZ = size.z;
                size.z *= 1.50; // Extend rearward by 50%
                offset.z -= (size.z - originalZ) / 2; // Adjust position for extension
            }

            if (zoneName === 'brain') {
                // Move rearward by 20% of its final depth
                offset.z -= size.z * 0.20;
            }

            // --- Final Y-Offset Calculation ---
            if (zoneName === 'spine') {
                // Position spine on top of the vitals box.
                // First, calculate the final dimensions and offset of the vitals box.
                const vitalsConfig = deerConfig['vitals'];
                let vitalsSize = { ...vitalsConfig.size };
                let vitalsOffset = { ...vitalsConfig.offset };
                const vitalsScale = 1.21; // Vitals base scale

                vitalsSize.x *= vitalsScale;
                vitalsSize.y *= vitalsScale;
                vitalsSize.z *= vitalsScale;
                vitalsSize.y *= 1.25; // Vitals vertical increase
                vitalsSize.z *= 1.20; // Vitals depth increase

                // Vitals moves down by 40% of its final height (20% + 20%)
                vitalsOffset.y -= vitalsSize.y * 0.40;

                // Spine's center is vitals' top + half of spine's height
                const spineHeight = size.y;
                offset.y = vitalsOffset.y + (vitalsSize.y / 2) + (spineHeight / 2);

            } else if (zoneName !== 'brain') {
                // Body hitboxes move down by 40% of their final height (20% + 20%)
                offset.y -= size.y * 0.40;
            }

            const geometry = new THREE.BoxGeometry(
                size.x,
                size.y,
                size.z
            );
            
            // Debug colors for each zone
            const debugColors = {
                vitals: 0xFF0000,    // Bright red
                gut: 0x00FF00,       // Bright green  
                rear: 0x0000FF,      // Bright blue
                brain: 0xFFFF00,     // Bright yellow
                spine: 0xFF00FF,     // Magenta
                neck: 0x00FFFF,      // Cyan
                shoulderLeft: 0xFFA500,  // Orange
                shoulderRight: 0xFFA500  // Orange
            };
            
            const material = new THREE.MeshBasicMaterial({
                color: debugColors[zoneName] || 0xFFFFFF,
                wireframe: true,
                transparent: true, // Enable transparency for opacity
                opacity: 0.7 // Semi-transparent for better visibility
            });
            
            const hitbox = new THREE.Mesh(geometry, material);
            hitbox.visible = this.debugMode; // Show hitboxes when debug mode is enabled
            hitbox.name = `hitbox_${zoneName}`;
            
            // Store zone information
            hitbox.userData = {
                isHitbox: true,
                hitZone: zoneName,
                zone: zoneName,
                deer: deer
            };
            
            // Position hitbox relative to the deer model's local coordinates
            hitbox.position.set(
                offset.x,
                offset.y,
                offset.z
            );

            if (config.rotation) {
                hitbox.rotation.set(
                    config.rotation.x,
                    config.rotation.y,
                    config.rotation.z
                );
            }

            // Add to deer model so it inherits position/rotation automatically
            deer.model.add(hitbox);
            hitboxes[zoneName] = hitbox;
        });

        deer.hitboxes = hitboxes;
        deer.hitboxMeshes = Object.values(hitboxes);

        // Hitboxes are now always visible as wireframes - no separate debug system needed
        // console.log('🔴 DEBUG: Collision hitboxes created as visible wireframes for debugging');
    }

    // Perform raycast and return hit information
    raycast(from, to, deer) {
        if (!deer || !deer.hitboxMeshes || deer.hitboxMeshes.length === 0) {
            return { hit: false, hitZone: null, distance: null };
        }

        // Set up raycaster
        const direction = new THREE.Vector3().subVectors(to, from).normalize();
        const maxDistance = from.distanceTo(to);
        this.raycaster.set(from, direction);
        this.raycaster.far = maxDistance;
        
        // Force update world matrices for all hitboxes before raycasting
        deer.hitboxMeshes.forEach(hitbox => {
            hitbox.updateMatrixWorld(true);
        });
        
        const intersections = this.raycaster.intersectObjects(deer.hitboxMeshes, false);
        
        if (intersections.length > 0) {
            // Sort intersections by distance to get the closest hit
            intersections.sort((a, b) => a.distance - b.distance);
            
            // Conservative hit zone selection: trust the closest intersection unless there's a compelling reason not to
            const vitalZones = ['brain', 'vitals'];
            const bodyZones = ['gut', 'rear', 'spine'];
            
            let selectedIntersection = intersections[0]; // Default to closest
            
            const closestDistance = intersections[0].distance;
            const closestHitZone = intersections[0].object.userData.hitZone || 'unknown';
            
            // Case 1: If closest is gut, check if rear is very close behind (anatomical overlap)
            if (closestHitZone === 'gut') {
                for (const intersection of intersections) {
                    const hitZone = intersection.object.userData.hitZone || 'unknown';
                    const distanceDiff = intersection.distance - closestDistance;
                    
                    // Only prioritize rear if it's very close behind gut (≤3 units)
                    if (hitZone === 'rear' && distanceDiff <= 3) {
                        selectedIntersection = intersection;
                        break;
                    }
                }
            }
            
            const hitbox = selectedIntersection.object;
            const hitZone = hitbox.userData.hitZone || 'body';
            
            return {
                hit: true,
                hitZone: hitZone,
                point: {
                    x: selectedIntersection.point.x,
                    y: selectedIntersection.point.y,
                    z: selectedIntersection.point.z
                },
                normal: {
                    x: selectedIntersection.face.normal.x,
                    y: selectedIntersection.face.normal.y,
                    z: selectedIntersection.face.normal.z
                },
                distance: selectedIntersection.distance
            };
        }

        return { hit: false };
    }

    // Toggle hitbox visibility for debugging
    toggleHitboxes() {
        this.debugMode = !this.debugMode;
        console.log(`Hitbox debug mode: ${this.debugMode ? 'ON' : 'OFF'}`);
        this.updateHitboxVisibility();
    }
    
    // Update hitbox visibility based on current debug mode
    updateHitboxVisibility() {
        // Safety check for scene
        if (!gameContext.scene) {
            return;
        }
        
        // Update visibility for all existing hitboxes
        gameContext.scene.traverse((child) => {
            if (child.userData && child.userData.isHitbox) {
                child.visible = this.debugMode;
            }
        });
    }

    // Remove debug visualization
    removeDebugVisualization(deer) {
        if (deer.debugMeshes) {
            deer.debugMeshes.forEach(mesh => {
                deer.model.remove(mesh);
                mesh.geometry.dispose();
                mesh.material.dispose();
            });
            deer.debugMeshes = [];
        }
    }

    // Clean up collision hitboxes
    removeDeerCollisionBody(deer) {
        if (deer.hitboxes) {
            // Remove hitboxes from deer model
            Object.values(deer.hitboxes).forEach(hitbox => {
                deer.model.remove(hitbox);
                hitbox.geometry.dispose();
                hitbox.material.dispose();
            });
            deer.hitboxes = null;
            deer.hitboxMeshes = null;
        }
        this.removeDebugVisualization(deer);
    }

    /**
     * Checks for collision between a position and trees in the game world.
     * @param {THREE.Vector3} position - The position to check for collision
     * @param {number} radius - The collision radius (default: 1.0)
     * @returns {THREE.Object3D|null} - The colliding tree object or null if no collision
     */
    checkTreeCollision(position, radius = 1.0) {
        // Safety check: ensure trees exist
        if (!gameContext.trees || !gameContext.trees.children) {
            return null;
        }
        
        // Performance optimization: Use spatial partitioning to only check nearby trees
        const MAX_CHECK_DISTANCE = 50; // Only check trees within 50 units
        const MAX_TREES_TO_CHECK = 20; // Limit to checking at most 20 trees per call
        
        let treesChecked = 0;
        
        // Check collision with nearby trees only
        for (const tree of gameContext.trees.children) {
            // Quick distance check to skip far away trees
            const roughDistance = Math.abs(position.x - tree.position.x) + Math.abs(position.z - tree.position.z);
            if (roughDistance > MAX_CHECK_DISTANCE) {
                continue; // Skip trees that are definitely too far away
            }
            
            // Calculate precise 2D distance (ignore Y axis for collision)
            const distance = new THREE.Vector2(
                position.x - tree.position.x,
                position.z - tree.position.z
            ).length();
            
            // Estimate tree collision radius based on scale
            const treeRadius = (tree.scale.x || 1.0) * 1.8;
            
            // Check if collision occurs
            if (distance < treeRadius + radius) {
                return tree; // Return the colliding tree
            }
            
            // Limit the number of trees we check per call to prevent performance issues
            treesChecked++;
            if (treesChecked >= MAX_TREES_TO_CHECK) {
                break;
            }
        }
        
        return null; // No collision detected
    }

    /**
     * Checks for collision between a position and bushes in the game world.
     * @param {THREE.Vector3} position - The position to check for collision
     * @param {number} radius - The collision radius (default: 1.0)
     * @returns {THREE.Object3D|null} - The colliding bush object or null if no collision
     */
    checkBushCollision(position, radius = 1.0) {
        // Safety check: ensure bushes exist
        if (!gameContext.bushes || !gameContext.bushes.children) {
            return null;
        }
        
        // Performance optimization: Use spatial partitioning to only check nearby bushes
        const MAX_CHECK_DISTANCE = 30; // Only check bushes within 30 units
        const MAX_BUSHES_TO_CHECK = 15; // Limit to checking at most 15 bushes per call
        
        let bushesChecked = 0;
        
        // Check collision with nearby bushes only
        for (const bush of gameContext.bushes.children) {
            // Quick distance check to skip far away bushes
            const roughDistance = Math.abs(position.x - bush.position.x) + Math.abs(position.z - bush.position.z);
            if (roughDistance > MAX_CHECK_DISTANCE) {
                continue; // Skip bushes that are definitely too far away
            }
            
            bushesChecked++;
            
            // Calculate precise 2D distance (ignore Y axis for collision)
            const distance = new THREE.Vector2(
                position.x - bush.position.x,
                position.z - bush.position.z
            ).length();
            
            // Estimate bush collision radius
            const bushRadius = (bush.scale.x || 1.0) * 1.2;
            
            // Check if collision occurs
            if (distance < bushRadius + radius) {
                return bush;
            }
            
            if (bushesChecked >= MAX_BUSHES_TO_CHECK) {
                break;
            }
        }
        
        return null;
    }
}

// Export singleton instance
export const collisionSystem = new CollisionSystem();
