import * as THREE from 'three';
import { setupScene, updateShadowCamera } from './scene.js';
import { createHills, createWater, findDrinkingSpots, createTrees, createBushes, createGrass, createGroundCover, createShaderGrass, isWaterAt } from './world.js';
import { createTrails } from './trails.js';
import { createPlayer, addPlayerEventListeners, updatePlayer, getIsTreeBraced } from './player.js';
import { deer } from './deer.js';
import { initUI, showMessage, updateInteraction, updateCompass, ensureMainMenuHidden } from './ui.js';
import { initAudio, playRifleSound, updateAmbianceForTime } from './audio.js';
import { logEvent, initializeDayReport, updateDistanceTraveled } from './report-logger.js';
import { gameContext } from './context.js';
import { collisionSystem } from './collision.js'; 
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
import { shoot, tagDeer } from './hunting-mechanics.js';
import { updateTimeDisplay, updateDynamicLighting, isNight } from './environment-manager.js';
import { showLoadingModal, hideLoadingModal, registerTask, completeTask, updateLoadingStatus, initLoadingManager } from './loading-manager.js';

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
    
    // Implement isFoliageAt helper using bush, tree, AND grass collision for foliage sounds
    let lastFoliageLogTime = 0;
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
        
        const position = new THREE.Vector3(x, 0, z);
        // Check bushes and small trees - use larger radius for sound detection
        let inBush = false;
        if (gameContext.checkBushCollision) {
            inBush = !!gameContext.checkBushCollision(position, 4.5);
        }
        
        // Check grass clusters (most common foliage)
        let inGrass = false;
        if (gameContext.grassClusterPositions && gameContext.grassClusterPositions.length > 0) {
            const clusters = gameContext.grassClusterPositions;
            for (let i = 0, len = clusters.length; i < len; i++) {
                const cluster = clusters[i];
                const cdx = x - cluster.x;
                const cdz = z - cluster.z;
                const distSq = cdx * cdx + cdz * cdz;
                // Use stored detection radius directly
                const checkRadius = cluster.radius;
                if (distSq < checkRadius * checkRadius) {
                    inGrass = true;
                    break;
                }
            }
        }
        
        const result = inBush || inGrass;
        
        // Debug log when foliage state changes (always log for debugging)
        if (result !== lastFoliageCheck.result) {
            console.log(`🌿 Foliage: ${result ? 'ENTERED' : 'LEFT'} (bush: ${inBush}, grass: ${inGrass}, bushes: ${gameContext.bushes?.children?.length || 0}, grassClusters: ${gameContext.grassClusterPositions?.length || 0})`);
            lastFoliageLogTime = now;
        }
        
        lastFoliageCheck = { x, z, result, time: now };
        return result;
    };
    
    // Attach isWaterAt helper for player interaction
    gameContext.isWaterAt = isWaterAt;

    gameContext.raycaster = collisionSystem.raycaster;
    gameContext.collisionSystem = collisionSystem;

    // Setup scene (lights, sky, fog)
    setupScene();

    // Initialize UI
    initUI();

    // Expose functions for UI interaction
    window.startGame = startGame;
    window.fireWeapon = shoot; // Use extracted shoot function
    window.tagAnimal = tagDeer; // Use extracted tagDeer function
    
    // Expose context functions for ui.js
    gameContext.init = startGame;
    gameContext.animate = animate;
    
    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);
    
    // Add visibility change listener to pause/resume game if needed
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Optional: Pause game logic
        } else {
            // Optional: Resume game logic
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
        } else if (typeof selectedWorldId === 'object') {
            worldConfig = selectedWorldId;
            gameContext.worldId = 'custom';
        }
        
        if (!worldConfig) {
            console.warn('⚠️ START GAME: World config missing, using default');
            worldConfig = worldPresets['Hardwood Forest'];
        }

        gameContext.worldConfig = worldConfig;
        if (typeof selectedWorldId === 'string') {
            gameContext.worldId = selectedWorldId;
        }
        
        // Clear existing scene elements if any (for restart)
        while(gameContext.scene.children.length > 0){ 
            gameContext.scene.remove(gameContext.scene.children[0]); 
        }
        
        // Re-setup basic scene elements
        setupScene();
        
        // 1. Generate Terrain (synchronous)
        updateLoadingStatus('Generating terrain...');
        createHills(worldConfig);
        completeTask('terrain');
        
        // 2. Add Water (synchronous)
        updateLoadingStatus('Creating water...');
        createWater(worldConfig);
        findDrinkingSpots();
        completeTask('water');
        
        // 3. Add Trails (synchronous)
        updateLoadingStatus('Creating game trails...');
        createTrails(worldConfig);
        completeTask('trails');
        
        // 4. Add Vegetation (async - models need to load)
        updateLoadingStatus('Loading vegetation...');
        
        // Create promises for async vegetation loading
        const treesPromise = createTrees(worldConfig).then(() => completeTask('trees'));
        const bushesPromise = createBushes(worldConfig).then(() => completeTask('bushes'));
        const grassPromise = createGrass(worldConfig).then(() => completeTask('grass'));
        
        // 5. Create Player (synchronous)
        createPlayer(gameContext.camera, gameContext.scene);
        addPlayerEventListeners();
        
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
        
        // Update UI
        if (gameContext.scoreValueElement) gameContext.scoreValueElement.textContent = 0;
        
        // Initial log
        initializeDayReport();
        const worldName = worldConfig && worldConfig.name ? worldConfig.name : "Wilderness";
        logEvent("Hunt Started", `Started hunt in ${worldName}`);
        console.log('✅ START GAME: All assets loaded, game ready');
        
    } catch (error) {
        console.error('🛑 FATAL ERROR in startGame:', error);
        hideLoadingModal();
        throw error;
    }
}

function animate() {
    requestAnimationFrame(animate);

    const delta = gameContext.clock.getDelta();
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
    
    // Update Shadow Camera to follow player
    updateShadowCamera();

    gameContext.renderer.render(gameContext.scene, gameContext.camera);
}

function onWindowResize() {
    gameContext.camera.aspect = window.innerWidth / window.innerHeight;
    gameContext.camera.updateProjectionMatrix();
    gameContext.renderer.setSize(window.innerWidth, window.innerHeight);
}

// Start initialization
init();
