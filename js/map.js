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
