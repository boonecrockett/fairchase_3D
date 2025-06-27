import * as THREE from 'three';
import { gameContext } from './context.js';
import { MOUSE_SENSITIVITY as MOUSE_SENSITIVITY_NORMAL } from './constants.js';
import { startWalkSound, stopWalkSound, startWaterWalkSound, stopWaterWalkSound, startFoliageWalkSound, stopFoliageWalkSound } from './audio.js';
import { showSmartphoneMap } from './map.js';
import { updateSpatialAudioListener } from './spatial-audio.js';

// --- Player Module Constants ---
const PLAYER_EYE_HEIGHT = 6.0; // Player camera height relative to player group's origin
const INITIAL_PLAYER_X = 0;
const INITIAL_PLAYER_Z = 10;
const PLAYER_MOVE_SPEED = 6.05; // Increased by another 10% from 5.5 to 6.05
const MOUSE_SENSITIVITY_SCOPED = 0.0005; // Restored to normal scoped sensitivity
const CAMERA_FOV_NORMAL = 60; // Reduced from 75 for a more natural perspective
const CAMERA_FOV_SCOPED = 15;

// Scope sway parameters for realistic breathing/nerves effect
const SCOPE_SWAY_FREQUENCY = 2.5; // Breathing rate frequency
const SCOPE_SWAY_AMPLITUDE = 0.0004; // Increased for more natural movement
const SCOPE_SWAY_NOISE_AMPLITUDE = 0.0005; // Increased for more natural tremor
const SCOPE_SWAY_NOISE_FREQUENCY = 6.0; // Increased from 4.0 for more varied tremor
const TREE_BRACE_REDUCTION = 0.08; // When braced against tree, reduce sway to 8% (very steady but with subtle natural motion)

// --- HUMAN TRACKING CONSTANTS ---
const HUMAN_TRACK_CONFIG = {
    trackColor: 0x000000, // Black color for human tracks
    trackShapeRadius: 0.7776, // Reduced by 10% from 0.864 for better proportions
    trackOpacityStart: 0.5, // 50% opacity
    trackFadeDurationS: 4500, // Same as deer tracks
    trackCreationDistanceThreshold: 1.5, // Create tracks every 1.5 units of movement
};

// --- Local state for player module ---
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let isScoped = false;
let mouseSensitivity = MOUSE_SENSITIVITY_NORMAL; // Initialized with normal sensitivity
let scopeSwayTime = 0; // Time accumulator for scope sway animation
let lastTrackCreationPosition = null;
let humanTracks = []; // Array to store human track objects
let isWalking = false;
let isTreeBraced = false;
let isWalkingOnWater = false;
let isWalkingOnFoliage = false;

// --- EXPORTED FUNCTIONS ---

/**
 * Creates the player object, sets its initial position, and adds it to the scene.
 * The player is a THREE.Group containing the camera.
 */
export function createPlayer() {
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
    document.addEventListener('keydown', onKeyDown, false);
    document.addEventListener('keyup', onKeyUp, false);
    document.addEventListener('mousemove', onMouseMove, false);
    document.addEventListener('mousedown', onMouseDown, false);
    document.addEventListener('mouseup', onMouseUp, false);
}

/**
 * Updates the player's position and state based on input and game logic.
 * Handles movement, terrain height adjustment, and distance tracking.
 */
