import * as THREE from 'three';
import { setupScene, updateShadowCamera, updateSkySun, applyQualityToRenderer } from './scene.js?v=ground-4';
import { createHills, createWater, findDrinkingSpots, createTrees, createBushes, createGrass, updateWater, isWaterAt } from './world.js?v=ground-4';
import { createTrails } from './trails.js?v=trail-splat-4';
import { invalidateMapCache } from './map.js?v=ground-4';
import { createPlayer, addPlayerEventListeners, updatePlayer, getIsTreeBraced } from './player.js?v=ground-4';
import { deer } from './deer.js?v=ground-4';
import { initUI, showMessage, updateInteraction, updateCompass, ensureMainMenuHidden } from './ui.js?v=ground-4';
import { initAudio, playRifleSound, updateAmbianceForTime } from './audio.js';
import { logEvent, initializeDayReport, updateDistanceTraveled } from './report-logger.js';
import { gameContext } from './context.js';
import { collisionSystem } from './collision.js?v=ground-4'; 
import {
    GAME_TIME_SPEED_MULTIPLIER,
    HOURS_IN_DAY,
    NIGHT_START_HOUR,
    DAWN_START_HOUR,
    SLEEP_SEQUENCE_DELAY_MS,
    SLEEP_SEQUENCE_MAIN_DURATION_MS,
    SLEEP_FADE_OUT_DURATION_MS
} from './constants.js';
import { updateSpatialAudioListener } from './spatial-audio.js';
import { shoot, tagDeer } from './hunting-mechanics.js?v=ground-4';
import { updateTimeDisplay, updateDynamicLighting, isNight } from './environment-manager.js?v=ground-4';
import { showLoadingModal, hideLoadingModal, registerTask, completeTask, updateLoadingStatus, initLoadingManager } from './loading-manager.js';
import { initScreenshotListener } from './screenshot.js?v=ground-4';
import { animationCalibrator } from './animation-calibrator.js';
import { getQualitySettings } from './quality-settings.js';

const MAX_DELTA = 1 / 15;
let animationFrameId = null;
let documentHidden = false;

function disposeObject3D(object) {
    if (!object) return;
    object.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of materials) {
                if (!mat) continue;
                for (const key of Object.keys(mat)) {
                    const value = mat[key];
                    if (value && value.isTexture) value.dispose();
                }
                mat.dispose();
            }
        }
    });
}

function clearSceneContents() {
    if (!gameContext.scene) return;
    const toRemove = [...gameContext.scene.children];
    for (const child of toRemove) {
        gameContext.scene.remove(child);
        disposeObject3D(child);
    }
    gameContext.treeInstancedMeshes = [];
    gameContext.bushInstancedMeshes = [];
    gameContext.treeHash = null;
    gameContext.bushHash = null;
    gameContext.grassHash = null;
    gameContext.grass = null;
    gameContext.shaderGrass = null;
    gameContext.sky = null;
    gameContext.heightmap = null;
    gameContext.trails = null;
    invalidateMapCache();
    gameContext.clearHeightCache?.();
}
function togglePause() {
    gameContext.isPaused = !gameContext.isPaused;
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.style.display = gameContext.isPaused ? '' : 'none';
    if (!gameContext.isPaused) {
        gameContext.clock.update();
    }
}

// Make calibrator available globally immediately
window.animationCalibrator = animationCalibrator;

function isNearHashedFoliage(hash, x, z, pad) {
    if (!hash || !hash.entries.length) return false;
    const candidates = hash.query(x, z, 16);
    for (let i = 0; i < candidates.length; i++) {
        const entry = candidates[i];
        const reach = (entry.foliageRadius || entry.radius || 1) + pad;
        const dx = x - entry.x;
        const dz = z - entry.z;
        if (dx * dx + dz * dz < reach * reach) return true;
    }
    return false;
}

