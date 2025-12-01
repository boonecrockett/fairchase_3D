// js/context.js

/**
 * @typedef {object} GameContext
 * @property {THREE.Scene} scene - The main Three.js scene.
 * @property {THREE.PerspectiveCamera} camera - The player's camera.
 * @property {THREE.WebGLRenderer} renderer - The Three.js renderer.
 * @property {THREE.Raycaster} raycaster - Raycaster for intersections.
 * @property {THREE.Clock} clock - Clock for managing delta time.
 * @property {number} deltaTime - Time elapsed since the last frame.
 * @property {THREE.Mesh} player - The player object/mesh.
 * @property {THREE.Group} deer - The deer object/group.
 * @property {THREE.Mesh} terrain - The terrain mesh.
 * @property {THREE.Mesh[]} waterBodies - Array of water body meshes.
 * @property {THREE.Vector3[]} drinkingSpots - Array of deer drinking spot coordinates.
 * @property {THREE.Group} trees - Group containing all tree meshes.
 * @property {THREE.Mesh[]} tracks - Array of deer track meshes.
 * @property {THREE.Mesh[]} bloodDrops - Array of blood drop meshes.
 * @property {number} gameTime - Current in-game time (0-24 hours).
 * @property {number} gameSpeed - Game speed multiplier.
 * @property {boolean} isSleeping - Flag indicating if the sleep sequence is active.
 * @property {number} score - Player's current score.
 * @property {number} distanceTraveled - Total distance traveled by the player.
 * @property {THREE.Vector3} lastPlayerPosition - Player's position in the previous frame.
 * @property {boolean} canTag - Flag indicating if the player can tag a downed deer.
 * @property {object} killInfo - Information about the last kill (distance, moving, etc.).
 * @property {object} dailyKillInfo - Information about the kill for the current day's report.
 * @property {object} huntLog - Stores details of the current hunt for the report.
 * @property {Array<object>} reportEntries - Array of all hunt log entries.
 * @property {string} deerState - Current state of the deer AI (IDLE, FLEEING, etc.).
 * @property {number} timeSinceLastDrink - Time elapsed since the deer last drank.
 * @property {number} stateTimer - Timer for various AI states.
 * @property {THREE.Vector3} wanderTarget - Current wander target for the deer.
 * @property {THREE.Vector3} lastTrackPosition - Position where the last deer track was placed.
 * @property {THREE.Vector3} lastBloodDropPosition - Position where the last blood drop was placed.
 * @property {number} mapUsageCount - Track smartphone map usage for battery system.
 * @property {number} maxMapUsage - Maximum map uses per day.
 * @property {HTMLElement} timeValueElement - UI element for displaying game time.
 * @property {HTMLElement} scoreValueElement - UI element for displaying score.
 * @property {HTMLElement} compassElement - UI element for displaying compass heading.
 * @property {HTMLElement} interactionPromptElement - UI element for interaction prompts.
 * @property {HTMLElement} messageElement - UI element for displaying messages.
 * @property {HTMLElement} sleepOverlay - UI overlay for the sleep sequence.
 * @property {HTMLElement} sleepTimerElement - UI element for the sleep timer (not currently used).
 * @property {HTMLElement} mainMenu - The main menu container element.
 * @property {HTMLElement} worldSelect - The dropdown for world selection.
 * @property {string} gameMode - The selected game mode ('practice' or 'simulator').
 * @property {HTMLElement} scopeOverlayElement - UI overlay for the rifle scope.
 * @property {HTMLElement} crosshairElement - UI element for the crosshair.
 * @property {HTMLElement} reportModalBackdrop - Modal backdrop for reports.
 * @property {HTMLElement} reportModal - Modal element for reports.
 * @property {HTMLElement} reportTitle - Title element for reports.
 * @property {HTMLElement} reportContent - Content element for reports.
 * @property {HTMLElement} closeReportButton - Button to close the report modal.
 * @property {HTMLElement} reportButton - Button to open the report.
 * @property {HTMLElement} mapModalBackdrop - Modal backdrop for the map.
 * @property {HTMLElement} mapModal - Modal element for the map.
 * @property {HTMLElement} closeMapButton - Button to close the map modal.
 * @property {HTMLElement} endOfDayModalBackdrop - Modal backdrop for end-of-day report.
 * @property {HTMLElement} endOfDayModal - Modal element for end-of-day report.
 * @property {HTMLElement} endOfDayTitle - Title element for end-of-day report.
 * @property {HTMLElement} endOfDayContent - Content element for end-of-day report.
 * @property {HTMLElement} continueToNextDayButton - Button to continue to next day.
 * @property {HTMLElement} mapCanvas - The canvas element for the map.
 * @property {Function} init - Initializes a game world with a given configuration.
 * @property {Function} animate - The main animation loop.
 * @property {Function} getHeightAt - Gets terrain height at specified coordinates.
 * @property {Function} isWaterAt - Checks if there is water at the player's position.
 * @property {Function} shoot - Handles the shooting mechanic.
 * @property {Function} tagDeer - Handles tagging a downed deer.
 * @property {Function} startSleepSequence - Initiates the end-of-day sleep sequence.
 * @property {Function} isNight - Checks if it's currently night time.
 * @property {Function} handleEndOfDay - Processes end-of-day logic (scoring, report).
 * @property {Function} checkTreeCollision - Checks for collisions with trees.
 * @property {Function} checkBushCollision - Checks for collisions with bushes.
 * @property {Function} isFoliageAt - Checks if a position is within foliage for sound effects.
 */

