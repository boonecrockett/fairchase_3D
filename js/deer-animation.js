// --- DEER ANIMATION SYSTEM ---
// Handles animation state management, transitions, and idle behaviors
// Extracted from deer.js for better modularity

export class DeerAnimation {
    constructor(deer, config) {
        this.deer = deer;
        this.config = config;
        
        // Animation state tracking
        this.currentAnimation = null;
        this.deathAnimationStarted = false;
        this.deathAnimationStartTime = null; // Record when death animation started
        
        // Idle behavior system
        this.currentIdleBehavior = 'idle';
        this.idleBehaviorTimer = 0;
        this.idleBehaviorDuration = 3 + Math.random() * 4; // Random duration 3-7 seconds
    }

    getAnimationForState() {
        // Determine movement speed for animation selection
        // Use movement history for stable detection (avoids jitter from frame-to-frame speed changes)
        const isMoving = this.deer.movement.getIsMoving();
        
        const speed = this.deer.currentSpeed;
        const runThreshold = 1.0; // Speed threshold for running vs walking
        
        // Simplified animation selection - use isMoving flag and speed directly
        // If deer is moving (based on movement history), play walk or run based on speed
        const isWalking = isMoving && speed < runThreshold;
        const isRunning = isMoving && speed >= runThreshold;
        
        switch (this.deer.state) {
            case 'IDLE':
                return 'idle';
            case 'WANDERING':
                // Only show walking animation if actually moving with speed
                if (isWalking) return 'Walk';
                if (isRunning) return 'Run';
                // Stopped - use idle behaviors
                return this.getCurrentIdleBehavior();
                
            case 'THIRSTY':
                // Only show walking animation if actually moving with speed
                if (isWalking) return 'Walk';
                if (isRunning) return 'Run';
                // Stopped - use idle behaviors
                return this.getCurrentIdleBehavior();
                
            case 'GRAZING':
                return 'Eat'; // Use the actual "Eat" animation from the model
                
            case 'DRINKING':
                return 'idle'; // Use idle for drinking (no specific drinking animation)
                
            case 'ALERT':
                return 'idle'; // Use idle for alert state
                
            case 'FLEEING':
                return 'Run';
                
            case 'WOUNDED':
                if (this.deer.stateTimer < 0.5) {
                    // Initial wounded reaction - use Attack animation as impact reaction
                    return 'Attack';
                } else {
                    // Use Walk for most wounded deer, Run only for very fast wounds
                    // Run animation only looks good at 70%+ speed (heart shot burst)
                    // Heart: 8.05, Double Lung: 6.9, others are slower
                    const speed = this.deer.currentSpeed || 0;
                    if (speed < 7.0) {
                        return 'Walk'; // Most wounded movement - fast walk/trot
                    } else {
                        return 'Run'; // Only heart shot uses Run
                    }
                }
                
            case 'KILLED':
                // Play death animation once, then pause it at the end to keep deer fallen
                if (!this.deathAnimationStarted) {
                    this.deathAnimationStarted = true;
                    this.deathAnimationStartTime = this.deer.stateTimer; // Record when death animation started
                    return 'Die';
                } else {
                    // Allow death animation to play for at least 0.5 seconds
                    const deathAnimationDuration = this.deer.stateTimer - this.deathAnimationStartTime;
                    if (deathAnimationDuration < 0.5) {
                        return 'Die'; // Continue playing death animation
                    } else {
                        // After death animation has played, pause it at the end instead of stopping
                        // This keeps the deer in the fallen position from the Die animation
                        if (this.deer.mixer && this.deer.activeAction && this.deer.activeAction.isRunning()) {
                            this.deer.activeAction.paused = true; // Pause instead of stop
                        }
                        return 'Die'; // Keep Die animation active but paused
                    }
                }
                
            default:
                return 'idle';
        }
    }

    getCurrentIdleBehavior() {
        // Return animation based on current idle behavior
        // Only use special idle behaviors when deer is actually stationary in WANDERING/THIRSTY states
        switch (this.currentIdleBehavior) {
            case 'grazing':
                return 'Eat'; // Use the actual "Eat" animation
            case 'alert':
                return 'idle'; // Use idle for alert behavior
            case 'pawing':
                return 'idle'; // Use idle for pawing (no specific pawing animation)
            case 'idle':
            default:
                return 'idle';
        }
    }

    changeAnimationIfNecessary() {
        const desiredAnimation = this.getAnimationForState();
        
        // Special handling for KILLED state
        if (this.deer.state === 'KILLED') {
            // Check if the desired animation exists for the current death phase
            let hasDesiredAnimation = false;
            
            // Check if animations exist and if the desired animation is available
            if (this.deer.animations && desiredAnimation) {
                // Check the animations object directly instead of mixer._actions
                hasDesiredAnimation = this.deer.animations.hasOwnProperty(desiredAnimation);
            }
            
            if (hasDesiredAnimation && desiredAnimation && desiredAnimation !== this.currentAnimation) {
                this.deer.playAnimation(desiredAnimation);
                this.currentAnimation = desiredAnimation;
            } else if (!hasDesiredAnimation && desiredAnimation && desiredAnimation !== this.currentAnimation) {
                // Animation doesn't exist, log once and set fallback
                if (desiredAnimation === 'Die') {
                    // Use idle as fallback for missing Die animation (lowercase)
                    if (this.deer.animations && this.deer.animations.hasOwnProperty('idle')) {
                        this.deer.playAnimation('idle');
                        this.currentAnimation = 'idle';
                    } else {
                        // Stop all animations if even idle doesn't exist
                        this.deer.mixer.stopAllAction();
                        this.currentAnimation = null;
                    }
                } else {
                    // Stop all animations if animation doesn't exist
                    this.deer.mixer.stopAllAction();
                    this.currentAnimation = null;
                }
            }
            return;
        }
        
        // Normal animation handling for other states
        if (desiredAnimation && desiredAnimation !== this.currentAnimation) {
            this.deer.playAnimation(desiredAnimation);
            this.currentAnimation = desiredAnimation;
        }
    }