// Initialize game
function init() {
    // Attach collision helpers to gameContext for global access
    gameContext.checkTreeCollision = collisionSystem.checkTreeCollision.bind(collisionSystem);
    gameContext.checkBushCollision = collisionSystem.checkBushCollision.bind(collisionSystem);
    
    // Attach tagDeer to gameContext for UI button access
    gameContext.tagDeer = tagDeer;
    
    // Cache for foliage check to avoid expensive per-frame calculations
    let lastFoliageCheck = { x: 0, z: 0, result: false, time: 0 };
    const FOLIAGE_CHECK_INTERVAL = 0.05; // Check every 50ms for responsive sound
    const FOLIAGE_CHECK_DISTANCE = 0.3; // Recheck if moved more than 0.3 units (more precise)

    gameContext.isFoliageAt = (x, z) => {
        const now = performance.now() / 1000;
        const dx = x - lastFoliageCheck.x;
        const dz = z - lastFoliageCheck.z;
        const movedDistSq = dx * dx + dz * dz;
        
        // Return cached result if we haven't moved much and checked recently
        if (movedDistSq < FOLIAGE_CHECK_DISTANCE * FOLIAGE_CHECK_DISTANCE && 
            now - lastFoliageCheck.time < FOLIAGE_CHECK_INTERVAL) {
            return lastFoliageCheck.result;
        }

        const inBush = isNearHashedFoliage(gameContext.bushHash, x, z, 0.6);
        const inGrass = isNearHashedFoliage(gameContext.grassHash, x, z, 0.5);
        const result = inBush || inGrass;
        
        // Update cache (avoid creating new object - reuse properties)
        lastFoliageCheck.x = x;
        lastFoliageCheck.z = z;
        lastFoliageCheck.result = result;
        lastFoliageCheck.time = now;
        return result;
    };
    
    // Attach isWaterAt helper for player interaction
    gameContext.isWaterAt = isWaterAt;

    gameContext.raycaster = collisionSystem.raycaster;
    gameContext.collisionSystem = collisionSystem;
    
    // Read initial hitbox visibility from debug checkbox
    const showHitboxesCheckbox = document.getElementById('show-hitboxes');
    if (showHitboxesCheckbox && showHitboxesCheckbox.checked) {
        collisionSystem.debugMode = true;
        collisionSystem.updateHitboxVisibility();
    }

    // Expose context functions early so UI can start a hunt even if later setup throws
    gameContext.init = startGame;
    gameContext.animate = animate;

    // Setup scene (lights, sky, fog)
    setupScene();

    // Initialize UI
    initUI();

    // Expose functions for UI interaction
    window.startGame = startGame;
    window.fireWeapon = shoot; // Use extracted shoot function
    window.tagAnimal = tagDeer; // Use extracted tagDeer function
    
    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);
    
    // Add visibility change listener to pause rendering when tab is hidden
    document.addEventListener('visibilitychange', () => {
        documentHidden = document.hidden;
        if (!document.hidden && gameContext.clock) {
            gameContext.clock.update();
        }
    });
}

