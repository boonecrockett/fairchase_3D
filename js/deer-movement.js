/**
 * DeerMovement - Manages movement, collision detection, and navigation for deer
 * Extracted from deer.js as part of modularization effort
 */

import * as THREE from 'three';
import { gameContext } from './context.js';
import { isOnTrail } from './trails.js';

export class DeerMovement {
    constructor(deer, config) {
        this.deer = deer;
        this.config = config;
        
        // Movement tracking properties
        this.wanderTarget = new THREE.Vector3();
        this.lastPosition = new THREE.Vector3();
        this.movementHistory = [0, 0, 0, 0, 0]; // Track last 5 movements
        this.movementHistorySize = 5;
        this.isMoving = false;
        this.movementSpeed = 0;
        this.currentSpeed = 0;
        
        // Stuck detection variables
        this.stuckDetectionInterval = 0.5; // Check every 0.5 seconds
        this.stuckDetectionTimer = 0;
        this.stuckDetectionHistory = []; // Track positions for stuck detection
        this.stuckDetectionHistorySize = 30; // Track 30 positions (0.5 seconds at 60fps)
        this.stuckDistanceThreshold = 0.5; // Consider stuck if moved less than this
        this.consecutiveStuckChecks = 0;
        this.emergencyEscapeActive = false;
        
        // Obstacle avoidance tracking
        this.lastObstacleTime = null;
        this.collisionCount = 0;
        this.lastCollisionTime = 0;
        this.forcedAvoidanceDirection = null;
        this.forcedAvoidanceTimer = 0;
        
        // Player movement detection
        this.MOVEMENT_DETECTION_THRESHOLD = 0.2; // Reduced from 0.3 to 0.2 seconds for even faster detection
        this.MOVEMENT_DISTANCE_THRESHOLD = 0.005; // Reduced from 0.01 to 0.005 for much higher sensitivity
        this.movementSampleCount = 0;
        this.REQUIRED_MOVEMENT_SAMPLES = 1; // Keep at 1 to detect even slight movement
    }

    /**
     * Generate a new random wander target within boundaries, avoiding water
     * Optionally follows trails for more natural forest behavior (30% chance)
     */
    generateNewWanderTarget() {
        const worldSize = gameContext.terrain ? gameContext.terrain.geometry.parameters.width : 1000;
        const boundary = worldSize / 2 - this.config.worldBoundaryMargin;
        
        // 30% chance to try to find a trail target for realistic forest behavior
        if (Math.random() < 0.3 && gameContext.trails && gameContext.trails.children.length > 0) {
            const trailTarget = this.findTrailTarget(boundary);
            if (trailTarget) {
                // Verify trail target is not in water
                const inWater = gameContext.isWaterAt ? gameContext.isWaterAt(trailTarget.x, trailTarget.z) : false;
                if (!inWater) {
                    this.wanderTarget.copy(trailTarget);
                    return;
                }
            }
        }
        
        // Try up to 10 times to find a valid target not in water
        for (let attempt = 0; attempt < 10; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = this.config.wanderMinRadius + Math.random() * this.config.wanderMaxRadiusAddition;
            
            let targetX = this.deer.model.position.x + Math.cos(angle) * distance;
            let targetZ = this.deer.model.position.z + Math.sin(angle) * distance;
            
            // Clamp to world boundaries
            targetX = Math.max(-boundary, Math.min(boundary, targetX));
            targetZ = Math.max(-boundary, Math.min(boundary, targetZ));
            
            // Check if target is in water
            const inWater = gameContext.isWaterAt ? gameContext.isWaterAt(targetX, targetZ) : false;
            
            if (!inWater) {
                this.wanderTarget.set(targetX, this.deer.model.position.y, targetZ);
                return;
            }
        }
        
        // Fallback: just use current position if all attempts failed
        this.wanderTarget.copy(this.deer.model.position);
    }
    
