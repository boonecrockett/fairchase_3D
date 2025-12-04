import * as THREE from 'three';
import { gameContext } from './context.js';
import { MOUSE_SENSITIVITY as MOUSE_SENSITIVITY_NORMAL } from './constants.js';
import { startWalkSound, stopWalkSound, startWaterWalkSound, stopWaterWalkSound, startFoliageWalkSound, stopFoliageWalkSound } from './audio.js';
import { showSmartphoneMap, closeSmartphoneMap } from './map.js';
import { updateSpatialAudioListener } from './spatial-audio.js';
import { tagDeer } from './hunting-mechanics.js';
import { updateDistanceTraveled } from './report-logger.js';

// --- Player Module Constants ---

/**
 * Checks if player input should be allowed based on game state.
 * @returns {boolean} True if input is allowed, false otherwise.
 */
function isInputAllowed() {
    return !gameContext.isSleeping;
}

/**
 * Checks if the player can tag a deer.
 * @returns {boolean} True if deer can be tagged, false otherwise.
 */
function canTagDeer() {
    if (!gameContext.deer) return false;
    if (gameContext.deer.state !== 'KILLED') return false;
    if (gameContext.deer.tagged) return false;
    
    // Check if player is close enough to the deer (within 4 units)
    const distance = gameContext.player.position.distanceTo(gameContext.deer.model.position);
    return distance < 4;
}
const PLAYER_EYE_HEIGHT = 2.04; // Scaled down from 6.0
const PLAYER_KNEEL_HEIGHT = 0.85; // Scaled down from 2.5
// Spawn player at edge of pond, overlooking the water (pond is at 0,0 with radius ~46)
const INITIAL_PLAYER_X = 60;
const INITIAL_PLAYER_Z = 60;

// Realistic walking speeds (1 unit ≈ 1 yard ≈ 0.91 meters)
// Normal walking: 1.4 m/s = ~1.54 units/s (3.1 mph - average human walking)
// Sprinting: 4.0 m/s = ~4.4 units/s (9 mph - jogging pace)
const PLAYER_WALK_SPEED = 1.54;   // Normal walking speed
const PLAYER_SPRINT_SPEED = 4.4; // Faster sprint speed (hold Shift)
const PLAYER_MOVE_SPEED = PLAYER_WALK_SPEED; // Default to normal walk

// Stamina system constants
const STAMINA_MAX = 100;
const STAMINA_DRAIN_RATE = 10; // Drain per second while sprinting (10 seconds to deplete)
const STAMINA_REGEN_RATE = 15; // Regen per second while not sprinting (6.7 seconds to full)
const STAMINA_REGEN_RATE_KNEELING = 25; // Faster regen while kneeling
const STAMINA_EXHAUSTED_THRESHOLD = 20; // Below this, bar turns red
const STAMINA_DEPLETED_THRESHOLD = 50; // Below this, bar turns yellow
const MOUSE_SENSITIVITY_SCOPED = 0.0005; // Restored to normal scoped sensitivity
const CAMERA_FOV_NORMAL = 60; // Reduced from 75 for a more natural perspective
const CAMERA_FOV_SCOPED = 15;

// Scope sway parameters for realistic breathing/nerves effect
const SCOPE_SWAY_FREQUENCY = 2.5; // Breathing rate frequency
const SCOPE_SWAY_AMPLITUDE = 0.00017; // Reduced by 50% for less standing sway
const SCOPE_SWAY_NOISE_AMPLITUDE = 0.0002125; // Reduced by 50% for less standing sway
const SCOPE_SWAY_NOISE_FREQUENCY = 6.0; // Increased from 4.0 for more varied tremor
const TREE_BRACE_REDUCTION = 0.13; // When braced against tree, reduce sway to 13% (increased by 5%)
const KNEEL_SWAY_REDUCTION = 0.35; // When kneeling, reduce sway to 35%

// --- HUMAN TRACKING CONSTANTS ---
const HUMAN_TRACK_CONFIG = {
    trackColor: 0x000000, // Black color for human tracks
    trackOpacityStart: 0.5, // 50% opacity
    trackFadeDurationS: 4500, // Same as deer tracks
    trackWidth: 0.33, // Width of the track geometry (184/304 aspect ratio)
    trackLength: 0.55, // Length of the track geometry
    trackCreationDistanceThreshold: 0.55, // Place tracks end-to-end
    footprintSpacing: 0, // Deprecated, spacing is handled by threshold
};

