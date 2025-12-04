import * as THREE from 'three';
import { gameContext } from './context.js';
import { updateDeerAudio, triggerDeerBlowSound, triggerDeerSpawnBlowSound } from './spatial-audio.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { deerConfig } from './deer-config.js';
import { DeerEffects } from './deer-effects.js';
import { DeerAnimation } from './deer-animation.js';
import { DeerHitbox } from './deer-hitbox.js';
import { DeerMovement } from './deer-movement.js';
import { DeerAI } from './deer-ai.js';
import { Animal } from './animal.js';
import { applySpookingPenalty, awardScoutingBonus } from './hunting-mechanics.js';
import { getPlayerNoise } from './player.js';
import { WoundState, getWoundTypeFromHitbox } from './wound-system.js';
import { DEBUG_MODE } from './constants.js';

// Debug detection modal tracking
let lastDetectionModalTime = 0;
const DETECTION_MODAL_COOLDOWN = 5000; // 5 seconds between modals

/**
 * Shows a debug modal explaining how the deer detected the hunter
 */
function showDetectionDebugModal(detectionType, details) {
    if (!DEBUG_MODE) return;
    
    const now = Date.now();
    if (now - lastDetectionModalTime < DETECTION_MODAL_COOLDOWN) return;
    lastDetectionModalTime = now;
    
    // Create or get the debug modal
    let modal = document.getElementById('detection-debug-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'detection-debug-modal';
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(42, 43, 47, 0.95);
            border: 2px solid #ba5216;
            border-radius: 8px;
            padding: 20px 30px;
            z-index: 10000;
            color: #beb5a3;
            font-family: 'Inter', sans-serif;
            max-width: 400px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        `;
        document.body.appendChild(modal);
    }
    
    const icon = detectionType === 'visual' ? '👁️' : detectionType === 'sound' ? '👂' : '⚠️';
    const title = detectionType === 'visual' ? 'Visual Detection!' : 
                  detectionType === 'sound' ? 'Sound Detection!' : 'Deer Alert!';
    
    modal.innerHTML = `
        <div style="font-size: 32px; margin-bottom: 10px;">${icon}</div>
        <div style="font-size: 18px; font-weight: 600; color: #ba5216; margin-bottom: 15px;">${title}</div>
        <div style="font-size: 14px; line-height: 1.6;">${details}</div>
        <div style="margin-top: 15px; font-size: 11px; color: #6b675f;">(Debug Mode - Auto-closes in 3s)</div>
    `;
    
    modal.style.display = 'block';
    
    // Auto-close after 3 seconds
    setTimeout(() => {
        if (modal) modal.style.display = 'none';
    }, 3000);
}

export class Deer extends Animal {
    constructor() {
        super(deerConfig);
        this.model.name = 'deer';
        gameContext.deer = this;

        this.timeSinceLastDrink = 0;
        this.idleBehaviorTimer = 0;
        this.idleBehaviorDuration = 3 + Math.random() * 4;
        this.currentIdleBehavior = 'idle';
        this.idleLookTimer = 0; // Timer for head scanning while idle
        this.lastStuckCheckTime = 0;
        this.stuckCheckInterval = 1.0;
        this.emergencyEscapeActive = false;
        this.consecutiveStuckChecks = 0;
        this.requiredStuckChecks = 3;

        this.previousState = 'IDLE';
        this.alertTurnDirection = false;
        this.alertStartTime = 0;
        this.hasAlertedPlayer = false;
        this.alertMovementDelay = 2.5;

        // Initialize speed tracking for animation system
        this.currentSpeed = 0;
        this.movementSpeed = 0;
        
        this.effects = new DeerEffects(this, this.config);
        this.animation = new DeerAnimation(this, this.config);
        this.hitbox = new DeerHitbox(this, this.config);
        this.movement = new DeerMovement(this, this.config);
        this.ai = new DeerAI(this, this.config);
        
        this.movement.generateNewWanderTarget();

        this.fallen = false;
        this.woundCount = 0;
        this.accumulatedSeverity = 0;
        this.tagged = false;
        this.setState('IDLE');
        
        // Check debug setting for no-flee mode
        this.fleeingEnabled = gameContext.deerBehaviorMode !== 'no-flee';
        this.isLookingAtHunter = false;
        this.headTargetRotation = 0;
        this.headCurrentRotation = 0;
        this.headTurnSpeed = 3.0;

        this.lastPlayerPosition = new THREE.Vector3();
        this.playerMovementStartTime = 0;
        this.isTrackingPlayerMovement = false;
        this.hasDetectedMovingPlayer = false;
        this.MOVEMENT_DETECTION_THRESHOLD = 1.0;
        this.MOVEMENT_DISTANCE_THRESHOLD = 0.05;
        this.movementSampleCount = 0;
        this.REQUIRED_MOVEMENT_SAMPLES = 2;

        this.wasActuallyHit = false;

        this.stuckDetectionHistory = [];
        this.stuckDetectionMaxHistory = 60;
        this.stuckThreshold = 0.2;
        
        this.cachedVisibility = undefined;
        this.lastVisibilityCheck = undefined;
        this.lastPlayerPositionForVisibility = undefined;
        
        this.woundedFleeDirection = null;
        this.lastWoundedDirectionUpdate = null;
        
        // Wound behavior system
        this.woundState = new WoundState(this);
    }

    // Apply wound with specific type based on hitbox
    applyWound(hitZone, hitPoint) {
        if (this.state === 'KILLED') return false;
        
        const deerPos = this.model.position;
        const deerRotation = this.model.rotation.y;
        const woundType = getWoundTypeFromHitbox(hitZone, hitPoint, deerPos, deerRotation);
        
        this.woundCount++;
        
        // Track wound severity for accumulation
        // Severity: heart/spine/brain=instant, double lung=5, single lung=3, liver/gut=2, shoulder=2, muscle=1
        if (!this.accumulatedSeverity) this.accumulatedSeverity = 0;
        const severityMap = {
            'Heart Shot': 10,
            'Double Lung Shot': 5,
            'Single Lung Shot': 3,
            'Liver Shot': 2,
            'Gut Shot': 2,
            'Shoulder Shot': 2,
            'Muscle Hit': 1
        };
        const severity = severityMap[woundType.displayName] || 1;
        this.accumulatedSeverity += severity;
        
        this.woundState.applyWound(woundType, hitPoint);
        this.effects.createBloodDrop();
        
        console.log(`🩸 Wound applied: ${woundType.displayName} (wound #${this.woundCount}, severity: ${severity}, total: ${this.accumulatedSeverity})`);
        
        // Check for death from accumulated wounds
        // Severity 5+ is fatal (e.g., 2 gut shots, 1 lung + 1 muscle, 5 muscle shots)
        if (this.accumulatedSeverity >= 5) {
            // Fatal accumulation - deer will collapse quickly
            this.woundState.energy = Math.min(this.woundState.energy, 20);
            this.woundState.maxTravelDistance = 40; // Collapse within ~45 yards
            console.log(`🩸 Fatal wound accumulation (${this.accumulatedSeverity}) - deer will collapse soon`);
        } else if (this.accumulatedSeverity >= 3) {
            // Serious accumulation - deer weakened significantly
            this.woundState.energy = Math.min(this.woundState.energy, 50);
            this.woundState.maxTravelDistance = Math.min(this.woundState.maxTravelDistance || 999, 100);
            console.log(`🩸 Serious wound accumulation (${this.accumulatedSeverity}) - deer weakened`);
        }
        
        // 3+ wounds OR severity 6+ is immediate death
        if (this.woundCount >= 3 || this.accumulatedSeverity >= 6) {
            this.setState('KILLED');
            return { killed: true, woundType };
        }
        
        this.setState('WOUNDED');
        return { killed: false, woundType };
    }

    wound() {
        if (this.state === 'KILLED') return false;

        this.woundCount++;
        this.effects.createBloodDrop();

        if (this.woundCount >= 3) {
            this.setState('KILLED');
            return true;
        }

        this.setState('WOUNDED');
        return false;
    }

    setState(newState) {
        const oldState = this.state;
        const validStates = ['IDLE', 'WANDERING', 'THIRSTY', 'GRAZING', 'DRINKING', 'ALERT', 'FLEEING', 'WOUNDED', 'KILLED'];
        if (!validStates.includes(newState)) return;
        
        if (this.stateLockedToKilled && newState !== 'KILLED') return;
        if (this.state === 'KILLED' && newState !== 'KILLED' && this.stateLockedToKilled === true) return;
        
        if (newState === 'KILLED') {
            this.stateLockedToKilled = true;
            this.deathSequenceStarted = true;
        }
        
        super.setState(newState);
        gameContext.deerState = newState;
        
        if (newState === 'ALERT' && oldState !== 'ALERT') {
            this.alertStartTime = gameContext.clock.getElapsedTime();
            if (!this.hasAlertedPlayer) {
                triggerDeerBlowSound(this);
                this.hasAlertedPlayer = true;
            }
        }
        
        if (newState === 'FLEEING' && oldState !== 'FLEEING') {
            if (!this.hasAlertedPlayer) {
                triggerDeerBlowSound(this);
                this.hasAlertedPlayer = true;
            }
        }
        
        if (oldState === 'ALERT' && newState !== 'ALERT') {
            this.alertTurnDirection = false;
        }
        
        // Reset idle look timer when entering IDLE state
        if (newState === 'IDLE') {
            this.idleLookTimer = 0;
        }
        
        // Generate new wander target when transitioning to WANDERING
        if (newState === 'WANDERING' && oldState !== 'WANDERING') {
            this.movement.generateNewWanderTarget();
        }
        
        if (newState === 'FLEEING' || newState === 'WANDERING' || newState === 'GRAZING') {
            this.hasAlertedPlayer = false;
        }
        
        if (newState === 'KILLED') {
            this.startDeathSequence();
        }
        
        if (newState !== 'WOUNDED' && newState !== 'KILLED') {
            this.wasActuallyHit = false;
        }
        
        if (oldState === 'ALERT' && newState !== 'ALERT') {
            this.alertTurnDirection = false;
            this.hasAlertedPlayer = false;
        }
    }

    startDeathSequence() {
        this.deathSequenceInProgress = true;
        this.fallen = true;
        
        if (this.animation) {
            this.animation.startDeathAnimation();
        }
        
        if (this.animations && this.animations['Die']) {
            this.playAnimation('Die');
        }
    }

    respawn() {
        this.fallen = false;
        this.tagged = false;
        this.stateLockedToKilled = false;
        this.deathSequenceStarted = false;
        this.deathSequenceInProgress = false;
        this.wasActuallyHit = false;
        this.woundCount = 0;
        this.accumulatedSeverity = 0;
        this.idleLookTimer = 0;
        this.timeSinceLastDrink = 0; // Reset thirst so deer visits water naturally
        this.lastBloodDropTime = 0;
        
        // Reset wound state
        if (this.woundState) {
            this.woundState.reset();
        }

        if (this.model) {
            this.model.rotation.x = 0;
            this.model.rotation.z = 0;
        }

        this.animation.reset();
        this.setState('IDLE'); // Start in IDLE for natural behavior
        
        const spawnMode = gameContext.deerSpawnMode || 'random';
        let x, y, z;
        const worldSize = gameContext.worldConfig?.terrain?.size || 200;
        const maxAttempts = 50;
        let attempts = 0;
        let safePosition = null;
        
        while (attempts < maxAttempts && !safePosition) {
            attempts++;
            
            if (spawnMode === 'testing') {
                x = gameContext.player.position.x;
                z = gameContext.player.position.z + 20;
                y = gameContext.getHeightAt(x, z);
            } else if (spawnMode === 'near') {
                const minDistance = 30;
                const maxDistance = 80;
                const angle = Math.random() * 2 * Math.PI;
                const distance = minDistance + Math.random() * (maxDistance - minDistance);
                
                x = gameContext.player.position.x + Math.cos(angle) * distance;
                z = gameContext.player.position.z + Math.sin(angle) * distance;
                
                const boundary = worldSize / 2 - this.config.respawnBoundaryMargin;
                x = Math.max(-boundary, Math.min(boundary, x));
                z = Math.max(-boundary, Math.min(boundary, z));
                
                y = gameContext.getHeightAt(x, z);
            } else {
                const margin = 50;
                x = (Math.random() - 0.5) * (worldSize - margin);
                z = (Math.random() - 0.5) * (worldSize - margin);
                y = gameContext.getHeightAt(x, z);
            }
            
            const testPosition = new THREE.Vector3(x, y, z);
            const deerRadius = 0.7;
            
            // Check for tree collision and water - deer shouldn't spawn in water
            const noTreeCollision = !gameContext.checkTreeCollision || !gameContext.checkTreeCollision(testPosition, deerRadius);
            const notInWater = !gameContext.isWaterAt || !gameContext.isWaterAt(x, z);
            
            if (noTreeCollision && notInWater) {
                safePosition = testPosition;
            }
        }
        
        if (!safePosition) {
            safePosition = new THREE.Vector3(x, y, z);
        }

        this.spawn(safePosition, Math.PI);
        
        setTimeout(() => {
            triggerDeerSpawnBlowSound(this);
        }, 10000);
    }

    createTrack() { this.effects.createTrack(); }
    updateTracks() { this.effects.updateTracks(); }
    createBloodDrop() { this.effects.createBloodDrop(); }
    createShotBloodIndicator(hitPosition) { this.effects.createShotBloodIndicator(hitPosition); }
    updateBloodDrops() { this.effects.updateBloodDrops(); }

    spawn(position, rotationY) {
        super.spawn(position, rotationY);
        // Reset movement tracking to prevent false movement detection on spawn
        this.movement.resetMovementTracking();
        this.movement.lastPosition.copy(position);
        this.currentSpeed = 0;
        this.movementSpeed = 0;
    }

    createVitals(parent) {
        this.hitbox.createVitals(parent);
    }
    
    createSimpleVitalsHitbox() {
        this.hitbox.createSimpleVitalsHitbox();
    }

    update(delta) {
        if (!this.isModelLoaded) return;

        if (this.state === 'KILLED' || this.stateLockedToKilled) {
            if (this.stateLockedToKilled && this.state !== 'KILLED') {
                this.state = 'KILLED';
                gameContext.deerState = 'KILLED';
            }
            // Preserve X/Z position to prevent root motion drift from death animation
            const savedX = this.model.position.x;
            const savedZ = this.model.position.z;
            
            this.model.position.y = gameContext.getHeightAt(this.model.position.x, this.model.position.z) + this.config.heightOffset;
            this.stateTimer += delta;
            if (this.mixer) {
                this.mixer.update(delta);
            }
            
            // Restore X/Z position after mixer update
            this.model.position.x = savedX;
            this.model.position.z = savedZ;
            
            this.animation.update(delta);
            return;
        }

        super.update(delta);

        if (this.state === 'KILLED') return;

        updateDeerAudio(this, delta);

        if ((this.state === 'WOUNDED' || this.state === 'FLEEING') && gameContext.huntLog && gameContext.huntLog.deerInitialPosition) {
            const currentDistance = gameContext.huntLog.deerInitialPosition.distanceTo(this.model.position);
            gameContext.huntLog.distanceTrailed = Math.max(gameContext.huntLog.distanceTrailed, currentDistance);
        }

        this.timeSinceLastDrink += delta;
        this.effects.update();
        this.animation.update(delta);

        const distanceToPlayer = this.model.position.distanceTo(gameContext.player.position);
        const playerVisible = this.isPlayerVisible();
        const currentPlayerPosition = gameContext.player.position.clone();
        const playerMoved = this.lastPlayerPosition.distanceTo(currentPlayerPosition) > 0.005;

        if (playerVisible) {
            if (playerMoved) {
                this.movementSampleCount++;
                if (!this.isTrackingPlayerMovement && this.movementSampleCount >= this.REQUIRED_MOVEMENT_SAMPLES) {
                    this.isTrackingPlayerMovement = true;
                    this.playerMovementStartTime = gameContext.clock.getElapsedTime();
                    this.hasDetectedMovingPlayer = false;
                } else if (this.isTrackingPlayerMovement) {
                    const movementDuration = gameContext.clock.getElapsedTime() - this.playerMovementStartTime;
                    if (movementDuration >= this.MOVEMENT_DETECTION_THRESHOLD && !this.hasDetectedMovingPlayer) {
                        this.hasDetectedMovingPlayer = true;
                    }
                }
            } else {
                // Player stopped moving - reset detection faster (was decrementing by 1, now by 2)
                this.movementSampleCount = Math.max(0, this.movementSampleCount - 2);
                if (this.movementSampleCount === 0) {
                    this.isTrackingPlayerMovement = false;
                    this.hasDetectedMovingPlayer = false;
                }
            }
        } else {
            // Player not visible - immediately reset all tracking
            this.isTrackingPlayerMovement = false;
            this.hasDetectedMovingPlayer = false;
            this.movementSampleCount = 0;
        }

        this.lastPlayerPosition.copy(currentPlayerPosition);

        if (this.state !== 'FLEEING' && this.state !== 'WOUNDED' && this.state !== 'KILLED') {
            const currentTime = gameContext.clock.getElapsedTime();
            const inAlertDelay = this.state === 'ALERT' && (currentTime - this.alertStartTime < this.alertMovementDelay);
            
            // Check for noise-based detection (works even when player is not visible)
            const playerNoise = getPlayerNoise();
            const canHearPlayer = playerNoise.level > 0 && distanceToPlayer < playerNoise.range;
            
            // Visual detection (existing logic)
            const visualDetection = playerVisible && this.hasDetectedMovingPlayer;
            
            // Flee if player is too close AND (visible+moving OR making noise)
            // Check no-flee debug mode at runtime (not constructor) since deer is created before UI settings
            const noFleeDebug = gameContext.deerBehaviorMode === 'no-flee';
            if ((visualDetection || canHearPlayer) && distanceToPlayer < this.config.fleeDistanceThreshold && this.fleeingEnabled && !noFleeDebug && !inAlertDelay) {
                // Show debug modal explaining detection
                if (visualDetection && canHearPlayer) {
                    showDetectionDebugModal('both', `The deer detected you through <b>sight AND sound</b>!<br><br>
                        <b>Visual:</b> You were moving in the deer's line of sight.<br>
                        <b>Sound:</b> ${playerNoise.source} (range: ${playerNoise.range.toFixed(0)} yds)<br><br>
                        Distance: ${(distanceToPlayer * 1.09).toFixed(0)} yards`);
                } else if (visualDetection) {
                    showDetectionDebugModal('visual', `The deer <b>saw you moving</b>!<br><br>
                        You were within the deer's field of view and your movement was detected.<br><br>
                        Distance: ${(distanceToPlayer * 1.09).toFixed(0)} yards<br>
                        <b>Tip:</b> Stay still or use cover to avoid visual detection.`);
                } else if (canHearPlayer) {
                    showDetectionDebugModal('sound', `The deer <b>heard you</b>!<br><br>
                        <b>Sound source:</b> ${playerNoise.source}<br>
                        <b>Noise range:</b> ${playerNoise.range.toFixed(0)} yards<br><br>
                        Distance: ${(distanceToPlayer * 1.09).toFixed(0)} yards<br>
                        <b>Tip:</b> Move slowly and avoid running or walking through brush.`);
                }
                this.setState('FLEEING');
                applySpookingPenalty();
            } else if ((visualDetection || canHearPlayer) && distanceToPlayer < this.config.alertDistanceThreshold) {
                if (this.state !== 'ALERT') {
                    // Show debug modal for alert state
                    if (visualDetection && canHearPlayer) {
                        showDetectionDebugModal('both', `The deer is <b>alert</b> - it sensed you through sight AND sound!<br><br>
                            Distance: ${(distanceToPlayer * 1.09).toFixed(0)} yards<br>
                            <b>Warning:</b> Get closer and it will flee!`);
                    } else if (visualDetection) {
                        showDetectionDebugModal('visual', `The deer is <b>alert</b> - it saw movement!<br><br>
                            Distance: ${(distanceToPlayer * 1.09).toFixed(0)} yards<br>
                            <b>Tip:</b> Stay still and it may calm down.`);
                    } else if (canHearPlayer) {
                        showDetectionDebugModal('sound', `The deer is <b>alert</b> - it heard something!<br><br>
                            <b>Sound:</b> ${playerNoise.source}<br>
                            Distance: ${(distanceToPlayer * 1.09).toFixed(0)} yards<br>
                            <b>Tip:</b> Stop making noise and it may calm down.`);
                    }
                    this.setState('ALERT');
                }
            } else if (this.state === 'ALERT' && !playerVisible && !canHearPlayer) {
                this.setState('IDLE');
            }
            
            // Award scouting bonus when player spots deer without spooking it
            // Player must be within reasonable distance and deer must be visible but not fleeing
            if (playerVisible && distanceToPlayer < 100 && !this.hasDetectedMovingPlayer && !canHearPlayer && this.state !== 'ALERT') {
                awardScoutingBonus();
            }
        }

        this.ai.update(delta);
    }

    loadModel(path) {
        super.loadModel(path);
    }
    
    isPlayerVisible() {
        if (!gameContext.player || !gameContext.trees) return true;
        
        const currentTime = gameContext.clock.getElapsedTime();
        const isKneeling = gameContext.playerControls?.isKneeling || false;
        let distanceToPlayer = this.model.position.distanceTo(gameContext.player.position);

        if (isKneeling) {
            distanceToPlayer *= 0.5;
        }
        
        if (distanceToPlayer > 200) {
            this.cachedVisibility = false;
            this.lastVisibilityCheck = currentTime;
            return false;
        }
        
        // Visibility check intervals - shorter = more responsive but more CPU
        // Reduced intervals to prevent stale visibility data causing false detections
        let checkInterval = 0.5;
        switch (this.state) {
            case 'ALERT': checkInterval = 0.15; break;
            case 'FLEEING':
            case 'WOUNDED': checkInterval = 0.3; break;
            case 'GRAZING':
            case 'DRINKING': checkInterval = 0.75; break; // Reduced from 2.0 - was causing stale visibility
            case 'IDLE':
            case 'WANDERING':
            default: checkInterval = 0.5; break; // Reduced from 1.0
        }
        
        if (this.lastVisibilityCheck && currentTime - this.lastVisibilityCheck < checkInterval) {
            // Only use cache if it's defined - never default to visible
            if (this.cachedVisibility !== undefined) {
                return this.cachedVisibility;
            }
            // If no cached value, fall through to do a fresh check
        }
        
        // Very close range - always visible (can't hide when deer is right next to you)
        if (distanceToPlayer < 8) {
            this.cachedVisibility = true;
            this.lastVisibilityCheck = currentTime;
            return true;
        }
        
        const currentPlayerPosition = gameContext.player.position.clone();
        // Only use position-based cache if player hasn't moved much AND we have a valid cached value
        if (this.lastPlayerPositionForVisibility && this.cachedVisibility !== undefined) {
            const playerMovedDistance = this.lastPlayerPositionForVisibility.distanceTo(currentPlayerPosition);
            if (playerMovedDistance < 2.0) {
                this.lastVisibilityCheck = currentTime;
                return this.cachedVisibility;
            }
        }
        
        this.lastPlayerPositionForVisibility = currentPlayerPosition.clone();
        
        const deerPosition = this.model.position.clone();
        const playerPosition = currentPlayerPosition.clone();
        
        deerPosition.y += 1.5;
        playerPosition.y += isKneeling ? 0.9 : 1.7;
        
        const direction = new THREE.Vector3().subVectors(playerPosition, deerPosition).normalize();
        
        gameContext.raycaster.set(deerPosition, direction);
        gameContext.raycaster.far = distanceToPlayer;
        
        const nearbyObjects = [];
        const MAX_OBJECTS_TO_CHECK = 16;
        
        // Check trees
        if (gameContext.trees && gameContext.trees.children) {
            for (const tree of gameContext.trees.children) {
                const treeDistance = deerPosition.distanceTo(tree.position);
                if (treeDistance < distanceToPlayer + 3) {
                    nearbyObjects.push(tree);
                    if (nearbyObjects.length >= MAX_OBJECTS_TO_CHECK) break;
                }
            }
        }
        
        // Check bushes (only if we haven't hit the limit)
        if (nearbyObjects.length < MAX_OBJECTS_TO_CHECK && gameContext.bushes && gameContext.bushes.children) {
            for (const bush of gameContext.bushes.children) {
                const bushDistance = deerPosition.distanceTo(bush.position);
                if (bushDistance < distanceToPlayer + 3) {
                    nearbyObjects.push(bush);
                    if (nearbyObjects.length >= MAX_OBJECTS_TO_CHECK) break;
                }
            }
        }
        
        const intersects = gameContext.raycaster.intersectObjects(nearbyObjects, true);
        const blockingIntersects = intersects.filter(intersect => intersect.distance < distanceToPlayer - 0.5);
        
        let terrainBlocked = false;
        if (blockingIntersects.length === 0) {
            const rayLength = distanceToPlayer;
            const stepSize = rayLength / 5;
            for (let i = 1; i < 5; i++) {
                const checkPoint = new THREE.Vector3().copy(deerPosition).add(direction.clone().multiplyScalar(i * stepSize));
                const terrainHeight = gameContext.getHeightAt(checkPoint.x, checkPoint.z);
                if (terrainHeight > checkPoint.y) {
                    terrainBlocked = true;
                    break;
                }
            }
        }
        
        // If player is fully blocked, they're not visible
        if (blockingIntersects.length > 0 || terrainBlocked) {
            this.cachedVisibility = false;
            this.lastVisibilityCheck = currentTime;
            return false;
        }
        
        // Check for backdrop cover (bushes/grass behind the player from deer's view)
        // This makes the player's silhouette harder to see
        const hasBackdropCover = this.checkBackdropCover(playerPosition, direction, distanceToPlayer);
        
        if (hasBackdropCover) {
            // With backdrop cover, effective distance is doubled (harder to see)
            // This means deer needs to be closer to detect the player
            const effectiveDistance = distanceToPlayer * 2;
            if (effectiveDistance > this.config.alertDistanceThreshold) {
                this.cachedVisibility = false;
                this.lastVisibilityCheck = currentTime;
                return false;
            }
        }
        
        this.cachedVisibility = true;
        this.lastVisibilityCheck = currentTime;
        
        return this.cachedVisibility;
    }
    
    /**
     * Checks if there's cover (trees/bushes/grass) behind the player from the deer's perspective
     * This breaks up the player's silhouette making them harder to spot
     */
    checkBackdropCover(playerPosition, directionToDeer, distanceToPlayer) {
        // Cast a ray from player position away from deer (behind player)
        const behindPlayerDir = directionToDeer.clone().negate();
        const checkDistance = 5; // Check 5 units behind player
        
        // Check for trees behind player (standing in front of a tree trunk)
        if (gameContext.trees && gameContext.trees.children) {
            for (const tree of gameContext.trees.children) {
                const toTree = new THREE.Vector3().subVectors(tree.position, playerPosition);
                toTree.y = 0;
                
                const dotProduct = toTree.normalize().dot(behindPlayerDir);
                if (dotProduct > 0.7) { // Tree must be more directly behind (~45 degrees)
                    const distToTree = playerPosition.distanceTo(tree.position);
                    if (distToTree < 3) { // Must be very close to tree trunk
                        return true; // Found backdrop cover
                    }
                }
            }
        }
        
        // Check for bushes behind player
        if (gameContext.bushes && gameContext.bushes.children) {
            for (const bush of gameContext.bushes.children) {
                // Get vector from player to bush
                const toBush = new THREE.Vector3().subVectors(bush.position, playerPosition);
                toBush.y = 0; // Ignore height difference
                
                // Check if bush is roughly behind the player (from deer's view)
                const dotProduct = toBush.normalize().dot(behindPlayerDir);
                if (dotProduct > 0.5) { // Bush is within ~60 degrees behind player
                    const distToBush = playerPosition.distanceTo(bush.position);
                    if (distToBush < checkDistance) {
                        return true; // Found backdrop cover
                    }
                }
            }
        }
        
        // Check for grass clusters behind player
        if (gameContext.grassClusterPositions && gameContext.grassClusterPositions.length > 0) {
            for (const cluster of gameContext.grassClusterPositions) {
                const clusterPos = new THREE.Vector3(cluster.x, playerPosition.y, cluster.z);
                const toCluster = new THREE.Vector3().subVectors(clusterPos, playerPosition);
                toCluster.y = 0;
                
                const dotProduct = toCluster.normalize().dot(behindPlayerDir);
                if (dotProduct > 0.5) {
                    const distToCluster = playerPosition.distanceTo(clusterPos);
                    if (distToCluster < checkDistance) {
                        return true; // Found backdrop cover
                    }
                }
            }
        }
        
        return false;
    }
}

export const deer = new Deer();