export function updatePlayer() {
    const delta = gameContext.deltaTime;
    const velocity = new THREE.Vector3();

    if (moveForward) velocity.z -= 1;
    if (moveBackward) velocity.z += 1;
    if (moveLeft) velocity.x -= 1;
    if (moveRight) velocity.x += 1;

    // Apply rotation to velocity vector
    velocity.applyQuaternion(gameContext.player.quaternion);
    velocity.normalize().multiplyScalar(PLAYER_MOVE_SPEED * delta);

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
        
        gameContext.distanceTraveled += velocity.length();
        
        // Calculate player velocity for spatial audio Doppler effects
        gameContext.player.velocity = gameContext.player.position.clone().sub(previousPosition).divideScalar(delta);
        
        updateSpatialAudioListener(gameContext.player.position, gameContext.player.velocity);
    }

    // Update player height based on terrain
    const newHeight = gameContext.getHeightAt(gameContext.player.position.x, gameContext.player.position.z);
    gameContext.player.position.y = newHeight;

    // Check if player is walking on water (only when moving)
    const isOnWater = velocity.lengthSq() > 0 ? gameContext.isWaterAt(gameContext.player.position.x, gameContext.player.position.z) : isWalkingOnWater;
    const isOnFoliage = velocity.lengthSq() > 0 ? gameContext.isFoliageAt(gameContext.player.position.x, gameContext.player.position.z) : isWalkingOnFoliage;
    
    // Handle water state transitions
    if (isOnWater !== isWalkingOnWater) {
        console.log(`DEBUG: Water state changed from ${isWalkingOnWater} to ${isOnWater}`);
        // Stop current sounds when transitioning
        if (isWalking) {
            if (isWalkingOnWater) {
                stopWaterWalkSound();
            } else {
                stopWalkSound();
            }
        }
        isWalkingOnWater = isOnWater;
    }

    // Handle foliage state transitions
    if (isOnFoliage !== isWalkingOnFoliage) {
        isWalkingOnFoliage = isOnFoliage;
        
        // If player is walking, switch to appropriate sound immediately
        if (isWalking) {
            if (isOnFoliage) {
                // Entering foliage - start foliage sound, stop regular walk sound
                startFoliageWalkSound();
                stopWalkSound();
            } else {
                // Leaving foliage - start regular walk sound, stop foliage sound
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
        if (!lastTrackCreationPosition || 
            gameContext.player.position.distanceTo(lastTrackCreationPosition) >= HUMAN_TRACK_CONFIG.trackCreationDistanceThreshold) {
            createHumanTrack();
            lastTrackCreationPosition = gameContext.player.position.clone();
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
        
        // Apply tree bracing reduction
        if (isTreeBraced) {
            swayX *= TREE_BRACE_REDUCTION;
            swayY *= TREE_BRACE_REDUCTION;
            noiseX *= TREE_BRACE_REDUCTION;
            noiseY *= TREE_BRACE_REDUCTION;
            randomShiftX *= TREE_BRACE_REDUCTION;
            randomShiftY *= TREE_BRACE_REDUCTION;
            microAdjustX *= TREE_BRACE_REDUCTION;
            microAdjustY *= TREE_BRACE_REDUCTION;
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
    // Ignore clicks on UI elements to prevent pointer lock
    if (event.target.tagName === 'BUTTON' || event.target.closest('.modal')) {
        return;
    }

    if (document.pointerLockElement !== document.body) {
        document.body.requestPointerLock();
    } else {
        if (event.button === 0) { // Left click
            gameContext.shoot();
        } else if (event.button === 2) { // Right click
            toggleScope(true);
        }
    }
}

/**
 * Handles mouse up events, specifically for unscoping the rifle.
 * @param {MouseEvent} event - The mouse event.
 */
function onMouseUp(event) {
    if (event.button === 2) { // Right click
        toggleScope(false);
    }
}

/**
 * Handles key down events for player movement and interaction (tagging deer).
 * @param {KeyboardEvent} event - The keyboard event.
 */
function onKeyDown(event) {
    switch (event.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyD': moveRight = true; break;
        case 'KeyE': if (gameContext.canTag) gameContext.tagDeer(); break;
        case 'KeyM': showSmartphoneMap(); break; // Open smartphone-style map
    }
}

/**
 * Handles key up events to stop player movement.
 * @param {KeyboardEvent} event - The keyboard event.
 */
function onKeyUp(event) {
    switch (event.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyA': moveLeft = false; break;
        case 'KeyD': moveRight = false; break;
    }
}

/**
 * Handles mouse move events for player look controls (camera rotation).
 * Only active when pointer lock is engaged.
 * @param {MouseEvent} event - The mouse event.
 */
function onMouseMove(event) {
    if (document.pointerLockElement === document.body) {
        gameContext.player.rotation.y -= event.movementX * mouseSensitivity;
        gameContext.camera.rotation.x -= event.movementY * mouseSensitivity;
        gameContext.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, gameContext.camera.rotation.x));
    }
}

/**
 * Toggles the rifle scope view.
 * Adjusts camera FOV, mouse sensitivity, and visibility of scope/crosshair UI elements.
 * @param {boolean} active - True to activate scope, false to deactivate.
 */
function toggleScope(active) {
    isScoped = active;
    if (isScoped) {
        gameContext.camera.fov = CAMERA_FOV_SCOPED;
        mouseSensitivity = MOUSE_SENSITIVITY_SCOPED;
        gameContext.scopeOverlayElement.style.display = 'block';
        gameContext.crosshairElement.style.display = 'none';
    } else {
        gameContext.camera.fov = CAMERA_FOV_NORMAL;
        mouseSensitivity = MOUSE_SENSITIVITY_NORMAL;
        gameContext.scopeOverlayElement.style.display = 'none';
        gameContext.crosshairElement.style.display = 'block';
    }
    gameContext.camera.updateProjectionMatrix();
}

/**
 * Creates a human track at the current player position.
 */
function createHumanTrack() {
    // Initialize material and geometry for this track
    const textureLoader = new THREE.TextureLoader();
    
    // Create material with fallback color
    const trackMaterial = new THREE.MeshLambertMaterial({
        color: HUMAN_TRACK_CONFIG.trackColor,
        transparent: true,
        opacity: HUMAN_TRACK_CONFIG.trackOpacityStart
    });
    
    // Try to load texture
    textureLoader.load(
        'assets/textures/human_track.png',
        (texture) => {
            // Success: update material with texture
            trackMaterial.map = texture;
            trackMaterial.needsUpdate = true;
        },
        undefined,
        (error) => {
            // Error: keep using color-based fallback
        }
    );

    const trackGeometry = new THREE.PlaneGeometry(HUMAN_TRACK_CONFIG.trackShapeRadius * 2, HUMAN_TRACK_CONFIG.trackShapeRadius * 2);
    const track = new THREE.Mesh(trackGeometry, trackMaterial);

    track.position.copy(gameContext.player.position);
    
    // Use optimized cached height detection for better performance
    const finalY = gameContext.getCachedHeightAt(track.position.x, track.position.z) + 0.015;
    
    track.position.y = finalY;
    
    track.rotation.x = -Math.PI / 2; // Lay flat on ground
    
    // Orient track to player's facing direction
    track.rotation.z = gameContext.player.rotation.y;
    
    humanTracks.push({ mesh: track, creationTime: gameContext.clock.getElapsedTime() });
    
    // Ensure scene exists before adding
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
 * Gets whether the player is currently braced against a tree
 */
export function getIsTreeBraced() {
    return isTreeBraced;
}