// --- Local state for player module ---
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let wheelMoveForward = false;
let wheelMoveBackward = false;
let wheelTimeout = null;
let isScoped = false;
let isSprinting = false; // Shift key for faster movement
let stamina = STAMINA_MAX; // Current stamina level
let isExhausted = false; // Can't sprint when exhausted until stamina recovers
let mouseSensitivity = MOUSE_SENSITIVITY_NORMAL; // Initialized with normal sensitivity
let scopeSwayTime = 0; // Time accumulator for scope sway animation
let lastTrackCreationPosition = null;
let humanTracks = []; // Array to store human track objects
let isWalking = false;
let isTreeBraced = false;
let isWalkingOnWater = false;
let isWalkingOnFoliage = false;
let isKneeling = false;

// Noise detection system
let foliageNoiseTimer = 0; // Time spent making noise on foliage
const FOLIAGE_NOISE_THRESHOLD = 2.0; // Seconds of foliage noise before deer can hear
const SPRINT_NOISE_RANGE = 60; // Detection range when sprinting
const FOLIAGE_NOISE_RANGE = 40; // Detection range when walking on foliage for extended time
let currentNoiseLevel = 0; // 0 = silent, 1 = foliage noise, 2 = sprint noise
let lastMovementDirection = new THREE.Vector3(); // Store last movement direction for footprint orientation
let humanTrackTexture = null; // Cached texture

// --- EXPORTED FUNCTIONS ---

/**
 * Creates the player object, sets its initial position, and adds it to the scene.
 * The player is a THREE.Group containing the camera.
 */
export function createPlayer(camera, scene) {
    // Ensure kneeling indicator is hidden on initialization
    if (gameContext.kneelingIndicatorElement) {
        gameContext.kneelingIndicatorElement.style.display = 'none';
    }

    gameContext.player = new THREE.Group();
    gameContext.camera.position.set(0, PLAYER_EYE_HEIGHT, 0); // Player height relative to the group
    gameContext.player.add(gameContext.camera);
    gameContext.scene.add(gameContext.player);

    // Set initial position
    const initialY = gameContext.getHeightAt(INITIAL_PLAYER_X, INITIAL_PLAYER_Z);
    gameContext.player.position.set(INITIAL_PLAYER_X, initialY, INITIAL_PLAYER_Z);

    gameContext.lastPlayerPosition.copy(gameContext.player.position);
}

/**
 * Adds all necessary event listeners for player controls (keyboard and mouse).
 */
export function addPlayerEventListeners() {
    // Expose map function globally for UI buttons
    window.toggleMap = showSmartphoneMap;
    
    // Ensure document has focus for key events
    if (document.hasFocus && !document.hasFocus()) {
        window.focus();
    }
    
    document.addEventListener('pointerlockchange', function() {
        const indicator = document.getElementById('mouse-look-indicator');
        if (document.pointerLockElement) {
            window.focus();
            if (indicator) indicator.classList.remove('initially-hidden');
        } else {
            if (indicator) indicator.classList.add('initially-hidden');
        }
    }, false);
    document.addEventListener('mozpointerlockchange', function() {
        const indicator = document.getElementById('mouse-look-indicator');
        if (document.mozPointerLockElement) {
            window.focus();
            if (indicator) indicator.classList.remove('initially-hidden');
        } else {
            if (indicator) indicator.classList.add('initially-hidden');
        }
    }, false);
    document.addEventListener('webkitpointerlockchange', function() {
        const indicator = document.getElementById('mouse-look-indicator');
        if (document.webkitPointerLockElement) {
            window.focus();
            if (indicator) indicator.classList.remove('initially-hidden');
        } else {
            if (indicator) indicator.classList.add('initially-hidden');
        }
    }, false);

    document.addEventListener('keydown', onKeyDown, false);
    document.addEventListener('keyup', onKeyUp, false);
    
    document.addEventListener('mousedown', onMouseDown, false);
    document.addEventListener('mouseup', onMouseUp, false);
    
    document.addEventListener('mousemove', onMouseMove, false);
    document.addEventListener('wheel', onWheel, { passive: false });
    
    document.addEventListener('pointerlockerror', function() {
        showMessage('Pointer lock failed. Please try again or refresh the page.', 3000);
    }, false);
    document.addEventListener('mozpointerlockerror', function() {
        showMessage('Pointer lock failed. Please try again or refresh the page.', 3000);
    }, false);
    document.addEventListener('webkitpointerlockerror', function() {
        showMessage('Pointer lock failed. Please try again or refresh the page.', 3000);
    }, false);

    // Ensure we have focus
    ensureGameFocus();
}