    /**
     * Find a point on a trail to use as wander target
     * @param {number} boundary - World boundary limit
     * @returns {THREE.Vector3|null} Trail point or null if none found
     */
    findTrailTarget(boundary) {
        if (!gameContext.trails || gameContext.trails.children.length === 0) {
            return null;
        }
        
        // Pick a random trail
        const trails = gameContext.trails.children;
        const randomTrail = trails[Math.floor(Math.random() * trails.length)];
        
        if (!randomTrail || !randomTrail.geometry || !randomTrail.geometry.attributes.position) {
            return null;
        }
        
        const positions = randomTrail.geometry.attributes.position;
        const vertexCount = positions.count;
        
        if (vertexCount < 4) return null;
        
        // Pick a random point along the trail
        const randomIndex = Math.floor(Math.random() * (vertexCount / 2)) * 2;
        
        const x = positions.getX(randomIndex);
        const z = positions.getZ(randomIndex);
        
        // Make sure it's within bounds and a reasonable distance away
        if (Math.abs(x) < boundary && Math.abs(z) < boundary) {
            const deerPos = this.deer.model.position;
            const distance = Math.sqrt((x - deerPos.x) ** 2 + (z - deerPos.z) ** 2);
            
            if (distance > 15 && distance < 100) {
                return new THREE.Vector3(x, 0, z);
            }
        }
        
        return null;
    }

