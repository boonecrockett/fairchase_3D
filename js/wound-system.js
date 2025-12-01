// --- WOUND BEHAVIOR SYSTEM ---
// Realistic wound behaviors based on hit location
// Affects deer movement, speed, blood trail, and survival

import * as THREE from 'three';
import { gameContext } from './context.js';

// Wound type definitions with behavior profiles
export const WOUND_TYPES = {
    HEART: {
        name: 'heart',
        displayName: 'Heart Shot',
        speedMultiplier: 1.4,        // Fastest possible burst
        maxDistance: 80,             // 60-100 yards before collapse
        minDistance: 50,
        energyDrainRate: 50,         // Very fast drain
        bleedRate: 3.0,              // Heavy blood trail
        movementPattern: 'arc',      // Wide arc movement
        seekWater: false,
        seekCover: false,
        canBed: false,
        survivalChance: 0,           // Always fatal
        wobbleAmount: 0.02,          // Slight wobble near end
        stopStartBehavior: false
    },
    DOUBLE_LUNG: {
        name: 'doubleLung',
        displayName: 'Double Lung Shot',
        speedMultiplier: 1.2,        // Fast straight run
        maxDistance: 120,            // 40-120 yards
        minDistance: 40,
        energyDrainRate: 35,         // Fast drain
        bleedRate: 2.5,              // Heavy blood (frothy)
        movementPattern: 'straight', // Straight line
        seekWater: false,
        seekCover: false,
        canBed: false,
        survivalChance: 0,
        wobbleAmount: 0.04,          // More wobble as energy drops
        stopStartBehavior: false
    },
    SINGLE_LUNG: {
        name: 'singleLung',
        displayName: 'Single Lung Shot',
        speedMultiplier: 0.6,        // Moderate speed - about 3.5 units/sec between bursts
        maxDistance: 400,            // Can go 300+ yards
        minDistance: 150,
        energyDrainRate: 5,          // Very slow drain
        bleedRate: 0.8,              // Sparse blood
        movementPattern: 'erratic',  // Stop-start behavior
        seekWater: false,
        seekCover: true,
        canBed: true,
        survivalChance: 0,           // Always fatal, just takes longer
        wobbleAmount: 0.01,
        stopStartBehavior: true      // Run, stop, hunch, run again
    },
    LIVER: {
        name: 'liver',
        displayName: 'Liver Shot',
        speedMultiplier: 0.25,       // Walks/trots slowly - about 1.4 units/sec
        maxDistance: 300,
        minDistance: 100,
        energyDrainRate: 8,          // Slow but steady
        bleedRate: 1.5,              // Medium blood
        movementPattern: 'deliberate',
        seekWater: true,             // Seeks water
        seekCover: true,             // Seeks thick cover
        canBed: true,                // Will bed within 100-300 yards
        survivalChance: 0.05,
        wobbleAmount: 0.01,
        stopStartBehavior: false,
        preferDownhill: true
    },
    GUT: {
        name: 'gut',
        displayName: 'Gut Shot',
        speedMultiplier: 0.15,       // Very slow hunched walk - about 0.86 units/sec
        maxDistance: 500,            // Can travel far if pushed
        minDistance: 80,
        energyDrainRate: 3,          // Very slow drain (12-24 hr survival)
        bleedRate: 0.5,              // Light blood, dark color
        movementPattern: 'deliberate',
        seekWater: true,             // Strong water seeking
        seekCover: true,             // Seeks isolated cover
        canBed: true,
        survivalChance: 0,           // Always fatal (just slow)
        wobbleAmount: 0,
        stopStartBehavior: false,
        preferDownhill: true,
        looksBack: true              // Stops and looks at hunter
    },
    MUSCLE: {
        name: 'muscle',
        displayName: 'Muscle Hit',
        speedMultiplier: 1.1,        // Initial adrenaline burst
        maxDistance: 400,            // Reduced - blood loss catches up
        minDistance: 150,
        energyDrainRate: 4,          // Increased - bleeding out
        bleedRate: 0.6,              // More blood than before
        movementPattern: 'straight',
        seekWater: false,
        seekCover: true,
        canBed: true,
        survivalChance: 0.3,         // Reduced - most muscle hits are fatal
        wobbleAmount: 0,
        stopStartBehavior: false,
        recovers: false              // No longer recovers - wound is serious
    },
    SHOULDER: {
        name: 'shoulder',
        displayName: 'Shoulder Shot',
        speedMultiplier: 0.35,       // Limping - about 2 units/sec, noticeably impaired
        maxDistance: 150,            // Reduced - shock and blood loss
        minDistance: 40,
        energyDrainRate: 12,         // Increased - shock is severe
        bleedRate: 0.8,              // More blood - major wound
        movementPattern: 'erratic',  // Circles, stops frequently
        seekWater: false,
        seekCover: true,
        canBed: true,                // Beds quickly from shock
        survivalChance: 0.15,        // Reduced - broken shoulder usually fatal
        wobbleAmount: 0.03,          // Limping wobble
        stopStartBehavior: true,
        isLimping: true
    }
};