    updateIdleBehavior(delta) {
        // Only update idle behavior when deer is actually stationary
        if (!this.deer.movement.getIsMoving() && (this.deer.state === 'WANDERING' || this.deer.state === 'THIRSTY')) {
            this.idleBehaviorTimer += delta;
            if (this.idleBehaviorTimer > this.idleBehaviorDuration) {
                this.idleBehaviorTimer = 0;
                this.idleBehaviorDuration = 3 + Math.random() * 4; // Random duration 3-7 seconds
                
                // Weighted random selection of idle behaviors
                const rand = Math.random();
                if (rand < 0.6) {
                    this.currentIdleBehavior = 'grazing'; // 60% chance
                } else if (rand < 0.8) {
                    this.currentIdleBehavior = 'alert'; // 20% chance
                } else if (rand < 0.9) {
                    this.currentIdleBehavior = 'idle'; // 10% chance
                } else {
                    this.currentIdleBehavior = 'pawing'; // 10% chance
                }
            }
        } else {
            // Reset idle behavior when moving or in other states
            this.currentIdleBehavior = 'idle';
            this.idleBehaviorTimer = 0;
        }
    }

    // Get leg animation speed based on current state
    getLegAnimationSpeed() {
        switch (this.deer.state) {
            case 'IDLE':
            case 'GRAZING':
            case 'DRINKING':
            case 'ALERT':
            case 'KILLED':
                return 0;
            case 'WANDERING':
                return this.config.legAnimationSpeeds.wandering;
            case 'THIRSTY':
                return this.config.legAnimationSpeeds.thirsty;
            case 'FLEEING':
                return this.config.legAnimationSpeeds.fleeing;
            case 'WOUNDED':
                return this.config.legAnimationSpeeds.wounded;
            default:
                return 0;
        }
    }

    // Update animation system
    update(delta) {
        this.updateIdleBehavior(delta);
        this.changeAnimationIfNecessary();
        this.updateAnimationSpeed();
    }
    
    /**
     * Scale animation playback speed based on actual movement speed
     * This prevents the "moonwalk" effect where legs move faster than the deer travels
     * Uses smoothing to prevent jittery animation speed changes
     */
    updateAnimationSpeed() {
        if (!this.deer.activeAction) return;
        
        const currentAnim = this.currentAnimation;
        const speed = this.deer.currentSpeed;
        let targetTimeScale = 1.0;
        
        if (currentAnim === 'Walk') {
            // Walk animation should match wandering speed (~0.85 units/s)
            // For wounded deer, allow faster walk animation (up to 2.5x for trotting effect)
            const baseWalkSpeed = this.config.speeds.wandering;
            const maxWalkScale = this.deer.state === 'WOUNDED' ? 2.5 : 1.2;
            targetTimeScale = Math.max(0.3, Math.min(maxWalkScale, speed / baseWalkSpeed));
        } else if (currentAnim === 'Run') {
            // Run animation should scale based on actual speed
            const baseRunSpeed = this.config.speeds.fleeing; // 11.5
            
            // For wounded deer, scale animation to match actual movement speed
            // Very slow wounded deer (gut/liver) should have very slow animation
            if (this.deer.state === 'WOUNDED') {
                // Scale directly based on speed ratio to base run speed
                // At speed 1.0, animation should be ~0.1 of full speed
                // At speed 8.0 (heart shot), animation should be ~0.7 of full speed
                targetTimeScale = Math.max(0.15, Math.min(1.0, speed / baseRunSpeed));
            } else {
                // Normal fleeing - scale from 0.4 to 1.0
                const minRunSpeed = this.config.speeds.thirsty;
                const speedRatio = (speed - minRunSpeed) / (baseRunSpeed - minRunSpeed);
                targetTimeScale = 0.4 + Math.max(0, Math.min(1, speedRatio)) * 0.6;
            }
        }
        
        // Smoothly interpolate timeScale to prevent jitter (lerp factor 0.1)
        const currentTimeScale = this.deer.activeAction.timeScale;
        const smoothedTimeScale = currentTimeScale + (targetTimeScale - currentTimeScale) * 0.1;
        this.deer.activeAction.timeScale = smoothedTimeScale;
    }

    // Reset animation state (useful for respawning)
    reset() {
        this.currentAnimation = null;
        this.deathAnimationStarted = false;
        this.deathAnimationStartTime = null;
        this.currentIdleBehavior = 'idle';
        this.idleBehaviorTimer = 0;
        this.idleBehaviorDuration = 3 + Math.random() * 4;
        
        // Stop all animations if mixer exists
        if (this.deer.mixer) {
            this.deer.mixer.stopAllAction();
        }
    }

    // Mark death animation as started (called from external death sequence)
    startDeathAnimation() {
        this.deathAnimationStarted = true;
    }

    // Check if deer is in a moving animation
    isInMovingAnimation() {
        const currentAnimation = this.getAnimationForState();
        return currentAnimation === 'Walk' || currentAnimation === 'Run';
    }
}
