import * as THREE from 'three';
import { gameContext } from './context.js';
import { MOUSE_SENSITIVITY as MOUSE_SENSITIVITY_NORMAL } from './constants.js';

// --- Player Module Constants ---
const PLAYER_EYE_HEIGHT = 6.0; // Player camera height relative to player group's origin
const INITIAL_PLAYER_X = 0;
const INITIAL_PLAYER_Z = 10;
const PLAYER_MOVE_SPEED = 5.0;
const MOUSE_SENSITIVITY_SCOPED = 0.0005; // Restored to normal scoped sensitivity
const CAMERA_FOV_NORMAL = 60; // Reduced from 75 for a more natural perspective
const CAMERA_FOV_SCOPED = 15;

// Scope sway parameters for realistic breathing/nerves effect
const SCOPE_SWAY_AMPLITUDE = 0.0002; // Reduced by another 50% from 0.0004 for very subtle movement
const SCOPE_SWAY_FREQUENCY = 0.8; // Breathing frequency (cycles per second)
const SCOPE_SWAY_NOISE_AMPLITUDE = 0.000075; // Reduced by another 50% from 0.00015 for minimal tremor
const SCOPE_SWAY_NOISE_FREQUENCY = 4.0; // Tremor frequency

// --- Local state for player module ---
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let isScoped = false;
let mouseSensitivity = MOUSE_SENSITIVITY_NORMAL; // Initialized with normal sensitivity
let scopeSwayTime = 0; // Time accumulator for scope sway animation

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
        gameContext.player.position.add(velocity);
    }

    // Update player height based on terrain
    const newHeight = gameContext.getHeightAt(gameContext.player.position.x, gameContext.player.position.z);
    gameContext.player.position.y = newHeight;

    // Track distance traveled
    if (gameContext.lastPlayerPosition.distanceTo(gameContext.player.position) > 0) {
        gameContext.distanceTraveled += gameContext.lastPlayerPosition.distanceTo(gameContext.player.position);
        gameContext.lastPlayerPosition.copy(gameContext.player.position);
    }

    // Update scope sway animation
    if (isScoped) {
        scopeSwayTime += delta;
        const swayX = Math.sin(scopeSwayTime * SCOPE_SWAY_FREQUENCY) * SCOPE_SWAY_AMPLITUDE;
        const swayY = Math.sin(scopeSwayTime * SCOPE_SWAY_FREQUENCY + Math.PI / 2) * SCOPE_SWAY_AMPLITUDE;
        const noiseX = Math.random() * SCOPE_SWAY_NOISE_AMPLITUDE;
        const noiseY = Math.random() * SCOPE_SWAY_NOISE_AMPLITUDE;
        gameContext.camera.rotation.x += swayY + noiseY;
        gameContext.camera.rotation.y += swayX + noiseX;
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
