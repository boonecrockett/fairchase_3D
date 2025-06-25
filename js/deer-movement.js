/**
 * DeerMovement - Manages movement, collision detection, and navigation for deer
 * Extracted from deer.js as part of modularization effort
 */

import * as THREE from 'three';
import { gameContext } from './context.js';

export class DeerMovement {
    constructor(deer, config) {
        this.deer = deer;
        this.config = config;
        
        // Movement tracking properties
        this.isMoving = false;
        this.lastPosition = new THREE.Vector3();
        this.movementHistory = [0, 0, 0, 0, 0]; // Initialize with 5 zeros
        this.movementHistorySize = 5;
        this.movementSpeed = 0;
        this.currentSpeed = 0;
        
        // Player movement detection
        this.MOVEMENT_DETECTION_THRESHOLD = 1.0; // Reduced from 4.0 to 1.0 seconds
        this.MOVEMENT_DISTANCE_THRESHOLD = 0.05; // Reduced from 0.3 to 0.05
        this.movementSampleCount = 0;
        this.REQUIRED_MOVEMENT_SAMPLES = 2; // Reduced from 5 to 2
        
        // Stuck detection and emergency escape
        this.stuckThreshold = 0.2; // If deer hasn't moved more than 0.2 units in 1 second
        this.consecutiveStuckChecks = 0;
        this.emergencyEscapeActive = false;
        
        // Wander target
        this.wanderTarget = new THREE.Vector3();
    }

    /**
     * Generate a new random wander target within boundaries
     */
    generateNewWanderTarget() {
        const angle = Math.random() * Math.PI * 2;
        const distance = this.config.wanderMinRadius + Math.random() * this.config.wanderMaxRadiusAddition;
        
        this.wanderTarget.set(
            this.deer.model.position.x + Math.cos(angle) * distance,
            this.deer.model.position.y,
            this.deer.model.position.z + Math.sin(angle) * distance
        );
        
        // Ensure wander target stays within world boundaries
        const worldSize = gameContext.terrain ? gameContext.terrain.geometry.parameters.width : 1000;
        const boundary = worldSize / 2 - this.config.worldBoundaryMargin;
        
        this.wanderTarget.x = Math.max(-boundary, Math.min(boundary, this.wanderTarget.x));
        this.wanderTarget.z = Math.max(-boundary, Math.min(boundary, this.wanderTarget.z));
    }

    /**
     * Move with collision detection and avoidance
     * @param {number} speed - Movement speed for this frame
     */
    moveWithCollisionDetection(speed) {
        // Store original position before any movement
        const originalPosition = this.deer.model.position.clone();
        
        // First, try to move forward normally
        this.deer.model.translateZ(speed);
        
        // Check if the new position collides with any trees
        const newPosition = this.deer.model.position.clone();
        const collision = gameContext.checkTreeCollision(newPosition, 0.7);
        
        if (collision) {
            // Collision detected - immediately back up to original position
            this.deer.model.position.copy(originalPosition);
            
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
                testDirection.applyQuaternion(this.deer.model.quaternion);
                testDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), strategy.angle);
                
                const testPosition = originalPosition.clone().add(testDirection);
                
                if (!gameContext.checkTreeCollision(testPosition, 0.7)) {
                    // This direction is clear - move there and rotate toward it
                    const moveDirection = testDirection.clone().multiplyScalar(0.5); // Move half the distance
                    this.deer.model.position.add(moveDirection);
                    this.deer.model.position.y = gameContext.getHeightAt(this.deer.model.position.x, this.deer.model.position.z) + this.deer.heightOffset;
                    
                    // Generate a new wander target in a safe direction
                    this.generateNewWanderTarget();
                    
                    escaped = true;
                    break;
                }
            }
            
            // If all escape strategies failed, generate new wander target and force rotation
            if (!escaped) {
                this.generateNewWanderTarget();
                
                // Force immediate significant rotation to break free
                const randomRotation = (Math.random() - 0.5) * Math.PI; // Random rotation up to ±90°
                this.deer.model.rotateY(randomRotation);
                
                // Try to move in the new direction
                const escapeDirection = new THREE.Vector3(0, 0, speed * 0.5); // Half speed for safety
                escapeDirection.applyQuaternion(this.deer.model.quaternion);
                const escapePosition = originalPosition.clone().add(escapeDirection);
                
                if (!gameContext.checkTreeCollision(escapePosition, 0.7)) {
                    this.deer.model.position.copy(escapePosition);
                } else {
                    // Still stuck - stay at original position and keep rotating
                    this.deer.model.position.copy(originalPosition);
                }
            }
        }
        
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
                
                // Height will be automatically adjusted by Animal.update() using heightOffset
            }
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
     * Get current wander target
     * @returns {THREE.Vector3} The wander target position
     */
    getWanderTarget() {
        return this.wanderTarget;
    }

    /**
     * Check if deer is currently moving
     * @returns {boolean} True if deer is moving
     */
    getIsMoving() {
        return this.isMoving;
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
        const movementThreshold = 0.05;
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
        
        // Smoothly interpolate towards target rotation
        // Use a rotation speed that feels natural (adjust multiplier as needed)
        const rotationSpeed = 3.0; // radians per second
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
}