    /**
     * Move the deer with collision detection
     * @param {number} speed - Speed to move (already multiplied by delta)
     */
    moveWithCollisionDetection(speed) {
        // Track speed for animation system (speed is already delta-adjusted)
        // Convert back to units per second for animation decisions
        this.currentSpeed = speed * 60; // Approximate: assume 60fps, convert to per-second
        this.deer.currentSpeed = this.currentSpeed;
        
        const now = performance.now() / 1000;
        
        // Decay forced avoidance timer
        if (this.forcedAvoidanceTimer > 0) {
            this.forcedAvoidanceTimer -= 1/60; // Assume ~60fps
        }
        
        // Reset collision count if no collision for 2 seconds
        if (now - this.lastCollisionTime > 2) {
            this.collisionCount = 0;
        }
        
        // If we have a forced avoidance direction, use it
        if (this.forcedAvoidanceDirection && this.forcedAvoidanceTimer > 0) {
            const targetAngle = Math.atan2(this.forcedAvoidanceDirection.x, this.forcedAvoidanceDirection.z);
            this.deer.model.rotation.y = targetAngle;
        }
        
        // Store original position before any movement
        const originalPosition = this.deer.model.position.clone();
        
        // Move deer forward in its current direction
        this.deer.model.translateZ(speed);
        
        // Get new position after movement
        const newPosition = this.deer.model.position.clone();
        
        // Check for tree collision at new position
        const treeCollision = gameContext.checkTreeCollision(newPosition, 0.7);
        
        // Check for water collision - deer should not walk into water
        // Also check if deer would be walking on terrain below water level (prevents underwater appearance)
        let inWater = gameContext.isWaterAt ? gameContext.isWaterAt(newPosition.x, newPosition.z) : false;
        
        // Additional check: prevent deer from walking on terrain that's below nearby water level
        if (!inWater && gameContext.waterBodies && gameContext.waterBodies.length > 0) {
            const terrainAtNewPos = gameContext.getHeightAt(newPosition.x, newPosition.z);
            for (const waterBody of gameContext.waterBodies) {
                const waterX = waterBody.position.x;
                const waterZ = waterBody.position.z;
                const waterY = waterBody.position.y;
                const distance = Math.sqrt(
                    (newPosition.x - waterX) * (newPosition.x - waterX) + 
                    (newPosition.z - waterZ) * (newPosition.z - waterZ)
                );
                
                let waterRadius = 10;
                if (waterBody.userData && waterBody.userData.config) {
                    waterRadius = waterBody.userData.config.size / 2;
                }
                
                // If within water radius and terrain is below water level, treat as water
                if (distance <= waterRadius && terrainAtNewPos < waterY - 0.5) {
                    inWater = true;
                    break;
                }
            }
        }
        
        // Check if position is within valid world boundaries
        // Default world size if terrain geometry isn't available yet
        let worldSize = 1000;
        
        // Safely access terrain geometry if available
        if (gameContext && gameContext.terrain && gameContext.terrain.geometry && 
            gameContext.terrain.geometry.parameters && gameContext.terrain.geometry.parameters.width) {
            worldSize = gameContext.terrain.geometry.parameters.width;
        }
        
        const boundary = worldSize / 2 - 20; // 20 units from edge
        const outOfBounds = Math.abs(newPosition.x) > boundary || Math.abs(newPosition.z) > boundary;
        
        // Simple movement validation - if any constraint is violated, revert to original position
        if (treeCollision || outOfBounds || inWater) {
            // Revert to original position
            this.deer.model.position.copy(originalPosition);
            
            // Reset speed since we didn't actually move
            this.currentSpeed = 0;
            this.deer.currentSpeed = 0;
            
            // Track collision for stuck detection
            this.collisionCount++;
            this.lastCollisionTime = now;
            
            // Smooth obstacle avoidance - find a clear direction
            if (treeCollision || inWater) {
                this.handleSmoothObstacleAvoidance(originalPosition, treeCollision, inWater);
                
                // If multiple collisions in quick succession, force a longer avoidance
                if (this.collisionCount >= 3) {
                    this.forcedAvoidanceTimer = 1.5; // Force this direction for 1.5 seconds
                    this.collisionCount = 0; // Reset after forcing
                }
            }
            
            // Update height at original position
            this.updateDeerHeight();
            return;
        }
        
        // All water collision handling and escape strategies have been removed to simplify logic
        // Update deer height after movement
        this.updateDeerHeight();
        
        // Final safety check - if somehow still in collision, force separation
        const finalPosition = this.deer.model.position.clone();
        if (gameContext.checkTreeCollision(finalPosition, 0.7)) {
            // Emergency: push deer away from nearest tree (optimized search)
            let nearestTree = null;
            let nearestDistance = Infinity;
            const MAX_SEARCH_DISTANCE = 20; // Only search within 20 units
            const MAX_TREES_TO_CHECK = 10; // Limit to checking 10 trees max
            
            if (gameContext.trees && gameContext.trees.children) {
                let treesChecked = 0;
                
                for (const tree of gameContext.trees.children) {
                    // Quick distance check to skip far away trees
                    const roughDistance = Math.abs(this.deer.model.position.x - tree.position.x) + 
                                        Math.abs(this.deer.model.position.z - tree.position.z);
                    if (roughDistance > MAX_SEARCH_DISTANCE) {
                        continue; // Skip trees that are definitely too far away
                    }
                    
                    const distance = this.deer.model.position.distanceTo(tree.position);
                    if (distance < nearestDistance) {
                        nearestDistance = distance;
                        nearestTree = tree;
                    }
                    
                    // Limit the number of trees we check to prevent performance issues
                    treesChecked++;
                    if (treesChecked >= MAX_TREES_TO_CHECK) {
                        break;
                    }
                }
            }
            
            if (nearestTree) {
                // Push deer directly away from the nearest tree
                const awayFromTree = new THREE.Vector3()
                    .subVectors(this.deer.model.position, nearestTree.position)
                    .normalize()
                    .multiplyScalar(1.5); // Push 1.5 units away
                
                this.deer.model.position.copy(nearestTree.position).add(awayFromTree);
                this.updateDeerHeight(); // Update height after position change
            }
        }
        
        // Final height update to ensure deer is always at correct height
        this.updateDeerHeight();
    }

    /**
     * Update the deer's height to match the terrain height at its current position
     * This ensures the deer is always walking on the terrain surface
     * Also ensures deer never appears below water level
     */
    updateDeerHeight() {
        if (!this.deer || !this.deer.model) return;
        
        const position = this.deer.model.position;
        const terrainHeight = gameContext.getHeightAt(position.x, position.z);
        
        // Start with terrain height plus offset
        let targetHeight = terrainHeight + this.deer.config.heightOffset;
        
        // Check if near any water body and ensure deer is above water level
        if (gameContext.waterBodies && gameContext.waterBodies.length > 0) {
            for (const waterBody of gameContext.waterBodies) {
                const waterX = waterBody.position.x;
                const waterZ = waterBody.position.z;
                const waterY = waterBody.position.y;
                const distance = Math.sqrt(
                    (position.x - waterX) * (position.x - waterX) + 
                    (position.z - waterZ) * (position.z - waterZ)
                );
                
                // Get water body radius
                let waterRadius = 10;
                if (waterBody.userData && waterBody.userData.config) {
                    waterRadius = waterBody.userData.config.size / 2;
                }
                
                // If deer is near water (within 1.5x radius), ensure it's above water level
                if (distance <= waterRadius * 1.5) {
                    const minHeight = waterY + this.deer.config.heightOffset + 0.5; // Stay 0.5 units above water
                    if (targetHeight < minHeight) {
                        targetHeight = minHeight;
                    }
                }
            }
        }
        
        position.y = targetHeight;
    }
    