async function startGame(selectedWorldId) {
    console.log('Starting game with world:', selectedWorldId);
    
    try {
        // Initialize and show loading modal
        initLoadingManager();
        showLoadingModal();
        
        // Register all loading tasks
        registerTask('terrain', 'Terrain');
        registerTask('water', 'Water');
        registerTask('trails', 'Game Trails');
        registerTask('trees', 'Trees');
        registerTask('bushes', 'Bushes');
        registerTask('grass', 'Grass');
        registerTask('deer', 'Deer');
        
        // Hide main menu
        ensureMainMenuHidden();
        
        // Import world presets dynamically
        updateLoadingStatus('Loading world configuration...');
        const { worldPresets } = await import('./world-presets.js');
        
        let worldConfig;
        if (typeof selectedWorldId === 'string') {
            worldConfig = worldPresets[selectedWorldId] || worldPresets['Hardwood Forest'];
        } else if (selectedWorldId && typeof selectedWorldId === 'object' && !Array.isArray(selectedWorldId)) {
            worldConfig = selectedWorldId;
            gameContext.worldId = 'custom';
        }

        if (!worldConfig) {
            console.warn('⚠️ START GAME: World config missing, using default');
            worldConfig = worldPresets['Hardwood Forest'];
            gameContext.worldId = 'Hardwood Forest';
        }

        gameContext.worldConfig = worldConfig;
        if (typeof selectedWorldId === 'string') {
            gameContext.worldId = selectedWorldId;
        }
        
        // Clear existing scene elements if any (for restart) — dispose GPU resources
        clearSceneContents();
        
        // Re-setup basic scene elements
        setupScene();
        applyQualityToRenderer(getQualitySettings());
        // 1. Generate Terrain (synchronous)
        updateLoadingStatus('Generating terrain...');
        createHills(worldConfig);
        completeTask('terrain');
        
        // 2. Add Water (synchronous)
        updateLoadingStatus('Creating water...');
        createWater(worldConfig);
        findDrinkingSpots();
        completeTask('water');
        
        // 3. Vegetation first so trails can skirt trees and sit on top of grass
        updateLoadingStatus('Loading vegetation...');
        
        // Create promises for async vegetation loading
        const treesPromise = createTrees(worldConfig).then(() => completeTask('trees'));
        const bushesPromise = createBushes(worldConfig).then(() => completeTask('bushes'));
        const grassPromise = createGrass(worldConfig).then(() => completeTask('grass'));
        
        // 5. Create Player (synchronous)
        createPlayer(gameContext.camera, gameContext.scene);
        addPlayerEventListeners();
        
        // 5b. Initialize Screenshot System & Pause key
        initScreenshotListener();
        document.addEventListener('keydown', (event) => {
            if (event.code === 'KeyP' && !event.repeat
                && event.target.tagName !== 'INPUT'
                && event.target.tagName !== 'TEXTAREA') {
                event.preventDefault();
                togglePause();
            }
        });
        
        // 6. Initialize Audio
        initAudio();
        
        // 7. Finalize Setup
        gameContext.gameTime = 6.0; // Start at 6 AM
        gameContext.score = 0;
        gameContext.distanceTraveled = 0;
        gameContext.isSleeping = false;
        gameContext.dayCount = 1;
        gameContext.huntLog = {};
        gameContext.shotLog = [];
        gameContext.reportEntries = [];
        
        // 8. Instantiate Deer (async - model needs to load)
        updateLoadingStatus('Loading deer...');
        if (deer && typeof deer.init === 'function') {
            deer.init();
        } else if (typeof deer === 'function') {
            new deer();
        } else if (deer) {
            if (deer.respawn) deer.respawn();
        }
        
        // Wait for deer model to load with timeout to prevent infinite hang
        const DEER_LOAD_TIMEOUT = 15000; // 15 second timeout
        const deerLoadPromise = new Promise((resolve) => {
            const startTime = Date.now();
            const checkDeerLoaded = () => {
                if (gameContext.deer && gameContext.deer.isModelLoaded) {
                    completeTask('deer');
                    resolve();
                } else if (Date.now() - startTime > DEER_LOAD_TIMEOUT) {
                    console.warn('⚠️ Deer model load timeout - continuing without deer');
                    completeTask('deer'); // Mark complete to prevent UI hang
                    resolve();
                } else {
                    setTimeout(checkDeerLoaded, 100);
                }
            };
            checkDeerLoaded();
        });
        
        // Wait for all async assets to load with global timeout
        const ASSET_LOAD_TIMEOUT = 30000; // 30 second global timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Asset loading timeout')), ASSET_LOAD_TIMEOUT);
        });
        
        try {
            await Promise.race([
                Promise.all([treesPromise, bushesPromise, grassPromise, deerLoadPromise]),
                timeoutPromise
            ]);
        } catch (timeoutError) {
            console.warn('⚠️ Asset loading timeout - continuing with available assets');
            // Force complete any remaining tasks to hide loading modal
            completeTask('trees');
            completeTask('bushes');
            completeTask('grass');
            completeTask('deer');
        }
        
        updateLoadingStatus('Creating game trails...');
        createTrails(worldConfig);
        completeTask('trails');
        if (gameContext.gameMode === 'practice' && gameContext.deer && gameContext.deer.config) {
            gameContext.deer.config.alertDistanceThreshold = 80;
            gameContext.deer.config.fleeDistanceThreshold = 40;
        }
        
        // Update UI
        if (gameContext.scoreValueElement) gameContext.scoreValueElement.textContent = 0;
        
        // Pre-compile all shaders to avoid first-frame stutter
        // This forces WebGL to compile shaders before gameplay starts
        updateLoadingStatus('Compiling shaders...');
        if (gameContext.renderer && gameContext.scene && gameContext.camera) {
            gameContext.renderer.compile(gameContext.scene, gameContext.camera);
            
            // Warm-up renders from multiple angles to compile all visible shaders
            // This prevents the first look-around stutter
            const originalRotationY = gameContext.player.rotation.y;
            const originalRotationX = gameContext.camera.rotation.x;
            
            // Render from 8 different horizontal angles + up/down
            for (let i = 0; i < 8; i++) {
                gameContext.player.rotation.y = (i / 8) * Math.PI * 2;
                gameContext.renderer.render(gameContext.scene, gameContext.camera);
            }
            // Look up and down
            gameContext.player.rotation.y = originalRotationY;
            gameContext.camera.rotation.x = -0.5;
            gameContext.renderer.render(gameContext.scene, gameContext.camera);
            gameContext.camera.rotation.x = 0.5;
            gameContext.renderer.render(gameContext.scene, gameContext.camera);
            
            // Restore original orientation
            gameContext.camera.rotation.x = originalRotationX;
        }
        
        // Initial log
        initializeDayReport();
        const worldName = worldConfig && worldConfig.name ? worldConfig.name : "Wilderness";
        logEvent("Hunt Started", `Started hunt in ${worldName}`);
        console.log('✅ START GAME: All assets loaded, shaders compiled, game ready');
        
    } catch (error) {
        console.error('🛑 FATAL ERROR in startGame:', error);
        hideLoadingModal();
        throw error;
    }
}

