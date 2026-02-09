// js/map.js
import * as THREE from 'three';
import { gameContext } from './context.js';
import { ensureMainMenuHidden } from './ui.js';
import { logEvent, updateReportModal } from './report-logger.js';

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
const MAP_BUSH_COLOR = 0x2d5a27;        // Slightly lighter green for bushes
const MAP_TRAIL_COLOR = 0xbeb5a3;       // Tan - brand color
const MAP_HUNTER_COLOR = 0xba5216;      // Autumn - brand color for player
const MAP_DEER_COLOR = 0x5f4d4d;        // Hide - brand color for deer
const MAP_HIT_MARKER_COLOR = 0xa63d2a;  // Danger red for hit marker
const MAP_TAGGED_COLOR = 0x9eb529;      // Leaf - brand color for tagged deer
const MAP_PLAYER_DOT_STROKE_COLOR = '#beb5a3'; // Tan
const MAP_PLAYER_DOT_RADIUS = 6;
const MAP_PLAYER_DOT_LINE_WIDTH = 2;
const MAP_MARKER_OUTLINE_COLOR = 0xffffff; // White outline for markers
const MAP_MARKER_OUTLINE_WIDTH = 2; // Width of outline ring

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
 * Creates a map marker dot with a white outline ring for better visibility
 * @param {number} radius - Radius of the dot
 * @param {number} color - Color of the dot fill
 * @param {THREE.Vector3} position - World position for the marker
 * @param {number} yOffset - Height offset above terrain
 * @returns {THREE.Group} Group containing the dot and outline
 */
function createMarkerWithOutline(radius, color, position, yOffset = 20) {
    const group = new THREE.Group();
    
    // Create white outline ring (slightly larger)
    const outlineGeometry = new THREE.RingGeometry(radius, radius + MAP_MARKER_OUTLINE_WIDTH, 24);
    const outlineMaterial = new THREE.MeshBasicMaterial({
        color: MAP_MARKER_OUTLINE_COLOR,
        side: THREE.DoubleSide,
        depthTest: false
    });
    const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
    outline.renderOrder = 998;
    group.add(outline);
    
    // Create filled dot
    const dotGeometry = new THREE.CircleGeometry(radius, 24);
    const dotMaterial = new THREE.MeshBasicMaterial({
        color: color,
        depthTest: false
    });
    const dot = new THREE.Mesh(dotGeometry, dotMaterial);
    dot.renderOrder = 999;
    group.add(dot);
    
    // Position the group
    group.position.copy(position);
    group.position.y = gameContext.getHeightAt(position.x, position.z) + yOffset;
    group.rotation.x = -Math.PI / 2;
    
    return group;
}

/**
 * Creates an X marker for the map at a given position
 */
function createHitMarker(position, size = 10) {
    const group = new THREE.Group();
    
    // Use box meshes instead of lines for thick, visible X
    // WebGL linewidth is capped at 1 on most systems
    const thickness = 3; // Thickness of the X bars
    const material = new THREE.MeshBasicMaterial({ 
        color: MAP_HIT_MARKER_COLOR,
        depthTest: false
    });
    
    // Create rotated boxes for the X shape
    // Bar 1: top-left to bottom-right (rotated 45 degrees)
    const barLength = size * 2 * 1.414; // Diagonal length
    const geometry1 = new THREE.BoxGeometry(barLength, 1, thickness);
    const bar1 = new THREE.Mesh(geometry1, material);
    bar1.rotation.y = Math.PI / 4; // 45 degrees
    bar1.renderOrder = 997;
    group.add(bar1);
    
    // Bar 2: top-right to bottom-left (rotated -45 degrees)
    const geometry2 = new THREE.BoxGeometry(barLength, 1, thickness);
    const bar2 = new THREE.Mesh(geometry2, material);
    bar2.rotation.y = -Math.PI / 4; // -45 degrees
    bar2.renderOrder = 997;
    group.add(bar2);
    
    // Add white outline for better visibility
    const outlineMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xffffff,
        depthTest: false
    });
    const outlineThickness = thickness + 2;
    const outlineGeometry1 = new THREE.BoxGeometry(barLength + 2, 0.5, outlineThickness);
    const outline1 = new THREE.Mesh(outlineGeometry1, outlineMaterial);
    outline1.rotation.y = Math.PI / 4;
    outline1.position.y = -0.5;
    outline1.renderOrder = 996;
    group.add(outline1);
    
    const outlineGeometry2 = new THREE.BoxGeometry(barLength + 2, 0.5, outlineThickness);
    const outline2 = new THREE.Mesh(outlineGeometry2, outlineMaterial);
    outline2.rotation.y = -Math.PI / 4;
    outline2.position.y = -0.5;
    outline2.renderOrder = 996;
    group.add(outline2);
    
    group.position.copy(position);
    group.position.y = 25; // Elevate above terrain
    
    return group;
}

