// --- COLLISION SYSTEM ---
// Three.js-based hit detection using raycasting
// Replaces manual hitbox system with robust collision detection

import { deerConfig } from './deer-config.js';
import { gameContext } from './context.js';
import * as THREE from 'three';

// Reusable vector for raycast direction; raycast is a hot path (per shot,
// sometimes multiple per frame in hunt simulator), so we avoid allocating
// a new Vector3 each call.
const _rayDirection = new THREE.Vector3();

// Studio offsets stay deer-local. Sizes below are gameplay floors from the
// pre-studio hunt (deer scale 4.4, vitals ~0.20 local). Studio authored
// anatomical slivers (lung x=0.04) that do not catch a chest shot.
const GAMEPLAY_SIZE_FLOOR = {
    vitals: { x: 0.20, y: 0.20, z: 0.28 },
    leftLung: { x: 0.20, y: 0.20, z: 0.28 },
    heart: { x: 0.14, y: 0.12, z: 0.14 },
    gut: { x: 0.24, y: 0.18, z: 0.24 },
    liver: { x: 0.14, y: 0.14, z: 0.14 },
    neck: { x: 0.10, y: 0.16, z: 0.22 },
    throat: { x: 0.10, y: 0.20, z: 0.12 },
    spine: { x: 0.08, y: 0.08, z: 0.50 },
    rear: { x: 0.22, y: 0.20, z: 0.20 },
    shoulderLeft: { x: 0.12, y: 0.28, z: 0.16 },
    shoulderRight: { x: 0.12, y: 0.28, z: 0.16 },
    brain: { x: 0.12, y: 0.12, z: 0.12 },
    semiVitalBack: { x: 0.14, y: 0.12, z: 0.36 },
    semiVitalGut: { x: 0.16, y: 0.14, z: 0.40 },
};

function gameplaySize(zoneName, studioSize) {
    const floor = GAMEPLAY_SIZE_FLOOR[zoneName];
    if (!floor) return { ...studioSize };
    return {
        x: Math.max(studioSize.x, floor.x),
        y: Math.max(studioSize.y, floor.y),
        z: Math.max(studioSize.z, floor.z),
    };
}

class CollisionSystem {
    constructor() {
        this.raycaster = null;
        this.debugMode = false; // Disable debug visualization
        this.init();
    }

    init() {
        // Create Three.js raycaster for hit detection
        this.raycaster = new THREE.Raycaster();
        
    }