function animate() {
    animationFrameId = requestAnimationFrame(animate);

    if (documentHidden) {
        return;
    }

    if (gameContext.isPaused) {
        // Skip GPU work while paused; HUD overlay is enough
        return;
    }

    gameContext.clock.update();
    let delta = gameContext.clock.getDelta();
    if (delta > MAX_DELTA) delta = MAX_DELTA;
    gameContext.deltaTime = delta;

    // Update game time
    if (!gameContext.isSleeping) {
        gameContext.gameTime += delta * GAME_TIME_SPEED_MULTIPLIER;
        if (gameContext.gameTime >= HOURS_IN_DAY) {
            gameContext.gameTime = 0;
            gameContext.dayCount++;
        }
    }

    // Core updates
    updateTimeDisplay();
    updateDynamicLighting();
    updateSkySun();
    updatePlayer();
    updateInteraction();
    updateCompass();
    
    // Update Deer
    if (gameContext.deer) {
        gameContext.deer.update(delta);
    }
    
    // Update grass wind animation (GPU shader-based)
    if (gameContext.updateGrassWind) {
        gameContext.updateGrassWind(delta);
    }

    updateWater(delta);
    
    // Update Shadow Camera to follow player
    updateShadowCamera();

    gameContext.renderer.render(gameContext.scene, gameContext.camera);
}

function onWindowResize() {
    if (!gameContext.camera || !gameContext.renderer) return;
    const quality = getQualitySettings();
    gameContext.camera.aspect = window.innerWidth / window.innerHeight;
    gameContext.camera.far = quality.cameraFar;
    gameContext.camera.updateProjectionMatrix();
    gameContext.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap));
    gameContext.renderer.setSize(window.innerWidth, window.innerHeight);
}

// Start initialization
init();