// Map hitbox zones to wound types
export function getWoundTypeFromHitbox(hitZone, hitPoint, deerPosition, deerRotation) {
    switch (hitZone) {
        case 'vitals':
            // Determine heart vs lung based on hit position
            // Heart is lower and more forward in the vitals box
            if (hitPoint) {
                const localY = hitPoint.y - deerPosition.y;
                const localZ = hitPoint.z - deerPosition.z;
                
                // Heart is in lower-forward portion of vitals
                if (localY < 0.75 && localZ > 0.2) {
                    return WOUND_TYPES.HEART;
                }
                
                // Check for double vs single lung
                // Double lung requires a broadside shot through center of chest
                const distFromCenterX = Math.abs(hitPoint.x - deerPosition.x);
                
                // Check shot angle if we have player position
                let isBroadsideShot = false;
                if (gameContext.player && deerRotation !== undefined) {
                    // Calculate angle between shot direction and deer facing
                    const shotDir = new THREE.Vector3()
                        .subVectors(deerPosition, gameContext.player.position)
                        .normalize();
                    
                    // Deer's facing direction (forward is +Z in local space)
                    const deerFacing = new THREE.Vector3(0, 0, 1)
                        .applyAxisAngle(new THREE.Vector3(0, 1, 0), deerRotation);
                    
                    // Dot product: 0 = broadside, 1/-1 = front/back
                    const dotProduct = Math.abs(shotDir.dot(deerFacing));
                    
                    // Broadside shot is when dot product is close to 0 (perpendicular)
                    isBroadsideShot = dotProduct < 0.5; // Within ~60 degrees of broadside
                }
                
                // Double lung: broadside shot AND reasonably centered
                // Single lung: angled shot OR hit near edge
                if (isBroadsideShot && distFromCenterX < 0.08) {
                    return WOUND_TYPES.DOUBLE_LUNG;
                }
            }
            return WOUND_TYPES.SINGLE_LUNG;
            
        case 'gut':
            // Check if hit is in liver area (upper gut, more forward)
            if (hitPoint) {
                const localY = hitPoint.y - deerPosition.y;
                if (localY > 0.7) {
                    return WOUND_TYPES.LIVER;
                }
            }
            return WOUND_TYPES.GUT;
            
        case 'shoulderLeft':
        case 'shoulderRight':
            return WOUND_TYPES.SHOULDER;
            
        case 'rear':
            return WOUND_TYPES.MUSCLE;
            
        case 'neck':
            // Non-fatal neck hits act like muscle hits
            return WOUND_TYPES.MUSCLE;
            
        default:
            return WOUND_TYPES.MUSCLE;
    }
}

// Wound state manager for a deer
export class WoundState {
    constructor(deer) {
        this.deer = deer;
        this.reset();
    }
    
    reset() {
        this.woundType = null;
        this.energy = 100;
        this.distanceTraveled = 0;
        this.lastPosition = null;
        this.timeSinceWound = 0;
        this.isBedded = false;
        this.beddingTimer = 0;
        this.hasLookedBack = false;
        this.stopStartTimer = 0;
        this.isInStopPhase = false;
        this.stopPhaseDuration = 0;
        this.adrenalineTimer = 0;
        this.currentSpeedMultiplier = 1.0;
        this.wobbleOffset = 0;
        this.fleeDirection = null;
        this.arcAngle = 0;
        this.targetBedLocation = null;
        this.maxTravelDistance = null;
        this.beddingDistance = null;
        this.reachedTarget = false;
    }
    
