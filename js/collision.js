// --- COLLISION SYSTEM ---
// Three.js-based hit detection using raycasting
// Replaces manual hitbox system with robust collision detection

import { deerConfig } from './deer-config.js';
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
        const hitZones = ['vitals', 'gut', 'rear', 'brain', 'spine', 'neck'];
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
                spine: 0xFF00FF      // Magenta
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
            
            console.log(`Created collision hitbox for ${zoneName}:`, {
                size: config.size,
                offset: config.offset
            });
        });

        deer.hitboxes = hitboxes;
        deer.hitboxMeshes = Object.values(hitboxes);

        // Hitboxes are now always visible as wireframes - no separate debug system needed
        console.log('🔴 DEBUG: Collision hitboxes created as visible wireframes for debugging');
    }

    // Perform raycast and return hit information
    raycast(from, to, deer) {
        if (!deer || !deer.hitboxMeshes || deer.hitboxMeshes.length === 0) {
            console.log('🔴 DEBUG: No hitboxMeshes found for raycast');
            return { hit: false, hitZone: null, distance: null };
        }

        // Perform raycast using debug hitboxes (which ARE the collision hitboxes)
        console.log('DEBUG: Raycast called with deer:', deer);
        console.log('DEBUG: deer.hitboxMeshes exists:', !!deer.hitboxMeshes);
        console.log('DEBUG: deer.hitboxMeshes length:', deer.hitboxMeshes.length);

        // Set up raycaster
        const direction = new THREE.Vector3().subVectors(to, from).normalize();
        const maxDistance = from.distanceTo(to);
        this.raycaster.set(from, direction);
        this.raycaster.far = maxDistance;
        console.log('DEBUG: Raycaster setup - from:', from, 'direction:', direction, 'maxDistance:', maxDistance);
        console.log('DEBUG: Raycaster near/far:', this.raycaster.near, this.raycaster.far);
        console.log('DEBUG: Testing intersection with', deer.hitboxMeshes.length, 'hitbox meshes');
        
        // Debug: Calculate distances from player to each hitbox center
        console.log('DEBUG: Player to hitbox distances:');
        deer.hitboxMeshes.forEach((hitbox, index) => {
            const hitZone = hitbox.userData.hitZone || 'unknown';
            const hitboxWorldPos = new THREE.Vector3();
            hitbox.getWorldPosition(hitboxWorldPos);
            const distanceToPlayer = from.distanceTo(hitboxWorldPos);
            console.log(`  ${hitZone}: ${distanceToPlayer.toFixed(2)} units from player`);
        });
        
        // CRITICAL: Force update world matrices for all hitboxes before raycasting
        deer.hitboxMeshes.forEach(hitbox => {
            hitbox.updateMatrixWorld(true);
        });
        
        // Debug: Check if ray passes through hitbox bounds
        const firstHitbox = deer.hitboxMeshes[0];
        
        // Force update world matrix before bounds calculation
        firstHitbox.updateMatrixWorld(true);
        
        const hitboxBounds = new THREE.Box3().setFromObject(firstHitbox);
        console.log('DEBUG: First hitbox bounds:', hitboxBounds);
        console.log('DEBUG: First hitbox position:', firstHitbox.position);
        console.log('DEBUG: First hitbox world position:', firstHitbox.getWorldPosition(new THREE.Vector3()));
        console.log('DEBUG: Bounds min:', hitboxBounds.min, 'max:', hitboxBounds.max);
        console.log('DEBUG: Bounds size:', hitboxBounds.getSize(new THREE.Vector3()));
        
        // Debug: Calculate ray at various distances
        let foundIntersection = false;
        for (let t = 0; t <= Math.min(maxDistance, 200); t += 5) {
            const rayPoint = new THREE.Vector3().copy(from).add(direction.clone().multiplyScalar(t));
            if (hitboxBounds.containsPoint(rayPoint)) {
                console.log('DEBUG: Ray passes through hitbox at distance', t, 'point:', rayPoint);
                foundIntersection = true;
                break;
            }
        }
        
        if (!foundIntersection) {
            console.log('DEBUG: Ray does NOT pass through hitbox bounds');
            console.log('DEBUG: Ray start:', from);
            console.log('DEBUG: Ray direction:', direction);
            console.log('DEBUG: Max distance:', maxDistance);
            console.log('DEBUG: Sample ray points (extended):');
            for (let t = 0; t <= Math.min(maxDistance, 200); t += 25) {
                const rayPoint = new THREE.Vector3().copy(from).add(direction.clone().multiplyScalar(t));
                console.log(`  t=${t}: ${rayPoint.x.toFixed(2)}, ${rayPoint.y.toFixed(2)}, ${rayPoint.z.toFixed(2)}`);
                
                // Check if this point is close to the hitbox
                const distanceToHitbox = rayPoint.distanceTo(firstHitbox.position);
                if (distanceToHitbox < 5) {
                    console.log(`    ^ This point is close to hitbox! Distance: ${distanceToHitbox.toFixed(2)}`);
                }
            }
            
            // Calculate the exact distance where ray should intersect hitbox
            const hitboxCenter = firstHitbox.position;
            const rayToHitbox = new THREE.Vector3().subVectors(hitboxCenter, from);
            const projectionLength = rayToHitbox.dot(direction);
            const projectedPoint = new THREE.Vector3().copy(from).add(direction.clone().multiplyScalar(projectionLength));
            const distanceToProjection = projectedPoint.distanceTo(hitboxCenter);
            
            console.log('DEBUG: Ray-to-hitbox analysis:');
            console.log('  Hitbox center:', hitboxCenter);
            console.log('  Projection length:', projectionLength.toFixed(2));
            console.log('  Projected point:', projectedPoint);
            console.log('  Distance from projection to hitbox center:', distanceToProjection.toFixed(2));
            console.log('  Hitbox size:', hitboxBounds.getSize(new THREE.Vector3()));
        }
        
        // Debug: Log deer model position and world matrix
        const deerWorldPos = new THREE.Vector3();
        deer.model.getWorldPosition(deerWorldPos);
        console.log('DEBUG: Deer model world position:', deerWorldPos);
        console.log('DEBUG: Deer model local position:', deer.model.position);
        
        // Debug: Log hitbox world positions
        deer.hitboxMeshes.forEach((hitbox, index) => {
            // Force update the world matrix first
            hitbox.updateMatrixWorld(true);
            const worldPos = new THREE.Vector3();
            hitbox.getWorldPosition(worldPos);
            console.log(`DEBUG: Hitbox ${index} (${hitbox.userData.hitZone}) world position:`, worldPos);
        });

        // Test intersection with deer hitboxes
        // Debug: Check hitbox mesh properties before raycasting
        deer.hitboxMeshes.forEach((hitbox, index) => {
            console.log(`DEBUG: Hitbox ${index} - visible: ${hitbox.visible}, material.visible: ${hitbox.material.visible}, geometry vertices: ${hitbox.geometry.attributes.position.count}`);
        });
        
        const intersections = this.raycaster.intersectObjects(deer.hitboxMeshes, false);
        
        console.log('DEBUG: Intersections found:', intersections.length);
        
        // Debug: Test raycaster against a simple test object
        const testGeometry = new THREE.BoxGeometry(5, 5, 5); // Make it bigger
        const testMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
        const testMesh = new THREE.Mesh(testGeometry, testMaterial);
        testMesh.position.copy(deer.hitboxMeshes[0].position);
        
        // Also test with a much simpler raycaster setup
        const simpleRaycaster = new THREE.Raycaster();
        simpleRaycaster.set(from, direction);
        simpleRaycaster.far = 1000; // Much larger far distance
        
        const testIntersections = simpleRaycaster.intersectObject(testMesh, false);
        console.log('DEBUG: Test mesh intersections (simple raycaster):', testIntersections.length);
        
        // Test original raycaster too
        const originalTestIntersections = this.raycaster.intersectObject(testMesh, false);
        console.log('DEBUG: Test mesh intersections (original raycaster):', originalTestIntersections.length);
        
        testGeometry.dispose();
        testMaterial.dispose();
        
        if (intersections.length > 0) {
            // Sort intersections by distance to get the closest hit
            intersections.sort((a, b) => a.distance - b.distance);
            
            // Debug: Show all intersections and their hit zones
            console.log('DEBUG: All intersections:');
            intersections.forEach((intersection, index) => {
                const hitZone = intersection.object.userData.hitZone || 'unknown';
                console.log(`  ${index}: ${hitZone} at distance ${intersection.distance.toFixed(2)}`);
                
                // Debug: Show intersection point and verify it makes sense
                const intersectionPoint = intersection.point;
                const distanceFromPlayer = from.distanceTo(intersectionPoint);
                console.log(`    Intersection point:`, intersectionPoint);
                console.log(`    Direct distance from player: ${distanceFromPlayer.toFixed(2)}`);
                console.log(`    Raycaster reported distance: ${intersection.distance.toFixed(2)}`);
                
                // Verify the intersection point is along the ray direction
                const rayToIntersection = new THREE.Vector3().subVectors(intersectionPoint, from);
                const rayDirection = new THREE.Vector3().subVectors(to, from).normalize();
                const dotProduct = rayToIntersection.normalize().dot(rayDirection);
                console.log(`    Ray alignment (should be ~1.0): ${dotProduct.toFixed(3)}`);
            });
            
            // Conservative hit zone selection: trust the closest intersection unless there's a compelling reason not to
            const vitalZones = ['brain', 'vitals'];
            const bodyZones = ['gut', 'rear', 'spine'];
            
            let selectedIntersection = intersections[0]; // Default to closest
            
            const closestDistance = intersections[0].distance;
            const closestHitZone = intersections[0].object.userData.hitZone || 'unknown';
            
            console.log(`DEBUG: Closest intersection is ${closestHitZone} at distance ${closestDistance.toFixed(2)}`);
            
            // Debug: Show all hit zones and their distances for analysis
            console.log('DEBUG: All hit zones by distance:');
            intersections.forEach((intersection, index) => {
                const hitZone = intersection.object.userData.hitZone || 'unknown';
                console.log(`  ${index}: ${hitZone} at ${intersection.distance.toFixed(2)} units`);
            });
            
            // ONLY override the closest intersection in very specific cases:
            
            // Case 1: If closest is gut, check if rear is very close behind (anatomical overlap)
            if (closestHitZone === 'gut') {
                for (const intersection of intersections) {
                    const hitZone = intersection.object.userData.hitZone || 'unknown';
                    const distanceDiff = intersection.distance - closestDistance;
                    
                    // Only prioritize rear if it's very close behind gut (≤3 units)
                    if (hitZone === 'rear' && distanceDiff <= 3) {
                        selectedIntersection = intersection;
                        console.log(`DEBUG: Prioritizing rear over gut: rear at +${distanceDiff.toFixed(2)} units (anatomical overlap)`);
                        break;
                    }
                }
            }
            
            // Case 2: NEVER prioritize vitals over gut/rear - if you hit gut, it's gut!
            // The closest intersection is the most accurate for body shots
            
            // Case 3: Only prioritize vitals if the closest hit is already a vital zone
            if (vitalZones.includes(closestHitZone)) {
                console.log(`DEBUG: Closest hit is a vital zone: ${closestHitZone}`);
            }
            
            const hitbox = selectedIntersection.object;
            const hitZone = hitbox.userData.hitZone || 'body';
            
            console.log(`DEBUG: Selected hit zone: ${hitZone} (smart selection)`);
            
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


    
    // Collision hitboxes ARE the debug wireframes

    // Toggle hitbox visibility for debugging
    toggleHitboxes() {
        this.debugMode = !this.debugMode;
        console.log(`Hitbox debug mode: ${this.debugMode ? 'ON' : 'OFF'}`);
        this.updateHitboxVisibility();
    }
    
    // Update hitbox visibility based on current debug mode
    updateHitboxVisibility() {
        // Update visibility for all existing hitboxes
        this.scene.traverse((child) => {
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
}

// Export singleton instance
export const collisionSystem = new CollisionSystem();


