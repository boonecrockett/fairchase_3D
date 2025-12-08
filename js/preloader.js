// --- ASSET PRELOADER ---
// Preloads heavy assets (GLB models, textures) in the background
// while the user is viewing the main menu

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

// Cache for preloaded assets
const preloadedAssets = {
    models: new Map(),
    textures: new Map(),
    isPreloading: false,
    isComplete: false
};

// List of assets to preload
const ASSETS_TO_PRELOAD = {
    models: [
        { key: 'tree', path: 'assets/landscapes/tree.glb' },
        { key: 'bush', path: 'assets/landscapes/bush.glb' },
        { key: 'grass', path: 'assets/landscapes/redgrass1.glb' },
        { key: 'deer', path: 'assets/animals/deer.glb' }
    ],
    textures: [
        { key: 'deer_track', path: 'assets/textures/deer_track.png' },
        { key: 'human_track', path: 'assets/textures/human_track.png' },
        { key: 'blood', path: 'assets/textures/blood.png' }
    ]
};

/**
 * Start preloading assets in the background
 * Call this as early as possible (e.g., when showing the main menu)
 */
export function startPreloading() {
    if (preloadedAssets.isPreloading || preloadedAssets.isComplete) {
        return; // Already preloading or done
    }
    
    preloadedAssets.isPreloading = true;
    console.log('📦 PRELOADER: Starting background asset preload...');
    
    const gltfLoader = new GLTFLoader();
    const textureLoader = new THREE.TextureLoader();
    
    // Preload models (don't await - let them load in background)
    ASSETS_TO_PRELOAD.models.forEach(asset => {
        gltfLoader.loadAsync(asset.path)
            .then(gltf => {
                preloadedAssets.models.set(asset.key, gltf);
                console.log(`📦 PRELOADER: Loaded model '${asset.key}'`);
                checkPreloadComplete();
            })
            .catch(err => {
                console.warn(`📦 PRELOADER: Failed to preload model '${asset.key}':`, err);
                checkPreloadComplete();
            });
    });
    
    // Preload textures
    ASSETS_TO_PRELOAD.textures.forEach(asset => {
        textureLoader.load(
            asset.path,
            (texture) => {
                preloadedAssets.textures.set(asset.key, texture);
                console.log(`📦 PRELOADER: Loaded texture '${asset.key}'`);
                checkPreloadComplete();
            },
            undefined,
            (err) => {
                console.warn(`📦 PRELOADER: Failed to preload texture '${asset.key}':`, err);
                checkPreloadComplete();
            }
        );
    });
}

/**
 * Check if all assets are preloaded
 */
function checkPreloadComplete() {
    const totalAssets = ASSETS_TO_PRELOAD.models.length + ASSETS_TO_PRELOAD.textures.length;
    const loadedAssets = preloadedAssets.models.size + preloadedAssets.textures.size;
    
    if (loadedAssets >= totalAssets) {
        preloadedAssets.isComplete = true;
        preloadedAssets.isPreloading = false;
        console.log('📦 PRELOADER: All assets preloaded!');
    }
}

/**
 * Get a preloaded model (returns null if not yet loaded)
 * @param {string} key - The model key (e.g., 'tree', 'bush', 'deer')
 * @returns {Object|null} The GLTF object or null
 */
export function getPreloadedModel(key) {
    return preloadedAssets.models.get(key) || null;
}

/**
 * Get a preloaded texture (returns null if not yet loaded)
 * @param {string} key - The texture key
 * @returns {THREE.Texture|null} The texture or null
 */
export function getPreloadedTexture(key) {
    return preloadedAssets.textures.get(key) || null;
}

/**
 * Check if preloading is complete
 * @returns {boolean}
 */
export function isPreloadComplete() {
    return preloadedAssets.isComplete;
}

/**
 * Get preload progress (0-1)
 * @returns {number}
 */
export function getPreloadProgress() {
    const totalAssets = ASSETS_TO_PRELOAD.models.length + ASSETS_TO_PRELOAD.textures.length;
    const loadedAssets = preloadedAssets.models.size + preloadedAssets.textures.size;
    return loadedAssets / totalAssets;
}
