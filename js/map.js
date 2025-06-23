// js/map.js
import * as THREE from 'three';
import { gameContext } from './context.js';

// This file assumes THREE.js is loaded globally, as it is not imported as a module in main.js

// --- MAP MODULE CONSTANTS ---
const MAP_CANVAS_SIZE = 512;
const MAP_BACKGROUND_COLOR = 0x1a472a;
const MAP_CAMERA_Y_POSITION = 500;
const MAP_CAMERA_NEAR_PLANE = 1;
const MAP_CAMERA_FAR_PLANE = 2000;
const MAP_AMBIENT_LIGHT_COLOR = 0xffffff;
const MAP_AMBIENT_LIGHT_INTENSITY = 0.7;
const MAP_DIRECTIONAL_LIGHT_COLOR = 0xffffff;
const MAP_DIRECTIONAL_LIGHT_INTENSITY = 0.5;
const MAP_DIRECTIONAL_LIGHT_POSITION = { x: 100, y: 300, z: 200 };
const MAP_TREE_COLOR = 0x14501e;
const MAP_PLAYER_DOT_COLOR = 'red';
const MAP_PLAYER_DOT_STROKE_COLOR = 'white';
const MAP_PLAYER_DOT_RADIUS = 6;
const MAP_PLAYER_DOT_LINE_WIDTH = 2;

/**
 * Initializes the WebGLRenderer for the map canvas.
 */
export function initMap() {
    if (gameContext.mapCanvas) {
        gameContext.mapRenderer = new THREE.WebGLRenderer({ antialias: true, canvas: gameContext.mapCanvas });
        gameContext.mapRenderer.setSize(MAP_CANVAS_SIZE, MAP_CANVAS_SIZE);
    }
}

/**
 * Renders and displays the game map in a modal.
 * Creates a temporary scene with a top-down orthographic view of the terrain, water, trees, and player position.
 */
export function showMap() {
    if (!gameContext.mapModalBackdrop || !gameContext.terrain || !gameContext.mapRenderer) return;

    gameContext.mapModalBackdrop.style.display = 'flex';
    const worldSize = gameContext.terrain.geometry.parameters.width;

    const tempScene = new THREE.Scene();
    tempScene.background = new THREE.Color(MAP_BACKGROUND_COLOR);

    const halfWorldSize = worldSize / 2;
    const tempCamera = new THREE.OrthographicCamera(-halfWorldSize, halfWorldSize, halfWorldSize, -halfWorldSize, MAP_CAMERA_NEAR_PLANE, MAP_CAMERA_FAR_PLANE);
    tempCamera.position.y = MAP_CAMERA_Y_POSITION;
    tempCamera.lookAt(tempScene.position); // Look at the center of the map

    const mapAmbient = new THREE.AmbientLight(MAP_AMBIENT_LIGHT_COLOR, MAP_AMBIENT_LIGHT_INTENSITY);
    tempScene.add(mapAmbient);
    const mapDirectional = new THREE.DirectionalLight(MAP_DIRECTIONAL_LIGHT_COLOR, MAP_DIRECTIONAL_LIGHT_INTENSITY);
    mapDirectional.position.set(MAP_DIRECTIONAL_LIGHT_POSITION.x, MAP_DIRECTIONAL_LIGHT_POSITION.y, MAP_DIRECTIONAL_LIGHT_POSITION.z);
    tempScene.add(mapDirectional);

    tempScene.add(gameContext.terrain.clone());
    if (gameContext.waterBodies && gameContext.waterBodies.length > 0) {
        gameContext.waterBodies.forEach(waterBody => {
            tempScene.add(waterBody.clone());
        });
    }
    if (gameContext.trees) {
        gameContext.trees.children.forEach(tree => {
            const mapTree = tree.clone();
            mapTree.traverse(child => {
                if (child.isMesh) {
                    child.material = new THREE.MeshBasicMaterial({ color: MAP_TREE_COLOR });
                }
            });
            tempScene.add(mapTree);
        });
    }


    // --- Player Dot (3D) ---
    const playerDotGeometry = new THREE.CircleGeometry(10, 16); // Radius in world units
    const playerDotMaterial = new THREE.MeshBasicMaterial({
        color: MAP_PLAYER_DOT_COLOR,
        depthTest: false // Render on top of other map elements
    });
    const playerDot = new THREE.Mesh(playerDotGeometry, playerDotMaterial);
    playerDot.renderOrder = 999; // Ensure it renders last

    // Position the dot at the player's location but elevated to be visible
    playerDot.position.copy(gameContext.player.position);
    playerDot.position.y = gameContext.getHeightAt(playerDot.position.x, playerDot.position.z) + 20; // Elevate to be safe
    playerDot.rotation.x = -Math.PI / 2;

    tempScene.add(playerDot);

    // --- Deer Dot (3D) ---
    if (gameContext.deer && gameContext.deer.isModelLoaded) {
        const deerDotGeometry = new THREE.CircleGeometry(10, 16);
        const deerDotMaterial = new THREE.MeshBasicMaterial({
            color: 'yellow',
            depthTest: false
        });
        const deerDot = new THREE.Mesh(deerDotGeometry, deerDotMaterial);
        deerDot.renderOrder = 1000; // Render on top of player dot

        deerDot.position.copy(gameContext.deer.model.position);
        deerDot.position.y = gameContext.getHeightAt(deerDot.position.x, deerDot.position.z) + 21;
        deerDot.rotation.x = -Math.PI / 2;

        tempScene.add(deerDot);
    }

    gameContext.mapRenderer.render(tempScene, tempCamera);
}