    // Create debug hitboxes that ARE the actual collision hitboxes
    createDebugHitboxes(deer) {
        if (!deer.model) {
            console.warn('Cannot create collision body: deer model not loaded');
            return null;
        }

        // Create hitbox meshes for each hit zone using current config
        const hitZones = ['vitals', 'gut', 'rear', 'brain', 'spine', 'neck', 'shoulderLeft', 'shoulderRight', 'heart', 'semiVitalBack', 'liver', 'semiVitalGut', 'throat', 'leftLung'];
        const hitboxes = {};
        
        hitZones.forEach(zoneName => {
            const config = deerConfig[zoneName];
            if (!config) return;

            // Studio offset/rotation stay deer-local. Size uses a gameplay
            // floor so a chest shot can still hit the lung boxes.
            const size = gameplaySize(zoneName, config.size);
            const offset = { ...config.offset };

            const geometry = new THREE.BoxGeometry(
                size.x,
                size.y,
                size.z
            );
            
            // Use debug color from config
            const debugColor = config.debugColor || 0xFFFFFF;
            
            const material = new THREE.MeshBasicMaterial({
                color: debugColor,
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

            // Studio coords are deer-local. Parent to the deer so they
            // inherit its transform the way the old hunt did.
            deer.model.add(hitbox);
            hitboxes[zoneName] = hitbox;
        });

        deer.hitboxes = hitboxes;
        deer.hitboxMeshes = Object.values(hitboxes);
        this.updateHitboxVisibility();
    }

    // Perform raycast and return hit information
    raycast(from, to, deer) {
        if (!deer) {
            return { hit: false, hitZone: null, distance: null };
        }

        this.raycaster.layers.enableAll();
        _rayDirection.subVectors(to, from).normalize();
        const maxDistance = from.distanceTo(to);
        this.raycaster.set(from, _rayDirection);
        this.raycaster.near = 0;
        this.raycaster.far = maxDistance;

        const hitboxMeshes = deer.hitboxMeshes;
        if (hitboxMeshes && hitboxMeshes.length > 0) {
            hitboxMeshes.forEach(hitbox => {
                hitbox.updateMatrixWorld(true);
            });

            const intersections = this.raycaster.intersectObjects(hitboxMeshes, false);

            if (intersections.length > 0) {
                intersections.sort((a, b) => a.distance - b.distance);

                let selectedIntersection = intersections[0];
                const closestDistance = intersections[0].distance;
                const closestHitZone = intersections[0].object.userData.hitZone || 'unknown';

                if (closestHitZone === 'gut') {
                    for (const intersection of intersections) {
                        const hitZone = intersection.object.userData.hitZone || 'unknown';
                        const distanceDiff = intersection.distance - closestDistance;
                        if (hitZone === 'rear' && distanceDiff <= 3) {
                            selectedIntersection = intersection;
                            break;
                        }
                    }
                }

                // A frontal/quartering ray often clips neck before the chest.
                // If a lung or heart is on that same ray, that is the shot.
                const chestZones = ['vitals', 'leftLung', 'heart', 'liver'];
                if (closestHitZone === 'neck' || closestHitZone === 'throat') {
                    const chest = intersections.find((item) => (
                        chestZones.includes(item.object.userData.hitZone)
                        && item.distance - closestDistance <= 1.2
                    ));
                    if (chest) selectedIntersection = chest;
                }

                return this._hitFromIntersection(selectedIntersection, intersections);
            }
        }

        // Named boxes missed, but the posed mesh was hit. Count as body/muscle
        // so a shot on the hide is not a miss.
        if (deer.model) {
            deer.model.updateMatrixWorld(true);
            const meshHits = this.raycaster.intersectObject(deer.model, true);
            const visual = meshHits.find((item) => item.object.isMesh && !item.object.userData.isHitbox);
            if (visual) {
                return this._hitFromIntersection(visual, []);
            }
        }

        return { hit: false };
    }

    _hitFromIntersection(selectedIntersection, hits) {
        const hitbox = selectedIntersection.object;
        let hitZone = hitbox.userData.hitZone || 'body';

        const hitZones = hits.map(i => i.object.userData.hitZone);
        const hasRightLung = hitZones.includes('vitals');
        const hasLeftLung = hitZones.includes('leftLung');
        const isDoubleLung = hasRightLung && hasLeftLung;

        if (isDoubleLung) {
            hitZone = 'doubleLung';
        }

        const faceNormal = selectedIntersection.face?.normal;
        return {
            hit: true,
            hitZone: hitZone,
            point: {
                x: selectedIntersection.point.x,
                y: selectedIntersection.point.y,
                z: selectedIntersection.point.z
            },
            normal: {
                x: faceNormal?.x || 0,
                y: faceNormal?.y || 1,
                z: faceNormal?.z || 0
            },
            distance: selectedIntersection.distance,
            isDoubleLung: isDoubleLung
        };
    }

    // Toggle hitbox visibility for debugging
    toggleHitboxes() {
        this.debugMode = !this.debugMode;
        console.log(`Hitbox debug mode: ${this.debugMode ? 'ON' : 'OFF'}`);
        this.updateHitboxVisibility();
    }
    
    updateHitboxVisibility() {
        const meshes = gameContext.deer?.hitboxMeshes;
        if (meshes && meshes.length > 0) {
            for (let i = 0; i < meshes.length; i++) {
                meshes[i].visible = this.debugMode;
            }
            return;
        }

        if (!gameContext.scene) return;
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
                hitbox.removeFromParent();
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
        const MAX_CHECK_DISTANCE = 20;

        // Prefer spatial hash when instanced vegetation is active
        const hash = gameContext.treeHash;
        if (hash && hash.entries.length > 0) {
            const candidates = hash.query(position.x, position.z, MAX_CHECK_DISTANCE);
            for (let i = 0; i < candidates.length; i++) {
                const entry = candidates[i];
                const dx = position.x - entry.x;
                const dz = position.z - entry.z;
                if (Math.abs(dx) + Math.abs(dz) > MAX_CHECK_DISTANCE) continue;
                const distance = Math.sqrt(dx * dx + dz * dz);
                const treeRadius = entry.radius || ((entry.scale || 1.0) * 1.8);
                if (distance < treeRadius + radius) {
                    return entry.object || entry;
                }
            }
            return null;
        }

        if (!gameContext.trees || !gameContext.trees.children) {
            return null;
        }

        for (const tree of gameContext.trees.children) {
            const dx = position.x - tree.position.x;
            const dz = position.z - tree.position.z;
            if (Math.abs(dx) + Math.abs(dz) > MAX_CHECK_DISTANCE) {
                continue;
            }

            const distance = Math.sqrt(dx * dx + dz * dz);
            const treeRadius = tree.userData?.collisionRadius || ((tree.scale.x || 1.0) * 1.8);

            if (distance < treeRadius + radius) {
                return tree;
            }
        }

        return null;
    }

    /**
     * Checks for collision between a position and bushes in the game world.
     * @param {THREE.Vector3} position - The position to check for collision
     * @param {number} radius - The collision radius (default: 1.0)
     * @returns {THREE.Object3D|null} - The colliding bush object or null if no collision
     */
    checkBushCollision(position, radius = 1.0) {
        const MAX_CHECK_DISTANCE = 30;
        const MAX_BUSHES_TO_CHECK = 15;

        const hash = gameContext.bushHash;
        if (hash && hash.entries.length > 0) {
            const candidates = hash.query(position.x, position.z, MAX_CHECK_DISTANCE);
            let bushesChecked = 0;
            for (let i = 0; i < candidates.length; i++) {
                const entry = candidates[i];
                const roughDistance = Math.abs(position.x - entry.x) + Math.abs(position.z - entry.z);
                if (roughDistance > MAX_CHECK_DISTANCE) continue;
                bushesChecked++;
                const bdx = position.x - entry.x;
                const bdz = position.z - entry.z;
                const distance = Math.sqrt(bdx * bdx + bdz * bdz);
                const bushRadius = entry.radius || ((entry.scale || 1.0) * 1.5);
                if (distance < bushRadius + radius) {
                    return entry.object || entry;
                }
                if (bushesChecked >= MAX_BUSHES_TO_CHECK) break;
            }
            return null;
        }

        if (!gameContext.bushes || !gameContext.bushes.children) {
            return null;
        }

        let bushesChecked = 0;

        for (const bush of gameContext.bushes.children) {
            const roughDistance = Math.abs(position.x - bush.position.x) + Math.abs(position.z - bush.position.z);
            if (roughDistance > MAX_CHECK_DISTANCE) {
                continue;
            }

            bushesChecked++;

            const bdx = position.x - bush.position.x;
            const bdz = position.z - bush.position.z;
            const distance = Math.sqrt(bdx * bdx + bdz * bdz);

            const bushRadius = bush.userData?.collisionRadius || ((bush.scale.x || 1.0) * 1.5);

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