// Add a click event listener to ensure focus is on the game container for key events
function ensureGameFocus() {
    // Try to find specific container, fall back to body
    const gameContainer = document.getElementById('browser-preview-root') || document.body;
    
    gameContainer.addEventListener('click', function() {
        if (!document.hasFocus()) {
            window.focus();
        }
    });

    // Add a document-level key event listener to ensure key events are captured
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            if (document.activeElement && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
            }
            window.focus();
        }
    });
}

/**
 * Updates the stamina bar UI based on current stamina level.
 */
function updateStaminaUI() {
    const staminaContainer = document.getElementById('stamina-container');
    const staminaFill = document.getElementById('stamina-fill');
    
    if (!staminaContainer || !staminaFill) return;
    
    // Show stamina bar when not full or when sprinting
    const shouldShow = stamina < STAMINA_MAX || isSprinting;
    staminaContainer.classList.toggle('visible', shouldShow);
    
    // Update fill width
    staminaFill.style.width = `${stamina}%`;
    
    // Update color based on stamina level
    staminaFill.classList.remove('depleted', 'exhausted');
    if (stamina <= STAMINA_EXHAUSTED_THRESHOLD) {
        staminaFill.classList.add('exhausted');
    } else if (stamina <= STAMINA_DEPLETED_THRESHOLD) {
        staminaFill.classList.add('depleted');
    }
}

/**
 * Updates the player's position and state based on input and game logic.
 * Handles movement, terrain height adjustment, and distance tracking.
 */