    /**
     * Handle smooth obstacle avoidance when deer hits a tree or water
     * Instead of random rotation, find the best clear direction
     */
    handleSmoothObstacleAvoidance(currentPosition, hitTree, hitWater) {
        const worldSize = gameContext.terrain ? gameContext.terrain.geometry.parameters.width : 1000;
        const boundary = worldSize / 2 - this.config.worldBoundaryMargin;
        
        // Get current facing direction
        const currentDir = new THREE.Vector3(0, 0, 1);
        currentDir.applyQuaternion(this.deer.model.quaternion);
        
        // Test directions at 30-degree increments, preferring directions close to current heading
        const testAngles = [
            Math.PI / 6,   // 30° right
            -Math.PI / 6,  // 30° left
            Math.PI / 3,   // 60° right
            -Math.PI / 3,  // 60° left
            Math.PI / 2,   // 90° right
            -Math.PI / 2,  // 90° left
            2 * Math.PI / 3,  // 120° right
            -2 * Math.PI / 3, // 120° left
        ];
        
        const testDistance = 5.0; // How far ahead to check
        
        for (const angle of testAngles) {
            const testDir = currentDir.clone();
            testDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
            
            const testPos = currentPosition.clone().add(testDir.multiplyScalar(testDistance));
            
            // Check if this direction is clear
            const inBounds = Math.abs(testPos.x) < boundary && Math.abs(testPos.z) < boundary;
            const noTree = !gameContext.checkTreeCollision(testPos, 0.7);
            const noWater = !gameContext.isWaterAt || !gameContext.isWaterAt(testPos.x, testPos.z);
            
            if (inBounds && noTree && noWater) {
                // Found a clear direction - generate new target in this direction
                const newDir = currentDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
                const newTarget = currentPosition.clone().add(newDir.clone().multiplyScalar(15));
                newTarget.x = Math.max(-boundary, Math.min(boundary, newTarget.x));
                newTarget.z = Math.max(-boundary, Math.min(boundary, newTarget.z));
                this.wanderTarget.copy(newTarget);
                
                // Store forced avoidance direction
                this.forcedAvoidanceDirection = newDir.clone().normalize();
                
                // Also update wound state flee direction if deer is wounded
                if (this.deer.state === 'WOUNDED' && this.deer.woundState && this.deer.woundState.fleeDirection) {
                    this.deer.woundState.fleeDirection.copy(newDir.normalize());
                }
                
                // Immediately rotate deer toward clear direction for faster response
                const targetAngle = Math.atan2(newDir.x, newDir.z);
                this.deer.model.rotation.y = targetAngle;
                
                return;
            }
        }
        
        // No clear direction found - generate completely new random target
        this.generateNewWanderTarget();
        
        // For wounded deer, also reset flee direction toward center if stuck
        if (this.deer.state === 'WOUNDED' && this.deer.woundState && this.deer.woundState.fleeDirection) {
            const toCenter = new THREE.Vector3(0, 0, 0).sub(currentPosition).normalize();
            this.deer.woundState.fleeDirection.copy(toCenter);
            this.forcedAvoidanceDirection = toCenter.clone();
            this.forcedAvoidanceTimer = 2.0; // Force toward center for 2 seconds
        }
    }

