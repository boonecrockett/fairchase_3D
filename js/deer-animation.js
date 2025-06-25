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
        // Use the correct movement API after refactor
        const isMoving = this.deer.movement.getIsMoving();
        const isWalking = isMoving && this.deer.currentSpeed < this.config.speeds.fleeing * 0.7;
        const isRunning = isMoving && this.deer.currentSpeed >= this.config.speeds.fleeing * 0.7;
        
        switch (this.deer.state) {
            case 'IDLE':
                return 'idle';
            case 'WANDERING':
                if (isWalking) return 'Walk';
                if (isRunning) return 'Run';
                // Only use idle behaviors when actually stopped in wandering state
                return this.getCurrentIdleBehavior();
                
            case 'THIRSTY':
                if (isWalking) return 'Walk';
                if (isRunning) return 'Run';
                // Only use idle behaviors when actually stopped in thirsty state
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
                    return 'Run';
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