export function updatePlayer() {
    const delta = gameContext.deltaTime;
    const velocity = new THREE.Vector3();

    if (moveForward || wheelMoveForward) velocity.z -= 1;
    if (moveBackward || wheelMoveBackward) velocity.z += 1;
    if (moveLeft) velocity.x -= 1;
    if (moveRight) velocity.x += 1;

    // Apply rotation to velocity vector
    velocity.applyQuaternion(gameContext.player.quaternion);

    // Prevent movement when kneeling, otherwise calculate velocity
    if (isKneeling) {
        // Show warning if trying to move while kneeling
        const tryingToMove = moveForward || moveBackward || moveLeft || moveRight;
        const kneelingWarning = document.getElementById('kneeling-warning');
        if (kneelingWarning) {
            kneelingWarning.style.display = tryingToMove ? 'block' : 'none';
        }
        velocity.set(0, 0, 0);
        
        // Regenerate stamina faster while kneeling
        stamina = Math.min(STAMINA_MAX, stamina + STAMINA_REGEN_RATE_KNEELING * delta);
        if (stamina >= STAMINA_DEPLETED_THRESHOLD) {
            isExhausted = false;
        }
    } else {
        // Hide kneeling warning when not kneeling
        const kneelingWarning = document.getElementById('kneeling-warning');
        if (kneelingWarning) {
            kneelingWarning.style.display = 'none';
        }
        
        // Determine if we can actually sprint
        const isMoving = velocity.lengthSq() > 0;
        const canSprint = isSprinting && !isExhausted && stamina > 0 && isMoving;
        
        // Update stamina
        if (canSprint) {
            stamina = Math.max(0, stamina - STAMINA_DRAIN_RATE * delta);
            if (stamina <= 0) {
                isExhausted = true;
            }
        } else if (isMoving) {
            // Slower regen while walking
            stamina = Math.min(STAMINA_MAX, stamina + STAMINA_REGEN_RATE * 0.5 * delta);
            if (stamina >= STAMINA_DEPLETED_THRESHOLD) {
                isExhausted = false;
            }
        } else {
            // Full regen while standing still
            stamina = Math.min(STAMINA_MAX, stamina + STAMINA_REGEN_RATE * delta);
            if (stamina >= STAMINA_DEPLETED_THRESHOLD) {
                isExhausted = false;
            }
        }
        
        // Use sprint speed only if we can actually sprint
        const currentSpeed = canSprint ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED;
        velocity.normalize().multiplyScalar(currentSpeed * delta);
    }
    
    // Update stamina UI
    updateStaminaUI();
    
    // Update noise level for deer detection
    const isMoving = velocity.lengthSq() > 0;
    const canSprint = isSprinting && !isExhausted && stamina > 0 && isMoving;
    
    if (canSprint) {
        // Sprinting is always noisy
        currentNoiseLevel = 2;
        foliageNoiseTimer = 0; // Reset foliage timer
    } else if (isMoving && isWalkingOnFoliage) {
        // Walking on foliage builds up noise over time
        foliageNoiseTimer += delta;
        if (foliageNoiseTimer >= FOLIAGE_NOISE_THRESHOLD) {
            currentNoiseLevel = 1;
        } else {
            currentNoiseLevel = 0;
        }
    } else {
        // Not moving or walking on quiet surface
        currentNoiseLevel = 0;
        foliageNoiseTimer = Math.max(0, foliageNoiseTimer - delta * 2); // Decay faster than buildup
    }

    if (velocity.lengthSq() > 0) {
        // Store previous position for velocity calculation
        const previousPosition = gameContext.player.position.clone();
        
        // Check for tree collision before moving
        const newPosition = gameContext.player.position.clone().add(velocity);
        const collision = gameContext.checkTreeCollision(newPosition, 0.8); // Player collision radius
        
        if (!collision) {
            // No collision - safe to move
            gameContext.player.position.add(velocity);
        } else {
            // Tree collision detected - try sliding along obstacles
            const xVelocity = new THREE.Vector3(velocity.x, 0, 0);
            const zVelocity = new THREE.Vector3(0, 0, velocity.z);
            
            // Try moving only in X direction
            const xPosition = gameContext.player.position.clone().add(xVelocity);
            if (!gameContext.checkTreeCollision(xPosition, 0.8)) {
                gameContext.player.position.add(xVelocity);
            }
            // Try moving only in Z direction
            else {
                const zPosition = gameContext.player.position.clone().add(zVelocity);
                if (!gameContext.checkTreeCollision(zPosition, 0.8)) {
                    gameContext.player.position.add(zVelocity);
                }
                // If both directions blocked, don't move
            }
        }
        
        const distanceMoved = velocity.length();
        gameContext.distanceTraveled += distanceMoved;
        
        // Update distance traveled for report (includes tracking distance when following wounded deer)
        updateDistanceTraveled(distanceMoved);
        
        // Calculate player velocity for spatial audio Doppler effects
        gameContext.player.velocity = gameContext.player.position.clone().sub(previousPosition).divideScalar(delta);
        
        updateSpatialAudioListener(gameContext.player.position, gameContext.player.velocity);
    }

    // Update player height based on terrain
    const targetY = gameContext.getHeightAt(gameContext.player.position.x, gameContext.player.position.z);
    gameContext.player.position.y = targetY;

    // Adjust camera height for kneeling
    const targetEyeHeight = isKneeling ? PLAYER_KNEEL_HEIGHT : PLAYER_EYE_HEIGHT;
    gameContext.camera.position.y = THREE.MathUtils.lerp(gameContext.camera.position.y, targetEyeHeight, 0.1);

    // Always check water status at current position (not just when moving)
    // This ensures water sound stops immediately when leaving water
    const isOnWater = gameContext.isWaterAt(gameContext.player.position.x, gameContext.player.position.z);
    // Safety check for isFoliageAt to prevent crashes if initialization is delayed
    let isOnFoliage = false;
    if (typeof gameContext.isFoliageAt === 'function') {
        isOnFoliage = gameContext.isFoliageAt(gameContext.player.position.x, gameContext.player.position.z);
    }
    
    // Handle water state transitions - immediately stop water sound when leaving water
    if (isOnWater !== isWalkingOnWater) {
        if (isWalkingOnWater && !isOnWater) {
            // Left water - stop water sound immediately
            stopWaterWalkSound();
            if (velocity.lengthSq() > 0) {
                // Start appropriate land sound if still moving
                if (isOnFoliage) {
                    startFoliageWalkSound();
                } else {
                    startWalkSound();
                }
            }
        } else if (!isWalkingOnWater && isOnWater && velocity.lengthSq() > 0) {
            // Entered water while moving - switch to water sound
            stopWalkSound();
            stopFoliageWalkSound();
            startWaterWalkSound();
        }
        isWalkingOnWater = isOnWater;
    }

    // Handle foliage state transitions
    if (isOnFoliage !== isWalkingOnFoliage) {
        isWalkingOnFoliage = isOnFoliage;
        // Immediately update sound state to prevent lingering sound
        if (velocity.lengthSq() > 0) {
            if (isOnFoliage) {
                startFoliageWalkSound();
                stopWalkSound();
            } else {
                startWalkSound();
                stopFoliageWalkSound();
            }
        }
    }

    // Track distance traveled
    if (gameContext.lastPlayerPosition.distanceTo(gameContext.player.position) > 0) {
        gameContext.lastPlayerPosition.copy(gameContext.player.position);
    }

    // Update human tracks
    updateHumanTracks();

    // Create human tracks if moving
    if (velocity.lengthSq() > 0) {
        // Store movement direction for proper footprint orientation
        if (velocity.lengthSq() > 0.01) {
            lastMovementDirection.copy(velocity).normalize();
        }
        
        if (!lastTrackCreationPosition || 
            gameContext.player.position.distanceTo(lastTrackCreationPosition) >= HUMAN_TRACK_CONFIG.trackCreationDistanceThreshold) {
            createHumanTrack(lastMovementDirection);
            lastTrackCreationPosition = gameContext.player.position.clone();
        }
    }

    // --- INTERACTION LOGIC ---
    // Check for deer tagging proximity
    if (gameContext.deer && gameContext.deer.isFallen && !gameContext.deer.tagged) {
        const distanceToDeer = gameContext.player.position.distanceTo(gameContext.deer.mesh.position);
        if (distanceToDeer < 5) { // 5 units of distance to allow tagging
            gameContext.canTag = true;
            gameContext.interactionPromptElement.textContent = 'Press E to Tag';
            gameContext.interactionPromptElement.style.display = 'block';
        } else {
            gameContext.canTag = false;
            gameContext.interactionPromptElement.style.display = 'none';
        }
    } else {
        // Ensure prompt is hidden if deer is not in a taggable state
        if (gameContext.interactionPromptElement.style.display === 'block') {
            gameContext.canTag = false;
            gameContext.interactionPromptElement.style.display = 'none';
        }
    }

    // Update tree bracing
    checkTreeBracing();

    // Update scope sway if scoped
    if (isScoped) {
        scopeSwayTime += delta;
        
        // Breathing sway (slow, rhythmic)
        let swayX = Math.sin(scopeSwayTime * SCOPE_SWAY_FREQUENCY) * SCOPE_SWAY_AMPLITUDE;
        let swayY = Math.cos(scopeSwayTime * SCOPE_SWAY_FREQUENCY * 0.7) * SCOPE_SWAY_AMPLITUDE * 0.8;
        
        // Noise/tremor (faster, irregular)
        let noiseX = (Math.sin(scopeSwayTime * SCOPE_SWAY_NOISE_FREQUENCY) + 
                       Math.sin(scopeSwayTime * SCOPE_SWAY_NOISE_FREQUENCY * 1.3)) * SCOPE_SWAY_NOISE_AMPLITUDE * 0.5;
        let noiseY = (Math.cos(scopeSwayTime * SCOPE_SWAY_NOISE_FREQUENCY * 0.9) + 
                       Math.cos(scopeSwayTime * SCOPE_SWAY_NOISE_FREQUENCY * 1.7)) * SCOPE_SWAY_NOISE_AMPLITUDE * 0.5;
        
        // Random micro-shifts (very subtle, occasional)
        let randomShiftX = (Math.random() < 0.05) ? (Math.random() - 0.5) * SCOPE_SWAY_NOISE_AMPLITUDE * 0.3 : 0;
        let randomShiftY = (Math.random() < 0.05) ? (Math.random() - 0.5) * SCOPE_SWAY_NOISE_AMPLITUDE * 0.3 : 0;
        
        // Micro-adjustments (very rare, very small)
        let microAdjustX = (Math.random() < 0.1) ? (Math.random() - 0.5) * SCOPE_SWAY_NOISE_AMPLITUDE * 0.5 : 0;
        let microAdjustY = (Math.random() < 0.1) ? (Math.random() - 0.5) * SCOPE_SWAY_NOISE_AMPLITUDE * 0.5 : 0;
        
        // Reduce sway if braced against a tree or kneeling
        if (isTreeBraced) {
            const reduction = isKneeling ? TREE_BRACE_REDUCTION * KNEEL_SWAY_REDUCTION : TREE_BRACE_REDUCTION;
            swayX *= reduction;
            swayY *= reduction;
            noiseX *= reduction;
            noiseY *= reduction;
            randomShiftX *= reduction;
            randomShiftY *= reduction;
            microAdjustX *= reduction;
            microAdjustY *= reduction;
        } else if (isKneeling) {
            swayX *= KNEEL_SWAY_REDUCTION;
            swayY *= KNEEL_SWAY_REDUCTION;
            noiseX *= KNEEL_SWAY_REDUCTION;
            noiseY *= KNEEL_SWAY_REDUCTION;
            randomShiftX *= KNEEL_SWAY_REDUCTION;
            randomShiftY *= KNEEL_SWAY_REDUCTION;
            microAdjustX *= KNEEL_SWAY_REDUCTION;
            microAdjustY *= KNEEL_SWAY_REDUCTION;
        }
        
        gameContext.camera.rotation.x += swayY + noiseY + randomShiftY + microAdjustY;
        gameContext.camera.rotation.y += swayX + noiseX + randomShiftX + microAdjustX;
    }

    // Update walking sound based on movement and water state
    if (velocity.lengthSq() > 0 && !isWalking) {
        // Start appropriate sound based on water state
        if (isWalkingOnWater) {
            startWaterWalkSound();
        } else if (isWalkingOnFoliage) {
            startFoliageWalkSound();
        } else {
            startWalkSound();
        }
        isWalking = true;
    } else if (velocity.lengthSq() === 0 && isWalking) {
        // Stop all walking sounds when not moving
        stopWalkSound();
        stopWaterWalkSound();
        stopFoliageWalkSound();
        isWalking = false;
    } else if (velocity.lengthSq() > 0 && isWalking) {
        // Player is moving and already walking - check if we need to switch sounds
        // This handles the case where player transitions between water/land while moving
        if (isWalkingOnWater) {
            startWaterWalkSound();
            stopWalkSound();
            stopFoliageWalkSound();
        } else if (isWalkingOnFoliage) {
            startFoliageWalkSound();
            stopWalkSound();
            stopWaterWalkSound();
        } else {
            startWalkSound();
            stopWaterWalkSound();
            stopFoliageWalkSound();
        }
    }
}