// The one and only game context object, shared across all modules.
import * as THREE from 'three';

export const gameContext = {
    // Scene essentials
    scene: null,
    camera: null,
    renderer: null,
    raycaster: new THREE.Raycaster(),
    clock: new THREE.Clock(),
    deltaTime: 0,

    // Raycaster optimization system
    raycasterPool: {
        terrain: new THREE.Raycaster(), // For height queries
        effects: new THREE.Raycaster(), // For tracks, blood drops, grass
        visibility: new THREE.Raycaster(), // For line-of-sight checks
        available: [] // Pool of additional raycasters if needed
    },
    
    // Height query caching system
    heightCache: new Map(),
    heightCacheMaxSize: 1000,
    heightCacheGridSize: 2.0, // Cache resolution in world units

    // Game objects
    player: null,
    deer: null,
    terrain: null,
    waterBodies: [],
    drinkingSpots: [],
    trees: null,
    grass: null,
    grassClusterPositions: null,
    tracks: [],
    bloodDrops: [],

    // Game state
    gameTime: 4.5, // Start at 4:30 AM (30 minutes before legal hunting hours)
    currentDay: 1, // Current day number
    eveningCrossfadeTriggered: false, // Track whether evening ambiance crossfade has occurred
    morningCrossfadeTriggered: false, // Track whether morning ambiance crossfade has occurred
    gameSpeed: 1,
    score: 100,
    distanceTraveled: 0,
    lastPlayerPosition: new THREE.Vector3(),
    canTag: false,
    killInfo: null,
    dailyKillInfo: null,
    huntLog: {},
    reportEntries: [],
    shotLog: [], // Track all shots taken with distance and hit type
    currentDayEvents: [],
    currentDayStats: {
        distanceTraveled: 0,
        timeStarted: null,
        deerSightings: 0,
        shotsTaken: 0,
        hits: 0,
        misses: 0,
        deerKilled: false,
        deerTagged: false,
        mapChecks: 0,
        batteryUsed: 0,
        trackingDistance: 0, // Distance traveled while tracking wounded deer
        isTracking: false // Flag to track if currently tracking wounded deer
    },
    deerState: 'IDLE',
    timeSinceLastDrink: 0,
    stateTimer: 0,
    wanderTarget: new THREE.Vector3(),
    lastTrackPosition: new THREE.Vector3(),
    lastBloodDropPosition: new THREE.Vector3(),
    mapUsageCount: 0, // Track smartphone map usage for battery system
    maxMapUsage: 10,  // Maximum map uses per day
    isSleeping: false,
    deerSighted: false, // Flag to prevent duplicate sighting logs

    // UI Elements - to be populated on DOMContentLoaded
    timeValueElement: null,
    scoreValueElement: null,
    compassElement: null,
    interactionPromptElement: null,
    messageElement: null,
    sleepOverlay: null,
    sleepTimerElement: null,
    mainMenu: null,
    worldSelect: null,
    gameMode: 'simulator', // Default to simulator mode
    gameStartedAndReady: false, // Flag to prevent auto pointer lock on game start
    scopeOverlayElement: null,
    crosshairElement: null,
    reportModalBackdrop: null,
    reportModal: null,
    reportTitle: null,
    reportContent: null,
    closeReportButton: null,
    reportButton: null,
    mapModalBackdrop: null,
    mapModal: null,
    closeMapButton: null,
    endOfDayModalBackdrop: null,
    endOfDayModal: null,
    endOfDayTitle: null,
    endOfDayContent: null,
    continueToNextDayButton: null,
    mapCanvas: null,

    // Bound functions
    init: null,
    animate: null,
    getHeightAt: null,
    isWaterAt: null,
    shoot: null,
    tagDeer: null,
    startSleepSequence: null,
    isNight: null,
    handleEndOfDay: null,
    checkTreeCollision: null,
    checkBushCollision: null,
    isFoliageAt: null,

    // Raycaster optimization helper functions
    getTerrainRaycaster() {
        return this.raycasterPool.terrain;
    },
    
    getEffectsRaycaster() {
        return this.raycasterPool.effects;
    },
    
    getVisibilityRaycaster() {
        return this.raycasterPool.visibility;
    },
    
    // Optimized height query with caching
    getCachedHeightAt(x, z) {
        // Create cache key based on grid position
        const gridX = Math.round(x / this.heightCacheGridSize) * this.heightCacheGridSize;
        const gridZ = Math.round(z / this.heightCacheGridSize) * this.heightCacheGridSize;
        const cacheKey = `${gridX},${gridZ}`;
        
        // Check cache first
        if (this.heightCache.has(cacheKey)) {
            return this.heightCache.get(cacheKey);
        }
        
        // Perform raycast if not cached
        if (!this.terrain) return 0;
        
        const terrainRaycaster = this.getTerrainRaycaster();
        terrainRaycaster.set(new THREE.Vector3(gridX, 1000, gridZ), new THREE.Vector3(0, -1, 0));
        const intersects = terrainRaycaster.intersectObject(this.terrain);
        const height = intersects.length > 0 ? intersects[0].point.y : 0;
        
        // Cache the result
        if (this.heightCache.size >= this.heightCacheMaxSize) {
            // Remove oldest entry when cache is full
            const firstKey = this.heightCache.keys().next().value;
            this.heightCache.delete(firstKey);
        }
        this.heightCache.set(cacheKey, height);
        
        return height;
    },
    
    // Clear height cache (useful when terrain changes)
    clearHeightCache() {
        this.heightCache.clear();
    }
};