    applyWound(woundType, hitPoint) {
        this.woundType = woundType;
        this.energy = 100;
        this.distanceTraveled = 0;
        this.lastPosition = this.deer.model.position.clone();
        this.timeSinceWound = 0;
        this.isBedded = false;
        this.hasLookedBack = false;
        this.adrenalineTimer = woundType.recovers ? 30 : 0; // 30 seconds of adrenaline for muscle hits
        this.currentSpeedMultiplier = woundType.speedMultiplier;
        this.maxTravelDistance = null; // Will be set on first collapse check
        this.beddingDistance = null; // Will be set on first bed check
        
        // Initialize flee direction
        this.fleeDirection = new THREE.Vector3()
            .subVectors(this.deer.model.position, gameContext.player.position)
            .normalize();
        
        // For arc movement, set initial arc angle
        if (woundType.movementPattern === 'arc') {
            this.arcAngle = (Math.random() > 0.5 ? 1 : -1) * 0.02; // Curve left or right
        }
        
        // Find target location (water, cover, or bedding spot)
        // Always search if deer seeks water or cover
        if (woundType.seekWater || woundType.seekCover || woundType.canBed) {
            this.findTargetLocation();
        }
    }
    
    /**
     * Find the best target location based on wound type preferences
     * Water-seeking deer prioritize water, cover-seeking deer prioritize thick brush
     */
    findTargetLocation() {
        const deerPos = this.deer.model.position;
        const searchRadius = 200;
        let bestTarget = null;
        let bestScore = -Infinity;
        
        // Search for water if this wound type seeks it (gut, liver)
        if (this.woundType.seekWater && gameContext.isWaterAt) {
            // Sample points in the flee direction to find water
            const waterTarget = this.findNearestWater(searchRadius);
            if (waterTarget) {
                const dist = deerPos.distanceTo(waterTarget);
                const playerDist = waterTarget.distanceTo(gameContext.player.position);
                let score = 200 - dist + playerDist * 0.3; // High priority for water
                
                if (score > bestScore) {
                    bestScore = score;
                    bestTarget = waterTarget;
                    console.log(`🦌 Wounded deer targeting water at ${dist.toFixed(0)} units`);
                }
            }
        }
        
        // Search for thick cover (bushes)
        if (this.woundType.seekCover && gameContext.bushes) {
            for (const bush of gameContext.bushes.children) {
                const dist = deerPos.distanceTo(bush.position);
                if (dist > searchRadius) continue;
                
                let score = 150 - dist; // Base score by distance
                
                // Bonus for being away from player
                const playerDist = bush.position.distanceTo(gameContext.player.position);
                score += playerDist * 0.5;
                
                // Bonus for downhill if preferred
                if (this.woundType.preferDownhill && gameContext.getHeightAt) {
                    const heightDiff = deerPos.y - gameContext.getHeightAt(bush.position.x, bush.position.z);
                    if (heightDiff > 0) score += heightDiff * 2;
                }
                
                // Bonus for dense cover (multiple bushes nearby)
                let nearbyBushes = 0;
                for (const otherBush of gameContext.bushes.children) {
                    if (bush !== otherBush && bush.position.distanceTo(otherBush.position) < 15) {
                        nearbyBushes++;
                    }
                }
                score += nearbyBushes * 10; // Prefer dense cover
                
                if (score > bestScore) {
                    bestScore = score;
                    bestTarget = bush.position.clone();
                }
            }
        }
        
        if (bestTarget) {
            this.targetBedLocation = bestTarget;
            console.log(`🦌 Wounded deer targeting location at ${deerPos.distanceTo(bestTarget).toFixed(0)} units`);
        }
    }
    
    /**
     * Find nearest water by sampling points
     */
    findNearestWater(searchRadius) {
        if (!gameContext.isWaterAt) return null;
        
        const deerPos = this.deer.model.position;
        let nearestWater = null;
        let nearestDist = Infinity;
        
        // Sample in a grid pattern, biased toward flee direction
        const sampleCount = 16;
        const angleStep = (Math.PI * 2) / sampleCount;
        
        for (let r = 20; r <= searchRadius; r += 30) {
            for (let i = 0; i < sampleCount; i++) {
                const angle = i * angleStep;
                const x = deerPos.x + Math.cos(angle) * r;
                const z = deerPos.z + Math.sin(angle) * r;
                
                if (gameContext.isWaterAt(x, z)) {
                    const dist = Math.sqrt((x - deerPos.x) ** 2 + (z - deerPos.z) ** 2);
                    
                    // Prefer water in the flee direction
                    const toWater = new THREE.Vector3(x - deerPos.x, 0, z - deerPos.z).normalize();
                    const alignment = this.fleeDirection.dot(toWater);
                    const adjustedDist = dist * (1 - alignment * 0.3); // Up to 30% closer if aligned with flee
                    
                    if (adjustedDist < nearestDist) {
                        nearestDist = adjustedDist;
                        nearestWater = new THREE.Vector3(x, deerPos.y, z);
                    }
                }
            }
        }
        
        return nearestWater;
    }
    
