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
    light.shadow.camera.far = 500;
    light.shadow.camera.left = -100;
    light.shadow.camera.right = 100;
    light.shadow.camera.top = 100;
    light.shadow.camera.bottom = -100;
    gameContext.scene.add(light);

    // Ambient light to softly illuminate the scene
    const ambientLight = new THREE.AmbientLight(0x404040, 0.69); // color, intensity (increased from 0.6 to 0.69 for 15% brighter shadows)
    gameContext.scene.add(ambientLight);

    // Handle window resize events to keep the scene responsive
    window.addEventListener('resize', () => {
        const newWidth = window.innerWidth || 800;
        const newHeight = window.innerHeight || 600;
        gameContext.camera.aspect = newWidth / newHeight;
        gameContext.camera.updateProjectionMatrix();
        gameContext.renderer.setSize(newWidth, newHeight);
    }, false);
}