// --- INTERNAL EVENT HANDLERS ---
/**
 * Handles mouse down events for shooting and scoping.
 * Requests pointer lock if not already active.
 * @param {MouseEvent} event - The mouse event.
 */
function onMouseDown(event) {
    // Handle UI button clicks normally (don't prevent them)
    if (event.target.tagName === 'BUTTON' || event.target.closest('.modal') || event.target.closest('.mode-button') || event.target.closest('#main-menu-container')) {
        return;
    }
    
    // Don't request pointer lock if clicking on a modal backdrop - let it close first
    if (event.target.classList.contains('modal-backdrop')) {
        return;
    }
    
    // Prevent default behavior for game area clicks
    event.preventDefault();
    event.stopPropagation();
    
    // Don't request pointer lock if main menu is still visible (game not started)
    if (gameContext.mainMenu && gameContext.mainMenu.style.display !== 'none') {
        return; // Don't capture cursor on title screen
    }
    
    // Don't request pointer lock if any modal is open
    const openModals = document.querySelectorAll('.modal-backdrop[style*="display: flex"]');
    if (openModals.length > 0) {
        return;
    }
    
    // Don't auto-lock on first click after game starts - require explicit click on game area
    if (!gameContext.gameStartedAndReady) {
        return;
    }
    
    // Request pointer lock if not already active
    if (!document.pointerLockElement && !document.mozPointerLockElement && !document.webkitPointerLockElement) {
        try {
            const result = document.body.requestPointerLock();
            if (result && result.catch) {
                result.catch(() => {});
            }
        } catch (err) {
            // Ignore errors
        }
        return;
    }
    
    // Handle game actions if pointer lock is active
    if (event.button === 0) { // Left click
        if (gameContext.gameMode === 'simulator' && !isScoped) {
            // In simulator mode, do nothing if not scoped
            return;
        }
        fireWeapon();
    } else if (event.button === 2) { // Right click
        toggleScope(true);
    }
}