    update(delta) {
        if (!this.woundType) return;
        
        this.timeSinceWound += delta;
        
        // Track distance traveled
        if (this.lastPosition) {
            const moved = this.deer.model.position.distanceTo(this.lastPosition);
            this.distanceTraveled += moved;
            this.lastPosition.copy(this.deer.model.position);
            
            // Log every 50 units traveled
            if (Math.floor(this.distanceTraveled / 50) > Math.floor((this.distanceTraveled - moved) / 50)) {
                console.log(`🦌 Wounded deer traveled ${this.distanceTraveled.toFixed(0)} units, energy: ${this.energy.toFixed(0)}%`);
            }
        }
        
        // Update energy
        this.energy -= this.woundType.energyDrainRate * delta;
        this.energy = Math.max(0, this.energy);
        
        // Handle adrenaline wearing off (muscle hits)
        if (this.adrenalineTimer > 0) {
            this.adrenalineTimer -= delta;
            if (this.adrenalineTimer <= 0) {
                // Adrenaline worn off, return to normal behavior
                this.currentSpeedMultiplier = 0.4; // Slow down significantly
            }
        }
        
        // Handle stop-start behavior
        if (this.woundType.stopStartBehavior) {
            this.updateStopStartBehavior(delta);
        }
        
        // Update wobble
        if (this.woundType.wobbleAmount > 0) {
            // Wobble increases as energy decreases
            const wobbleIntensity = this.woundType.wobbleAmount * (1 + (100 - this.energy) / 50);
            this.wobbleOffset = Math.sin(this.timeSinceWound * 5) * wobbleIntensity;
        }
        
        // Check for collapse conditions
        if (this.shouldCollapse()) {
            return 'KILLED';
        }
        
        // Check for bedding conditions
        if (this.shouldBed()) {
            this.isBedded = true;
            return 'BEDDED';
        }
        
        // Check for survival (muscle hits that recover)
        if (this.woundType.survivalChance > 0 && this.adrenalineTimer <= 0 && this.woundType.recovers) {
            if (Math.random() < this.woundType.survivalChance * delta * 0.01) {
                return 'RECOVERED';
            }
        }
        
        return null;
    }
    
    updateStopStartBehavior(delta) {
        this.stopStartTimer += delta;
        
        if (this.isInStopPhase) {
            if (this.stopStartTimer > this.stopPhaseDuration) {
                this.isInStopPhase = false;
                this.stopStartTimer = 0;
            }
        } else {
            // Random chance to stop
            const stopChance = 0.1 * delta; // ~10% chance per second
            if (Math.random() < stopChance && this.distanceTraveled > 30) {
                this.isInStopPhase = true;
                this.stopStartTimer = 0;
                this.stopPhaseDuration = 2 + Math.random() * 4; // Stop for 2-6 seconds
            }
        }
    }
    
    shouldCollapse() {
        // Collapse if energy depleted
        if (this.energy <= 0) return true;
        
        // Set max distance once when wound is applied (not randomly each check)
        if (!this.maxTravelDistance) {
            this.maxTravelDistance = this.woundType.minDistance + 
                Math.random() * (this.woundType.maxDistance - this.woundType.minDistance);
        }
        
        // Collapse if traveled max distance (for fatal wounds)
        if (this.distanceTraveled >= this.maxTravelDistance && this.woundType.survivalChance < 0.5) {
            return true;
        }
        
        return false;
    }
    
    shouldBed() {
        if (!this.woundType.canBed) return false;
        if (this.isBedded) return false;
        
        // Set bedding distance once
        if (!this.beddingDistance) {
            this.beddingDistance = this.woundType.minDistance * (0.3 + Math.random() * 0.4); // 30-70% of min distance
            console.log(`🛏️ Bedding distance set: ${this.beddingDistance.toFixed(1)} units (min: ${this.woundType.minDistance})`);
        }
        
        // Force bed if traveled past max distance
        if (this.distanceTraveled >= this.woundType.maxDistance) {
            console.log(`🛏️ Force bedding - traveled ${this.distanceTraveled.toFixed(1)} >= max ${this.woundType.maxDistance}`);
            return true;
        }
        
        // Bed if traveled enough distance
        if (this.distanceTraveled >= this.beddingDistance) {
            // Higher chance to bed as distance increases - check every frame
            const distanceRatio = this.distanceTraveled / this.woundType.minDistance;
            const baseBedChance = Math.min(0.05, distanceRatio * 0.02); // Per-frame chance (at 60fps)
            
            // Near cover increases chance significantly
            if (this.isNearCover()) {
                if (Math.random() < baseBedChance * 3) {
                    console.log(`🛏️ Bedding near cover at ${this.distanceTraveled.toFixed(1)} units`);
                    return true;
                }
            }
            
            // Even without cover, will eventually bed if traveled far enough
            if (this.distanceTraveled >= this.woundType.minDistance) {
                if (Math.random() < baseBedChance) {
                    console.log(`🛏️ Bedding without cover at ${this.distanceTraveled.toFixed(1)} units`);
                    return true;
                }
            }
        }
        
        return false;
    }
    