    /**
     * Handle emergency escape when deer gets stuck
     * @param {number} escapeDistance - Distance to try to escape
     * @returns {boolean} True if escape was successful
     */
    handleEmergencyEscape(escapeDistance) {
        const originalPosition = this.deer.model.position.clone();
        let foundSafePosition = false;

        // Try multiple escape directions
        const escapeAngles = [0, Math.PI/4, -Math.PI/4, Math.PI/2, -Math.PI/2, Math.PI];
        
        for (const angle of escapeAngles) {
            const direction = new THREE.Vector3(1, 0, 0);
            direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
            
            const testPosition = originalPosition.clone().add(direction.multiplyScalar(escapeDistance));
            
            // Check if this position is within world bounds
            const worldSize = gameContext.terrain ? gameContext.terrain.geometry.parameters.width : 1000;
            const boundary = worldSize / 2 - this.config.worldBoundaryMargin;
            const withinBounds = Math.abs(testPosition.x) <= boundary && Math.abs(testPosition.z) <= boundary;
            const noTreeCollision = !gameContext.checkTreeCollision(testPosition, 0.7);
            
            if (withinBounds && noTreeCollision) {
                // This direction is clear - move there and rotate toward it
                const moveDirection = direction.clone().multiplyScalar(escapeDistance * 0.5); // Move half the distance
                this.deer.model.position.add(moveDirection);
                this.deer.model.position.y = gameContext.getHeightAt(this.deer.model.position.x, this.deer.model.position.z) + this.deer.heightOffset;
                
                // Generate a new wander target in a safe direction
                this.generateNewWanderTarget();
                
                foundSafePosition = true;
                this.emergencyEscapeActive = false;
                this.consecutiveStuckChecks = 0; // Reset stuck counter
                break;
            }
        }

        // If no safe position found, try moving toward world center
        if (!foundSafePosition) {
            const centerDirection = new THREE.Vector3(0, 0, 0).sub(this.deer.model.position).normalize();
            const centerMove = centerDirection.multiplyScalar(1.0); // Smaller movement toward center
            this.deer.model.position.add(centerMove);
            this.deer.model.position.y = gameContext.getHeightAt(this.deer.model.position.x, this.deer.model.position.z) + this.deer.heightOffset;
            
            // Generate new wander target
            this.generateNewWanderTarget();
            
            foundSafePosition = true;
            this.emergencyEscapeActive = false;
            this.consecutiveStuckChecks = 0;
        }

        return foundSafePosition;
    }

    /**
     * Update movement tracking and detection
     * @param {number} delta - Time delta
     */
    updateMovementTracking(delta) {
        // Track deer movement distance
        const distanceMoved = this.deer.model.position.distanceTo(this.lastPosition);
        const movementThreshold = 0.05;

        // For stationary states, clear movement history to ensure proper animation
        if (this.deer.state === 'IDLE' || this.deer.state === 'KILLED') {
            this.clearMovementHistory();
        } else {
            // Update movement history for moving states
            this.updateMovementHistory(distanceMoved);
        }

        // Update last position for next frame
        this.lastPosition.copy(this.deer.model.position);
    }

    /**
     * Track player movement for detection logic
     * @param {THREE.Vector3} playerPosition - Current player position
     * @param {THREE.Vector3} lastPlayerPosition - Previous player position
     */
    trackPlayerMovement(playerPosition, lastPlayerPosition) {
        const playerMovementDistance = playerPosition.distanceTo(lastPlayerPosition);
        
        if (playerMovementDistance > this.MOVEMENT_DISTANCE_THRESHOLD) {
            this.movementSampleCount++;
            
            if (!this.deer.isTrackingPlayerMovement && this.movementSampleCount >= this.REQUIRED_MOVEMENT_SAMPLES) {
                // Start tracking movement after enough consecutive movement samples
                this.deer.isTrackingPlayerMovement = true;
                this.deer.playerMovementStartTime = gameContext.clock.getElapsedTime();
            } else if (this.deer.isTrackingPlayerMovement) {
                const movementDuration = gameContext.clock.getElapsedTime() - this.deer.playerMovementStartTime;
                if (movementDuration >= this.MOVEMENT_DETECTION_THRESHOLD && !this.deer.hasDetectedMovingPlayer) {
                    this.deer.hasDetectedMovingPlayer = true;
                }
            }
        } else {
            // Player is not moving - reset movement sample count
            this.movementSampleCount = Math.max(0, this.movementSampleCount - 1);
            
            if (this.movementSampleCount === 0 && this.deer.isTrackingPlayerMovement) {
                // Player stopped moving - reset tracking
                this.deer.isTrackingPlayerMovement = false;
                this.deer.playerMovementStartTime = 0;
            }
        }
    }

