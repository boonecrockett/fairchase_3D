// js/scene.js
import * as THREE from 'three';
import { gameContext } from './context.js';

const DEFAULT_SKY_COLOR = 0x6ca0dc;
const SHADOW_MAP_SIZE = 2048;

/**
 * Sets up the main Three.js scene, camera, renderer, lighting, and event listeners.
 * Populates the shared gameContext object with essential scene components.
 */
export function setupScene() {
    gameContext.scene = new THREE.Scene();
    gameContext.scene.background = new THREE.Color(DEFAULT_SKY_COLOR);
    gameContext.scene.fog = new THREE.Fog(DEFAULT_SKY_COLOR, 50, 200); // color, near, far

    // Ensure we have valid dimensions for the camera and renderer
    const width = window.innerWidth || 800;
    const height = window.innerHeight || 600;
    
    gameContext.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);

    gameContext.renderer = new THREE.WebGLRenderer({ antialias: true });
    gameContext.renderer.setSize(width, height);
    gameContext.renderer.shadowMap.enabled = true;
    gameContext.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Enhanced shadow settings for softer, more natural shadows
    gameContext.renderer.shadowMap.autoUpdate = true;
    gameContext.renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    // Ensure the canvas is properly styled
    gameContext.renderer.domElement.style.display = 'block';
    gameContext.renderer.domElement.style.width = '100%';
    gameContext.renderer.domElement.style.height = '100%';
    
    document.body.appendChild(gameContext.renderer.domElement);
    
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(100, 100, 50);
    light.castShadow = true;
    light.shadow.mapSize.width = SHADOW_MAP_SIZE;
    light.shadow.mapSize.height = SHADOW_MAP_SIZE;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 800; // Increased from 500 for better coverage
    light.shadow.camera.left = -200; // Expanded from -100 to cover more area
    light.shadow.camera.right = 200; // Expanded from 100 to cover more area
    light.shadow.camera.top = 200; // Expanded from 100 to cover more area
    light.shadow.camera.bottom = -200; // Expanded from -100 to cover more area
    
    // Enhanced shadow softness settings
    light.shadow.radius = 10; // Increase shadow blur radius for softer edges
    light.shadow.blurSamples = 25; // More samples for smoother shadow gradients
    light.shadow.bias = -0.0001; // Reduce shadow acne while maintaining softness
    gameContext.scene.add(light);

    // Ambient light to softly illuminate the scene
    const ambientLight = new THREE.AmbientLight(0x404040, 0.69); // color, intensity (increased from 0.6 to 0.69 for 15% brighter shadows)
    gameContext.scene.add(ambientLight);

    // Store lighting references for dynamic day/night cycle
    gameContext.scene.sun = light;
    gameContext.scene.ambientLight = ambientLight;

    // Handle window resize events to keep the scene responsive
    window.addEventListener('resize', () => {
        const newWidth = window.innerWidth || 800;
        const newHeight = window.innerHeight || 600;
        gameContext.camera.aspect = newWidth / newHeight;
        gameContext.camera.updateProjectionMatrix();
        gameContext.renderer.setSize(newWidth, newHeight);
    }, false);
}

/**
 * Updates the shadow camera to follow the player and maintain consistent shadow coverage
 */
export function updateShadowCamera() {
    if (gameContext.scene && gameContext.scene.sun && gameContext.camera) {
        const light = gameContext.scene.sun;
        const playerPosition = gameContext.camera.position;
        
        // Position shadow camera to follow player with offset based on sun direction
        const shadowOffset = new THREE.Vector3(100, 100, 50).normalize().multiplyScalar(150);
        light.position.copy(playerPosition).add(shadowOffset);
        
        // Update shadow camera target to center on player
        light.target.position.copy(playerPosition);
        light.target.updateMatrixWorld();
        
        // Adjust shadow camera bounds to center on player
        const shadowSize = 150; // Smaller, more focused shadow area
        light.shadow.camera.left = -shadowSize;
        light.shadow.camera.right = shadowSize;
        light.shadow.camera.top = shadowSize;
        light.shadow.camera.bottom = -shadowSize;
        
        light.shadow.camera.updateProjectionMatrix();
    }
}