/**
 * Handles mouse up events, specifically for unscoping the rifle.
 * @param {MouseEvent} event - The mouse event.
 */
function onMouseUp(event) {
    if (event.button === 2) { // Right click release
        toggleScope(false);
    }
}

/**
 * Handles key down events for player movement and interaction (tagging deer).
 * @param {KeyboardEvent} event - The keyboard event.
 */
function onKeyDown(event) {
    if (!isInputAllowed()) return;
    
    // Debug log
    // console.log('Key Down:', event.code);

    const allowedKeys = ['KeyE', 'KeyM', 'KeyC']; // E for Tag, M for Map, C for Kneel
    if (allowedKeys.includes(event.code)) {
        event.preventDefault();
    }
    
    // Shift key for sprinting
    if (event.shiftKey) {
        isSprinting = true;
    }
    
    switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
            moveForward = true;
            break;
        case 'KeyS':
        case 'ArrowDown':
            moveBackward = true;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            moveLeft = true;
            break;
        case 'KeyD':
        case 'ArrowRight':
            moveRight = true;
            break;
        case 'KeyC':
            toggleKneel();
            break;
        case 'KeyE':
            if (canTagDeer()) {
                tagDeer();
            }
            break;
        case 'KeyM':
            showSmartphoneMap();
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            isSprinting = true;
            break;
    }
}