/**
 * Adds a distance scale legend to the map canvas
 */
function addDistanceLegend(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Get world size for scale calculation
    const worldSize = gameContext.terrain ? gameContext.terrain.geometry.parameters.width : 1000;
    const pixelsPerUnit = MAP_CANVAS_SIZE / worldSize;
    
    // Calculate 100 yard bar length (1 yard ≈ 0.9144 meters, game uses ~1 unit = 1 meter)
    const yardsToUnits = 0.9144;
    const legendYards = 100;
    const legendUnits = legendYards * yardsToUnits;
    const legendPixels = legendUnits * pixelsPerUnit;
    
    // Position in bottom-left corner
    const x = 20;
    const y = MAP_CANVAS_SIZE - 25;
    
    // Draw scale bar background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x - 5, y - 20, legendPixels + 40, 35);
    
    // Draw scale bar
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + legendPixels, y);
    // End caps
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.moveTo(x + legendPixels, y - 5);
    ctx.lineTo(x + legendPixels, y + 5);
    ctx.stroke();
    
    // Draw label
    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${legendYards} yds`, x + legendPixels / 2, y - 8);
}

/**
 * Renders and displays the game map in a modal.
 * Creates a temporary scene with a top-down orthographic view of the terrain, water, trees, and player position.
 */
export function showMap() {
    if (!gameContext.mapModalBackdrop || !gameContext.terrain || !gameContext.mapRenderer) return;

    if (gameContext.batteryLevel <= 0) {
        showBatteryDepletedMessage();
        return;
    }
    
    // Log map usage
    logEvent("Map Checked", `Smartphone map opened (Battery: ${gameContext.batteryLevel}%)`, {
        batteryLevel: gameContext.batteryLevel,
        mapUsageCount: gameContext.mapUsageCount + 1
    });
    
    gameContext.mapModalBackdrop.style.display = 'flex';
    
    // Update map clock display
    const mapClockElement = document.getElementById('map-clock');
    if (mapClockElement && gameContext.gameTime !== undefined) {
        const hours = Math.floor(gameContext.gameTime);
        const minutes = Math.floor((gameContext.gameTime - hours) * 60);
        const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        mapClockElement.textContent = timeString;
    }
    
    // Use battery
    gameContext.batteryLevel = Math.max(0, gameContext.batteryLevel - 10);
    gameContext.mapUsageCount++;
    
    // Log battery usage
    logEvent("Battery Used", `10% battery consumed for map usage`, {
        amount: 10,
        remainingBattery: gameContext.batteryLevel
    });
    
    // Update battery display
    if (gameContext.batteryValueElement) {
        gameContext.batteryValueElement.textContent = `${gameContext.batteryLevel}%`;
    }
    
    // Update report if modal is open
    updateReportModal();
    
    const worldSize = gameContext.terrain.geometry.parameters.width;

    const tempScene = new THREE.Scene();
    tempScene.background = new THREE.Color(MAP_BACKGROUND_COLOR);

    const halfWorldSize = worldSize / 2;
    // Fix aspect ratio for square map canvas (512x512)
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
    
    // --- Bushes (rendered for map visibility) ---
    if (gameContext.bushes) {
        gameContext.bushes.children.forEach(bush => {
            const mapBush = bush.clone();
            mapBush.traverse(child => {
                if (child.isMesh) {
                    child.material = new THREE.MeshBasicMaterial({ color: MAP_BUSH_COLOR });
                }
            });
            tempScene.add(mapBush);
        });
    }
    
    // --- Game Trails (rendered for map visibility) ---
    if (gameContext.trails && gameContext.trails.children && gameContext.trails.children.length > 0) {
        console.log(`🗺️ MAP: Adding ${gameContext.trails.children.length} trails to map`);
        gameContext.trails.children.forEach(trail => {
            // Extract trail points and create a wider line for the map
            const positions = trail.geometry.attributes.position.array;
            
            // Create a simple wide line using PlaneGeometry segments
            const trailPoints = [];
            for (let i = 0; i < positions.length; i += 6) {
                // Get center point of each segment (average of left and right vertices)
                const centerX = (positions[i] + positions[i + 3]) / 2;
                const centerZ = (positions[i + 2] + positions[i + 5]) / 2;
                trailPoints.push(new THREE.Vector3(centerX, 100, centerZ));
            }
            
            // Create wider trail geometry for map
            if (trailPoints.length >= 2) {
                const mapTrailWidth = 4; // Wider for map visibility
                const vertices = [];
                const indices = [];
                
                for (let i = 0; i < trailPoints.length; i++) {
                    const point = trailPoints[i];
                    let perpX, perpZ;
                    
                    if (i === 0) {
                        const next = trailPoints[1];
                        const dx = next.x - point.x;
                        const dz = next.z - point.z;
                        const len = Math.sqrt(dx * dx + dz * dz) || 1;
                        perpX = -dz / len * mapTrailWidth;
                        perpZ = dx / len * mapTrailWidth;
                    } else if (i === trailPoints.length - 1) {
                        const prev = trailPoints[i - 1];
                        const dx = point.x - prev.x;
                        const dz = point.z - prev.z;
                        const len = Math.sqrt(dx * dx + dz * dz) || 1;
                        perpX = -dz / len * mapTrailWidth;
                        perpZ = dx / len * mapTrailWidth;
                    } else {
                        const prev = trailPoints[i - 1];
                        const next = trailPoints[i + 1];
                        const dx = next.x - prev.x;
                        const dz = next.z - prev.z;
                        const len = Math.sqrt(dx * dx + dz * dz) || 1;
                        perpX = -dz / len * mapTrailWidth;
                        perpZ = dx / len * mapTrailWidth;
                    }
                    
                    vertices.push(point.x - perpX, 100, point.z - perpZ);
                    vertices.push(point.x + perpX, 100, point.z + perpZ);
                    
                    if (i > 0) {
                        const base = (i - 1) * 2;
                        indices.push(base, base + 1, base + 2);
                        indices.push(base + 1, base + 3, base + 2);
                    }
                }
                
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
                geometry.setIndex(indices);
                
                const mapTrail = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
                    color: MAP_TRAIL_COLOR,
                    side: THREE.DoubleSide,
                    depthTest: false
                }));
                // Trail geometry is already in XZ plane, no rotation needed
                mapTrail.renderOrder = 100;
                tempScene.add(mapTrail);
            }
        });
    }

    // --- Hunter Dot (3D) - Hunter's Orange with white outline ---
    const playerMarker = createMarkerWithOutline(10, MAP_HUNTER_COLOR, gameContext.player.position, 20);
    tempScene.add(playerMarker);

    // --- Deer Marker Logic ---
    // Show different markers based on deer state:
    // - Alive: Brown dot (live tracking)
    // - Wounded/Dead untagged: Red X at hit location + blood trail
    // - Tagged: Green dot at actual location
    
    if (gameContext.deer && gameContext.deer.isModelLoaded) {
        const isWounded = gameContext.deer.state === 'WOUNDED';
        const isDead = gameContext.deer.state === 'KILLED';
        const isTagged = gameContext.deer.tagged;
        
        if (isTagged) {
            // Tagged deer - show green dot with outline at actual location
            const deerMarker = createMarkerWithOutline(10, MAP_TAGGED_COLOR, gameContext.deer.model.position, 21);
            tempScene.add(deerMarker);
            
        } else if (isWounded || isDead) {
            // Wounded or dead untagged - show red X at hit location only
            if (gameContext.lastHitPosition) {
                const hitMarker = createHitMarker(gameContext.lastHitPosition, 10);
                tempScene.add(hitMarker);
            }
            
        } else {
            // Alive deer - show brown dot with outline (GPS tracking)
            const deerMarker = createMarkerWithOutline(10, MAP_DEER_COLOR, gameContext.deer.model.position, 21);
            tempScene.add(deerMarker);
        }
    }

    gameContext.mapRenderer.render(tempScene, tempCamera);
    
    // Add distance legend overlay
    addDistanceLegend(gameContext.mapCanvas);
}

/**
 * Shows a smartphone-style map popup with score penalty
 * Map stays open while M key is held down
 */
export function showSmartphoneMap() {
    // Check if map is already open - don't reopen/charge again
    const modal = document.getElementById('smartphone-map-modal');
    if (modal && modal.style.display === 'flex') {
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
    ensureMainMenuHidden();
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
    const batteryText = document.querySelector('#smartphone-map-modal .battery-text');
    const batteryFill = document.querySelector('#smartphone-map-modal .battery-fill');
    
    if (batteryText && batteryFill) {
        const batteryPercentage = Math.max(0, 100 - (gameContext.mapUsageCount * 10));
        batteryText.textContent = `${batteryPercentage}%`;
        batteryFill.style.width = `${batteryPercentage}%`;
        
        // Change color based on battery level - using brand colors
        if (batteryPercentage <= 20) {
            batteryFill.style.background = 'linear-gradient(90deg, #a63d2a, #8a3322)'; // Danger red
        } else if (batteryPercentage <= 50) {
            batteryFill.style.background = 'linear-gradient(90deg, #ba5216, #9a4412)'; // Autumn
        } else {
            batteryFill.style.background = 'linear-gradient(90deg, #9eb529, #7a8c20)'; // Leaf
        }
    }
}

/**
 * Creates a modern GPS device-style map modal UI
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
        background: rgba(0, 0, 0, 0.85);
        display: none;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        backdrop-filter: blur(8px);
    `;
    
    // GPS device frame - Brand styled
    const device = document.createElement('div');
    device.style.cssText = `
        width: 380px;
        height: min(520px, 85vh);
        background: linear-gradient(145deg, #2a2b2f 0%, #1a1b1f 50%, #121315 100%);
        border-radius: 16px;
        padding: 12px;
        box-shadow: 
            0 25px 50px rgba(0, 0, 0, 0.6),
            0 0 0 1px rgba(158, 181, 41, 0.2),
            inset 0 1px 0 rgba(190, 181, 163, 0.1);
        position: relative;
        box-sizing: border-box;
        max-height: 85vh;
        overflow: hidden;
    `;
    
    // Top bar with device info - Brand colors
    const topBar = document.createElement('div');
    topBar.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        margin-bottom: 8px;
        background: linear-gradient(180deg, #5f4d4d 0%, #3d3532 100%);
        border-radius: 8px;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        border-bottom: 2px solid #9eb529;
    `;
    topBar.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 8px; height: 8px; background: #9eb529; border-radius: 50%; box-shadow: 0 0 8px #9eb529;"></div>
            <span style="color: #beb5a3; font-size: 13px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;">Hunting GPS</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
            <span style="color: #9a9488; font-size: 11px;" class="battery-text">100%</span>
            <div style="width: 24px; height: 12px; border: 1.5px solid #9a9488; border-radius: 3px; position: relative; padding: 1px;">
                <div class="battery-fill" style="width: 100%; height: 100%; background: linear-gradient(90deg, #9eb529, #7a8c20); border-radius: 1px;"></div>
                <div style="position: absolute; right: -4px; top: 50%; transform: translateY(-50%); width: 2px; height: 6px; background: #9a9488; border-radius: 0 1px 1px 0;"></div>
            </div>
        </div>
    `;
    topBar.classList.add('status-bar');
    
    // Map screen container with bezel effect
    const screenBezel = document.createElement('div');
    screenBezel.style.cssText = `
        background: #1a1b1f;
        border-radius: 10px;
        padding: 3px;
        box-shadow: inset 0 2px 8px rgba(0,0,0,0.8);
        margin-bottom: 8px;
        border: 1px solid #3d3e42;
    `;
    
    const mapContainer = document.createElement('div');
    mapContainer.style.cssText = `
        width: 100%;
        height: min(340px, calc(85vh - 180px));
        background: linear-gradient(180deg, #1a3d2a 0%, #0f2419 100%);
        border-radius: 8px;
        overflow: hidden;
        position: relative;
        box-sizing: border-box;
    `;
    
    const mapCanvas = document.createElement('canvas');
    mapCanvas.id = 'smartphone-map-canvas';
    mapCanvas.width = 350;
    mapCanvas.height = 340;
    mapCanvas.style.cssText = `
        width: 100%;
        height: 100%;
        display: block;
        border-radius: 8px;
    `;
    
    mapContainer.appendChild(mapCanvas);
    screenBezel.appendChild(mapContainer);
    
    // Legend bar BELOW the map - Brand styled
    const legendBar = document.createElement('div');
    legendBar.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        background: linear-gradient(180deg, #3d3e42 0%, #2a2b2f 100%);
        border-radius: 8px;
        margin-top: 8px;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 11px;
        color: #beb5a3;
        border-top: 1px solid #5f4d4d;
    `;
    legendBar.innerHTML = `
        <div style="display: flex; align-items: center; gap: 14px;">
            <div style="display: flex; align-items: center; gap: 5px;">
                <div style="width: 10px; height: 10px; background: #ba5216; border-radius: 50%; border: 1px solid #d4691a;"></div>
                <span>You</span>
            </div>
            <div style="display: flex; align-items: center; gap: 5px;">
                <div style="width: 10px; height: 10px; background: #5f4d4d; border-radius: 50%; border: 1px solid #7a6363;"></div>
                <span>Deer</span>
            </div>
            <div style="display: flex; align-items: center; gap: 5px;">
                <span style="color: #a63d2a; font-weight: bold; font-size: 14px;">✕</span>
                <span>Hit</span>
            </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
            <span style="color: #ba5216; font-weight: bold;">N↑</span>
            <span style="color: #5f4d4d; margin: 0 4px;">│</span>
            <div style="width: 32px; height: 2px; background: #beb5a3; position: relative;">
                <div style="position: absolute; left: 0; top: -3px; width: 2px; height: 8px; background: #beb5a3;"></div>
                <div style="position: absolute; right: 0; top: -3px; width: 2px; height: 8px; background: #beb5a3;"></div>
            </div>
            <span style="font-size: 10px; color: #9a9488;">100 yds</span>
        </div>
    `;
    
    // Bottom controls
    const controls = document.createElement('div');
    controls.style.cssText = `
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 12px;
        padding: 8px 0;
    `;
    
    const closeButton = document.createElement('button');
    closeButton.style.cssText = `
        width: 44px;
        height: 44px;
        background: linear-gradient(180deg, #5f4d4d 0%, #3d3532 100%);
        border: 2px solid #9eb529;
        border-radius: 50%;
        color: #beb5a3;
        font-size: 16px;
        cursor: pointer;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        transition: all 0.2s ease;
        box-shadow: 
            0 4px 12px rgba(0,0,0,0.4),
            inset 0 1px 0 rgba(190, 181, 163, 0.1);
        display: flex;
        justify-content: center;
        align-items: center;
    `;
    closeButton.innerHTML = '✕';
    closeButton.onclick = closeSmartphoneMap;
    
    closeButton.onmouseover = () => {
        closeButton.style.background = 'linear-gradient(180deg, #7a6363 0%, #5f4d4d 100%)';
        closeButton.style.borderColor = '#b5cc3a';
        closeButton.style.transform = 'scale(1.05)';
    };
    closeButton.onmouseout = () => {
        closeButton.style.background = 'linear-gradient(180deg, #5f4d4d 0%, #3d3532 100%)';
        closeButton.style.borderColor = '#9eb529';
        closeButton.style.transform = 'scale(1)';
    };
    
    // Hint text
    const hint = document.createElement('div');
    hint.style.cssText = `
        text-align: center;
        color: #6b675f;
        font-size: 11px;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        margin-top: 4px;
        letter-spacing: 0.5px;
    `;
    hint.textContent = 'Press M or ESC to close';
    
    controls.appendChild(closeButton);
    
    device.appendChild(topBar);
    device.appendChild(screenBezel);
    device.appendChild(legendBar);
    device.appendChild(controls);
    device.appendChild(hint);
    modal.appendChild(device);
    document.body.appendChild(modal);
}

/**
 * Renders the map in modern GPS style
 */
function renderSmartphoneMap() {
    const canvas = document.getElementById('smartphone-map-canvas');
    if (!canvas || !gameContext.terrain) return;
    
    // Create renderer for GPS map with larger size
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(350, 340);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x1a472a);
    
    const worldSize = gameContext.terrain.geometry.parameters.width;
    const tempScene = new THREE.Scene();
    tempScene.background = new THREE.Color(0x1a472a);
    
    const halfWorldSize = worldSize / 2;
    // Fix aspect ratio for smartphone map (310x310) - square screen
    const aspectRatio = 1; // Square
    
    // For square screen, we need to expand the horizontal view to show the full world
    // Instead of narrowing horizontal bounds, expand them to ensure full world visibility
    const horizontalBounds = halfWorldSize / aspectRatio; // Expand horizontal to fit full world
    const verticalBounds = halfWorldSize; // Keep vertical as full world size
    
    const tempCamera = new THREE.OrthographicCamera(-horizontalBounds, horizontalBounds, verticalBounds, -verticalBounds, 1, 2000);
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
    
    // Add game trails
    if (gameContext.trails) {
        gameContext.trails.children.forEach(trail => {
            const mapTrail = trail.clone();
            mapTrail.material = new THREE.MeshBasicMaterial({ 
                color: MAP_TRAIL_COLOR,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.8
            });
            mapTrail.position.y += 5;
            tempScene.add(mapTrail);
        });
    }
    
    // Add hunter dot - Hunter's Orange with white outline
    const playerMarker = createMarkerWithOutline(10, MAP_HUNTER_COLOR, gameContext.player.position, 20);
    tempScene.add(playerMarker);
    
    // --- Deer Marker Logic (same as showMap) ---
    if (gameContext.deer && gameContext.deer.isModelLoaded) {
        const isWounded = gameContext.deer.state === 'WOUNDED';
        const isDead = gameContext.deer.state === 'KILLED';
        const isTagged = gameContext.deer.tagged;
        
        if (isTagged) {
            // Tagged deer - show green dot with outline at actual location
            const deerMarker = createMarkerWithOutline(10, MAP_TAGGED_COLOR, gameContext.deer.model.position, 21);
            tempScene.add(deerMarker);
            
        } else if (isWounded || isDead) {
            // Wounded or dead untagged - show red X at hit location only
            if (gameContext.lastHitPosition) {
                const hitMarker = createHitMarker(gameContext.lastHitPosition, 10);
                tempScene.add(hitMarker);
            }
            
        } else {
            // Alive deer - show brown dot with outline (GPS tracking)
            const deerMarker = createMarkerWithOutline(10, MAP_DEER_COLOR, gameContext.deer.model.position, 21);
            tempScene.add(deerMarker);
        }
    }
    
    renderer.render(tempScene, tempCamera);
    
    // Add distance legend overlay
    addDistanceLegend(canvas);
}

/**
 * Closes the smartphone map modal
 */
export function closeSmartphoneMap() {
    const modal = document.getElementById('smartphone-map-modal');
    if (modal) {
        modal.style.display = 'none';
        // Clean up any remaining event listeners to prevent conflicts
        modal.remove();
    }
}