/**
 * Shows a smartphone-style map popup with score penalty
 */
export function showSmartphoneMap() {
    // Check if map is already open - if so, close it
    const modal = document.getElementById('smartphone-map-modal');
    if (modal && modal.style.display === 'flex') {
        closeSmartphoneMap();
        return;
    }
    
    // Check if battery is depleted (10 uses max per day)
    if (gameContext.mapUsageCount >= gameContext.maxMapUsage) {
        // Show battery depleted message
        showBatteryDepletedMessage();
        return;
    }
    
    // Increment usage count and deduct score
    gameContext.mapUsageCount++;
    gameContext.score = Math.max(0, gameContext.score - 5);
    
    // Remove existing modal to force recreation with new styling
    const existingModal = document.getElementById('smartphone-map-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Create smartphone-style modal
    createSmartphoneMapModal();
    
    // Show the modal
    const newModal = document.getElementById('smartphone-map-modal');
    newModal.style.display = 'flex';
    
    // Update battery indicator
    updateBatteryIndicator();
    
    // Render the map
    renderSmartphoneMap();
    
    // Add escape key listener to close
    const closeHandler = (event) => {
        if (event.key === 'Escape') {
            closeSmartphoneMap();
            document.removeEventListener('keydown', closeHandler);
        }
    };
    document.addEventListener('keydown', closeHandler);
}

/**
 * Shows battery depleted message
 */
function showBatteryDepletedMessage() {
    // Create or show battery depleted modal
    let depletedModal = document.getElementById('battery-depleted-modal');
    if (!depletedModal) {
        depletedModal = document.createElement('div');
        depletedModal.id = 'battery-depleted-modal';
        depletedModal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1001;
            backdrop-filter: blur(5px);
        `;
        
        const messageBox = document.createElement('div');
        messageBox.style.cssText = `
            background: #1a1a1a;
            border-radius: 15px;
            padding: 30px;
            text-align: center;
            color: white;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 300px;
            border: 2px solid #ff4444;
        `;
        
        messageBox.innerHTML = `
            <div style="font-size: 48px; margin-bottom: 15px;">🔋</div>
            <h3 style="margin: 0 0 10px 0; color: #ff4444;">GPS Battery Depleted</h3>
            <p style="margin: 0 0 20px 0; font-size: 14px; color: #ccc;">
                You've used your GPS device 10 times today. The battery is dead until tomorrow.
            </p>
            <button id="battery-ok-btn" style="
                background: #ff4444;
                border: none;
                border-radius: 10px;
                color: white;
                padding: 10px 20px;
                font-size: 14px;
                cursor: pointer;
                font-family: inherit;
            ">OK</button>
        `;
        
        depletedModal.appendChild(messageBox);
        document.body.appendChild(depletedModal);
        
        // Add click handler to close
        document.getElementById('battery-ok-btn').onclick = () => {
            depletedModal.style.display = 'none';
        };
    }
    
    depletedModal.style.display = 'flex';
    
    // Auto-close after 3 seconds
    setTimeout(() => {
        depletedModal.style.display = 'none';
    }, 3000);
}

/**
 * Updates the battery indicator based on usage count
 */
function updateBatteryIndicator() {
    const statusBar = document.querySelector('#smartphone-map-modal .status-bar');
    if (statusBar) {
        const batteryPercentage = Math.max(0, 100 - (gameContext.mapUsageCount * 10));
        const batteryIcon = batteryPercentage > 20 ? '🔋' : '🪫';
        statusBar.innerHTML = `
            <span>📶 Hunting GPS</span>
            <span>${batteryIcon} ${batteryPercentage}%</span>
        `;
    }
}

/**
 * Creates the smartphone-style map modal UI
 */
function createSmartphoneMapModal() {
    const modal = document.createElement('div');
    modal.id = 'smartphone-map-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: none;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        backdrop-filter: blur(5px);
    `;
    
    const phone = document.createElement('div');
    phone.style.cssText = `
        width: 320px;
        height: 640px;
        background: #1a1a1a;
        border-radius: 25px;
        padding: 20px 5px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
        position: relative;
        border: 3px solid #333;
        box-sizing: border-box;
    `;
    
    const statusBar = document.createElement('div');
    statusBar.style.cssText = `
        height: 20px;
        background: #000;
        border-radius: 10px;
        margin-bottom: 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 10px;
        font-size: 12px;
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    statusBar.innerHTML = `
        <span>📶 Hunting GPS</span>
        <span>🔋 100%</span>
    `;
    statusBar.classList.add('status-bar');
    
    const header = document.createElement('div');
    header.style.cssText = `
        background: #2c2c2e;
        border-radius: 15px;
        padding: 15px;
        margin-bottom: 10px;
        text-align: center;
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    header.innerHTML = `
        <h3 style="margin: 0; font-size: 18px;">📍 Hunting Map</h3>
        <p style="margin: 5px 0 0 0; font-size: 12px; color: #ff6b6b;">-5 points for GPS usage</p>
    `;
    
    const mapContainer = document.createElement('div');
    mapContainer.style.cssText = `
        width: 100%;
        height: 480px;
        background: #000;
        border-radius: 15px;
        overflow: hidden;
        position: relative;
        margin-bottom: 15px;
        box-sizing: border-box;
    `;
    
    const mapCanvas = document.createElement('canvas');
    mapCanvas.id = 'smartphone-map-canvas';
    mapCanvas.width = 310;
    mapCanvas.height = 480;
    mapCanvas.style.cssText = `
        width: 100%;
        height: 100%;
        display: block;
        border-radius: 15px;
        box-sizing: border-box;
    `;
    
    const northIndicator = document.createElement('div');
    northIndicator.style.cssText = `
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 5px 10px;
        border-radius: 15px;
        font-size: 12px;
        font-weight: bold;
        z-index: 10;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        border: 1px solid rgba(255, 255, 255, 0.3);
    `;
    northIndicator.textContent = '↑ N';
    
    mapContainer.appendChild(mapCanvas);
    mapContainer.appendChild(northIndicator);
    phone.appendChild(statusBar);
    phone.appendChild(header);
    phone.appendChild(mapContainer);
    
    const closeButton = document.createElement('button');
    closeButton.style.cssText = `
        width: 40px;
        height: 40px;
        background: rgba(102, 102, 102, 0.7);
        border: none;
        border-radius: 50%;
        color: white;
        font-size: 20px;
        cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        transition: background 0.2s;
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 20;
        backdrop-filter: blur(5px);
    `;
    closeButton.onclick = closeSmartphoneMap;
    
    closeButton.onmouseover = () => closeButton.style.background = 'rgba(136, 136, 136, 0.8)';
    closeButton.onmouseout = () => closeButton.style.background = 'rgba(102, 102, 102, 0.7)';
    
    phone.appendChild(closeButton);
    modal.appendChild(phone);
    document.body.appendChild(modal);
}

/**
 * Renders the map in smartphone style
 */
function renderSmartphoneMap() {
    const canvas = document.getElementById('smartphone-map-canvas');
    if (!canvas || !gameContext.terrain) return;
    
    // Create renderer for smartphone map
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(310, 480);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x1a472a);
    
    const worldSize = gameContext.terrain.geometry.parameters.width;
    const tempScene = new THREE.Scene();
    tempScene.background = new THREE.Color(0x1a472a);
    
    const halfWorldSize = worldSize / 2;
    const tempCamera = new THREE.OrthographicCamera(-halfWorldSize, halfWorldSize, halfWorldSize, -halfWorldSize, 1, 2000);
    tempCamera.position.y = 500;
    tempCamera.lookAt(tempScene.position);
    
    // Add lighting
    const mapAmbient = new THREE.AmbientLight(0xffffff, 0.7);
    tempScene.add(mapAmbient);
    const mapDirectional = new THREE.DirectionalLight(0xffffff, 0.5);
    mapDirectional.position.set(100, 300, 200);
    tempScene.add(mapDirectional);
    
    // Add terrain
    tempScene.add(gameContext.terrain.clone());
    
    // Add water bodies
    if (gameContext.waterBodies && gameContext.waterBodies.length > 0) {
        gameContext.waterBodies.forEach(waterBody => {
            tempScene.add(waterBody.clone());
        });
    }
    
    // Add trees
    if (gameContext.trees) {
        gameContext.trees.children.forEach(tree => {
            const mapTree = tree.clone();
            mapTree.traverse(child => {
                if (child.isMesh) {
                    child.material = new THREE.MeshBasicMaterial({ color: 0x14501e });
                }
            });
            tempScene.add(mapTree);
        });
    }
    
    // Add player dot
    const playerDotGeometry = new THREE.CircleGeometry(10, 16);
    const playerDotMaterial = new THREE.MeshBasicMaterial({
        color: 'red',
        depthTest: false
    });
    const playerDot = new THREE.Mesh(playerDotGeometry, playerDotMaterial);
    playerDot.renderOrder = 999;
    
    playerDot.position.copy(gameContext.player.position);
    playerDot.position.y = gameContext.getHeightAt(playerDot.position.x, playerDot.position.z) + 20;
    playerDot.rotation.x = -Math.PI / 2;
    tempScene.add(playerDot);
    
    // Add deer dot if visible
    if (gameContext.deer && gameContext.deer.isModelLoaded) {
        const deerDotGeometry = new THREE.CircleGeometry(10, 16);
        const deerDotMaterial = new THREE.MeshBasicMaterial({
            color: 'yellow',
            depthTest: false
        });
        const deerDot = new THREE.Mesh(deerDotGeometry, deerDotMaterial);
        deerDot.renderOrder = 1000;
        
        deerDot.position.copy(gameContext.deer.model.position);
        deerDot.position.y = gameContext.getHeightAt(deerDot.position.x, deerDot.position.z) + 21;
        deerDot.rotation.x = -Math.PI / 2;
        tempScene.add(deerDot);
    }
    
    renderer.render(tempScene, tempCamera);
}

/**
 * Closes the smartphone map modal
 */
function closeSmartphoneMap() {
    const modal = document.getElementById('smartphone-map-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}