/**
 * Handles key up events to stop player movement.
 * @param {KeyboardEvent} event - The keyboard event.
 */
function onKeyUp(event) {
    switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
            moveForward = false;
            break;
        case 'KeyS':
        case 'ArrowDown':
            moveBackward = false;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            moveLeft = false;
            break;
        case 'KeyD':
        case 'ArrowRight':
            moveRight = false;
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            isSprinting = false;
            break;
        case 'KeyM':
            closeSmartphoneMap();
            break;
    }
}

/**
 * Handles mouse move events for player look controls (camera rotation).
 * Only active when pointer lock is engaged.
 * @param {MouseEvent} event - The mouse event.
 */
function onMouseMove(event) {
    if (document.pointerLockElement === document.body) {
        // Null check to prevent TypeError if camera or player objects are not fully initialized
        if (gameContext.player && gameContext.camera) {
            gameContext.player.rotation.y -= event.movementX * mouseSensitivity;
            gameContext.camera.rotation.x -= event.movementY * mouseSensitivity;
            gameContext.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, gameContext.camera.rotation.x));
        } else {
            return;
        }
    }
}

/**
 * Toggles the rifle scope view.
 * Adjusts camera FOV, mouse sensitivity, and visibility of scope/crosshair UI elements.
 * @param {boolean} active - True to activate scope, false to deactivate. If not provided, toggles current state.
 */
function toggleScope(active) {
    if (typeof active === 'boolean') {
        isScoped = active;
    } else {
        isScoped = !isScoped;
    }
    if (isScoped) {
        gameContext.camera.fov = CAMERA_FOV_SCOPED;
        mouseSensitivity = MOUSE_SENSITIVITY_SCOPED;
        gameContext.scopeOverlayElement.style.display = 'block';
    } else {
        gameContext.camera.fov = CAMERA_FOV_NORMAL;
        mouseSensitivity = MOUSE_SENSITIVITY_NORMAL;
        gameContext.scopeOverlayElement.style.display = 'none';
    }
    gameContext.camera.updateProjectionMatrix();
}

function toggleKneel() {
    isKneeling = !isKneeling;
    const height = isKneeling ? PLAYER_KNEEL_HEIGHT : PLAYER_EYE_HEIGHT;
    gameContext.camera.position.set(0, height, 0);
    // Update status indicator
    if (gameContext.ui && typeof gameContext.ui.updateStatusIndicator === 'function') {
        gameContext.ui.updateStatusIndicator(isKneeling);
    } else {
        // Fallback direct update
        const indicator = document.getElementById('status-indicator');
        if (indicator) {
            indicator.textContent = 'Kneeling';
            indicator.style.display = isKneeling ? 'block' : 'none';
        }
    }
}

/**
 * Creates a human track at the current player position.
 * @param {THREE.Vector3} movementDirection - Direction of player movement
 */