    /**
     * Update movement speed tracking
     * @param {number} speed - Current movement speed
     * @param {number} delta - Time delta
     */
    updateSpeedTracking(speed, delta) {
        // Store movement speed for animation decisions
        this.movementSpeed = speed / delta; // Convert back to units per second
        this.currentSpeed = this.movementSpeed;
    }

    /**
     * Clear movement history (used for stationary states)
     */
    clearMovementHistory() {
        this.movementHistory = [0, 0, 0, 0, 0];
        this.isMoving = false;
    }

    /**
     * Update movement history with new distance moved
     * @param {number} distanceMoved - Distance moved this frame
     */
    updateMovementHistory(distanceMoved) {
        this.movementHistory.push(distanceMoved);
        if (this.movementHistory.length > this.movementHistorySize) {
            this.movementHistory.shift();
        }

        // Check if deer is moving based on movement history
        // Very low threshold - at 60fps with wandering speed 0.67, distance per frame is ~0.011
        const movementThreshold = 0.005; // Low enough to detect slow wandering
        this.isMoving = this.movementHistory.some(movement => movement > movementThreshold);
    }

    /**
     * Get current movement speed
     * @returns {number} Current movement speed
     */
    getCurrentSpeed() {
        return this.currentSpeed;
    }

    /**
     * Reset movement tracking (used during respawn)
     */
    resetMovementTracking() {
        this.isMoving = false;
        this.lastPosition.copy(this.deer.model.position);
        this.movementHistory = [0, 0, 0, 0, 0];
        this.movementSampleCount = 0;
        this.consecutiveStuckChecks = 0;
        this.emergencyEscapeActive = false;
        this.movementSpeed = 0;
        this.currentSpeed = 0;
    }

    /**
     * Smoothly rotate the deer towards a target position
     * @param {THREE.Vector3} targetPosition - The position to rotate towards
     * @param {number} delta - Time delta for smooth rotation
     */
    smoothRotateTowards(targetPosition, delta) {
        // Calculate direction from deer to target
        const direction = new THREE.Vector3()
            .subVectors(targetPosition, this.deer.model.position)
            .normalize();
        
        // Calculate target rotation angle
        const targetAngle = Math.atan2(direction.x, direction.z);
        
        // Create target quaternion
        const targetQuaternion = new THREE.Quaternion();
        targetQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetAngle);
        
        // Use faster rotation speed so deer faces target before moving far
        // Adjust based on current state - faster when wandering, slower when fleeing (more realistic)
        let rotationSpeed = 5.0; // radians per second (increased from 3.0)
        if (this.deer.state === 'FLEEING' || this.deer.state === 'WOUNDED') {
            rotationSpeed = 4.0; // Slightly slower when running - more realistic
        }
        
        const maxRotationThisFrame = rotationSpeed * delta;
        
        // Calculate how much we need to rotate
        const currentQuaternion = this.deer.model.quaternion.clone();
        const rotationNeeded = currentQuaternion.angleTo(targetQuaternion);
        
        // Limit rotation to max rotation per frame for smooth movement
        const rotationAmount = Math.min(rotationNeeded, maxRotationThisFrame);
        const t = rotationNeeded > 0 ? rotationAmount / rotationNeeded : 0;
        
        // Apply smooth rotation
        this.deer.model.quaternion.slerp(targetQuaternion, t);
    }
    
    /**
     * Get the current wander target
     * @returns {THREE.Vector3} Current wander target
     */
    getWanderTarget() {
        return this.wanderTarget;
    }
    
    /**
     * Set a specific wander target
     * @param {THREE.Vector3} target - The target position to set
     */
    setWanderTarget(target) {
        this.wanderTarget = target.clone();
    }
    
    /**
     * Check if deer is currently moving
     * @returns {boolean} True if deer is moving
     */
    getIsMoving() {
        return this.isMoving;
    }
}
