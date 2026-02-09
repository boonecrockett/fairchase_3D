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
    if (!gameContext.scene) {
        gameContext.scene = new THREE.Scene();
    }
    // Initial background is transparent to show title screen
    // gameContext.scene.background = new THREE.Color(DEFAULT_SKY_COLOR); 
    gameContext.scene.fog = new THREE.Fog(DEFAULT_SKY_COLOR, 50, 200); // color, near, far

    // Ensure we have valid dimensions for the camera and renderer
    const width = window.innerWidth || 800;
    const height = window.innerHeight || 600;
    
    if (!gameContext.camera) {
        gameContext.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    }

    // Enable alpha for transparency
    if (!gameContext.renderer) {
        gameContext.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        gameContext.renderer.setClearColor(0x000000, 0); // Transparent background
        gameContext.renderer.setSize(width, height);
        gameContext.renderer.shadowMap.enabled = true;
        gameContext.renderer.shadowMap.type = THREE.PCFShadowMap;
        
        gameContext.renderer.shadowMap.autoUpdate = true;
        gameContext.renderer.outputColorSpace = THREE.SRGBColorSpace;
        
        // Ensure the canvas is properly styled
        gameContext.renderer.domElement.style.display = 'block';
        gameContext.renderer.domElement.style.width = '100%';
        gameContext.renderer.domElement.style.height = '100%';
        
        document.body.appendChild(gameContext.renderer.domElement);

        // Handle window resize events to keep the scene responsive
        window.addEventListener('resize', () => {
            const newWidth = window.innerWidth || 800;
            const newHeight = window.innerHeight || 600;
            if (gameContext.camera) {
                gameContext.camera.aspect = newWidth / newHeight;
                gameContext.camera.updateProjectionMatrix();
            }
            if (gameContext.renderer) {
                gameContext.renderer.setSize(newWidth, newHeight);
            }
        }, false);
    }
    
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(100, 100, 50);
    light.castShadow = true;
    light.shadow.mapSize.width = SHADOW_MAP_SIZE;
    light.shadow.mapSize.height = SHADOW_MAP_SIZE;
    light.shadow.camera.near = 1;
    light.shadow.camera.far = 300;
    light.shadow.camera.left = -40;
    light.shadow.camera.right = 40;
    light.shadow.camera.top = 40;
    light.shadow.camera.bottom = -40;
    light.shadow.bias = -0.001;
    light.shadow.normalBias = 0.02;
    gameContext.scene.add(light);

    // Ambient light to softly illuminate the scene
    const ambientLight = new THREE.AmbientLight(0x404040, 0.69); // color, intensity (increased from 0.6 to 0.69 for 15% brighter shadows)
    gameContext.scene.add(ambientLight);

    // Store lighting references for dynamic day/night cycle
    gameContext.scene.sun = light;
    gameContext.scene.ambientLight = ambientLight;

    // Create a clock for delta time management
    if (!gameContext.clock) {
        gameContext.clock = new THREE.Clock(true); // Auto-start the clock
    } else {
        gameContext.clock.start();
    }
}

// Pre-computed shadow offset to avoid creating new Vector3 every frame
const _shadowOffset = new THREE.Vector3(100, 100, 50).normalize().multiplyScalar(150);

/**
 * Updates the shadow camera to follow the player and maintain consistent shadow coverage
 */
let _shadowBoundsInitialized = false;

export function updateShadowCamera() {
    if (gameContext.scene && gameContext.scene.sun && gameContext.camera) {
        const light = gameContext.scene.sun;
        const playerPosition = gameContext.camera.position;
        
        // Position shadow camera to follow player with offset based on sun direction
        light.position.copy(playerPosition).add(_shadowOffset);
        
        // Update shadow camera target to center on player
        light.target.position.copy(playerPosition);
        light.target.updateMatrixWorld();
        
        // Set shadow camera bounds once (they never change)
        if (!_shadowBoundsInitialized) {
            const shadowSize = 40;
            light.shadow.camera.left = -shadowSize;
            light.shadow.camera.right = shadowSize;
            light.shadow.camera.top = shadowSize;
            light.shadow.camera.bottom = -shadowSize;
            light.shadow.camera.updateProjectionMatrix();
            _shadowBoundsInitialized = true;
        }
    }
}