    isNearCover() {
        if (!gameContext.bushes) return false;
        
        const deerPos = this.deer.model.position;
        for (const bush of gameContext.bushes.children) {
            const dist = deerPos.distanceTo(bush.position);
            if (dist < 10) return true;
        }
        return false;
    }
    
    // Legacy method - now uses findTargetLocation
    findBeddingLocation() {
        this.findTargetLocation();
    }
    
    getMovementDirection() {
        if (!this.woundType) return this.fleeDirection;
        
        // If seeking water/cover and have a target, move toward it
        if ((this.woundType.seekWater || this.woundType.seekCover) && this.targetBedLocation) {
            const deerPos = this.deer.model.position;
            const distToTarget = deerPos.distanceTo(this.targetBedLocation);
            
            // Check if we've reached the target (within 10 units)
            if (distToTarget < 10) {
                // At target - stay here (bed down)
                if (!this.reachedTarget) {
                    this.reachedTarget = true;
                    console.log(`🦌 Wounded deer reached ${this.woundType.seekWater ? 'water' : 'cover'} - bedding down`);
                }
                // Trigger bedding
                this.isBedded = true;
                return new THREE.Vector3(0, 0, 0); // Stop moving
            }
            
            const toTarget = new THREE.Vector3()
                .subVectors(this.targetBedLocation, deerPos)
                .normalize();
            
            // Stronger blend toward target as deer gets weaker or closer
            // Water-seeking deer are more determined (gut/liver shots are desperate for water)
            let blendFactor = this.woundType.seekWater ? 0.8 : 0.5;
            
            // Increase blend as energy drops (more desperate)
            blendFactor += (100 - this.energy) / 200; // Up to +0.5 at 0 energy
            blendFactor = Math.min(0.95, blendFactor);
            
            // Increase blend as we get closer to target
            if (distToTarget < 50) {
                blendFactor = Math.min(0.95, blendFactor + 0.2);
            }
            
            return this.fleeDirection.clone().lerp(toTarget, blendFactor).normalize();
        }
        
        // Arc movement (heart shots)
        if (this.woundType.movementPattern === 'arc') {
            // Gradually curve the flee direction
            const rotationMatrix = new THREE.Matrix4().makeRotationY(this.arcAngle);
            this.fleeDirection.applyMatrix4(rotationMatrix);
        }
        
        return this.fleeDirection;
    }
    
    getSpeedMultiplier() {
        if (!this.woundType) return 1.0;
        
        // Stop phase
        if (this.isInStopPhase) return 0;
        
        // For deliberate movement patterns (gut/liver), use low constant speed
        // These deer don't run fast - they walk/trot slowly from the start
        if (this.woundType.movementPattern === 'deliberate') {
            // Energy only affects speed slightly for these wounds
            const energyFactor = 0.8 + (this.energy / 100) * 0.2;
            return this.currentSpeedMultiplier * energyFactor;
        }
        
        // For other wounds, energy affects speed more dramatically
        // Fast wounds (heart, lung) start fast and slow as energy depletes
        const energyFactor = 0.3 + (this.energy / 100) * 0.7;
        
        return this.currentSpeedMultiplier * energyFactor;
    }
    
    getBloodDropInterval() {
        if (!this.woundType) return 1.0;
        
        // Higher bleed rate = more frequent drops
        return 1.0 / this.woundType.bleedRate;
    }
    
    getWobble() {
        return this.wobbleOffset;
    }
    
    shouldLookBack() {
        if (!this.woundType || !this.woundType.looksBack) return false;
        if (this.hasLookedBack) return false;
        
        // Look back after traveling a bit
        if (this.distanceTraveled > 20 && this.distanceTraveled < 40) {
            this.hasLookedBack = true;
            return true;
        }
        return false;
    }
}