function createHumanTrack(movementDirection) {
    // Load texture if not cached
    if (!humanTrackTexture) {
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(
            'assets/textures/human_track.png',
            (texture) => {
                humanTrackTexture = texture;
                // Retry creation now that texture is loaded
                createHumanTrack(movementDirection);
            }
        );
        return; // Exit and wait for load
    }

    const trackMaterial = new THREE.MeshLambertMaterial({
        color: HUMAN_TRACK_CONFIG.trackColor,
        map: humanTrackTexture,
        transparent: true,
        opacity: HUMAN_TRACK_CONFIG.trackOpacityStart,
        side: THREE.DoubleSide, // Ensure material is visible from both sides
        depthTest: true, // Enable depth testing to prevent z-fighting
        depthWrite: true
    });
    
    const trackGeometry = new THREE.PlaneGeometry(HUMAN_TRACK_CONFIG.trackWidth, HUMAN_TRACK_CONFIG.trackLength);
    const track = new THREE.Mesh(trackGeometry, trackMaterial);
    const terrainHeight = gameContext.getHeightAt(gameContext.player.position.x, gameContext.player.position.z);
    // Further increase height offset to ensure visibility above terrain
    track.position.set(gameContext.player.position.x, terrainHeight + 0.1, gameContext.player.position.z);
    const finalY = gameContext.getCachedHeightAt(track.position.x, track.position.z) + 0.1;
    track.position.y = finalY;
    // Align tracks with player's compass heading
    // Use explicit YXZ order to ensure correct orientation
    track.rotation.order = 'YXZ';
    track.rotation.y = gameContext.player.rotation.y;
    track.rotation.x = -Math.PI / 2;
    track.rotation.z = 0; // Rotate 90 degrees CW (PI/2 -> 0) based on user feedback
    
    // Set a higher render order to ensure tracks are rendered on top of other elements
    track.renderOrder = 1;
    humanTracks.push({ mesh: track, creationTime: gameContext.clock.getElapsedTime() });
    if (gameContext.scene) {
        gameContext.scene.add(track);
    }
}

/**
 * Updates human tracks, handling fade-out and cleanup.
 */
function updateHumanTracks() {
    const currentTime = gameContext.clock.getElapsedTime();
    humanTracks = humanTracks.filter(track => {
        const age = currentTime - track.creationTime;
        if (age > HUMAN_TRACK_CONFIG.trackFadeDurationS) {
            gameContext.scene.remove(track.mesh);
            track.mesh.material.dispose();
            return false; // Remove from array
        }
        // Update opacity based on age
        track.mesh.material.opacity = HUMAN_TRACK_CONFIG.trackOpacityStart * (1.0 - (age / HUMAN_TRACK_CONFIG.trackFadeDurationS));
        return true; // Keep in array
    });
}

// Add tree bracing detection
function checkTreeBracing() {
    const playerPosition = gameContext.player.position;
    // Use larger radius for bracing detection to be more forgiving
    const treeCollision = gameContext.checkTreeCollision(playerPosition, 1.5);
    isTreeBraced = !!treeCollision;
}

/**
 * Handles mouse wheel events for player movement (forward/backward).
 * @param {WheelEvent} event - The mouse wheel event.
 */
function onWheel(event) {
    if (!isInputAllowed()) return;
    
    // Removed pointer lock check to allow wheel to work immediately
    
    // Attempt to lock pointer on scroll interaction for better control
    if (document.pointerLockElement !== document.body) {
        document.body.requestPointerLock().catch(() => {
            // Ignore errors if browser blocks the request (e.g. not a user gesture in some contexts)
        });
    }

    // Clear existing timeout to keep moving while scrolling
    if (wheelTimeout) {
        clearTimeout(wheelTimeout);
        wheelTimeout = null;
    }

    // Scroll up (negative deltaY) moves forward, scroll down moves backward
    if (event.deltaY < 0) {
        wheelMoveForward = true;
        wheelMoveBackward = false;
    } else if (event.deltaY > 0) {
        wheelMoveBackward = true;
        wheelMoveForward = false;
    }

    // Stop moving after a short delay when scrolling stops
    wheelTimeout = setTimeout(() => {
        wheelMoveForward = false;
        wheelMoveBackward = false;
        wheelTimeout = null;
    }, 300); // 300ms timeout for smooth movement bursts
}

/**
 * Gets whether the player is currently braced against a tree
 */
export function getIsTreeBraced() {
    return isTreeBraced;
}

/**
 * Gets whether the player is currently kneeling
 */
export function getIsKneeling() {
    return isKneeling;
}

/**
 * Gets the player's current noise level and detection range
 * @returns {{ level: number, range: number, source: string }} Noise level (0-2), detection range in units, and source description
 */
export function getPlayerNoise() {
    if (currentNoiseLevel === 2) {
        return { level: 2, range: SPRINT_NOISE_RANGE, source: 'Sprinting' };
    } else if (currentNoiseLevel === 1) {
        return { level: 1, range: FOLIAGE_NOISE_RANGE, source: 'Walking through brush' };
    }
    return { level: 0, range: 0, source: 'Silent' };
}
