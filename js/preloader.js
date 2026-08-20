// --- ASSET PRELOADER ---
// Preloads heavy assets (GLB models, textures) in the background
// while the user is viewing the main menu

import { loadGLTF } from './gltf-loader.js';

// Cache for preloaded assets
const preloadedAssets = {
    models: new Map(),
    textures: new Map(),
    failedCount: 0,
    isPreloading: false,
    isComplete: false
};

// Quiet preload: deer only (largest remaining asset). Vegetation loads at startGame.
const ASSETS_TO_PRELOAD = {
    models: [
        { key: 'deer', path: 'assets/White_Tailed_Deer_Male.glb' }
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
    
    ASSETS_TO_PRELOAD.models.forEach(asset => {
        loadGLTF(asset.path)
            .then(gltf => {
                preloadedAssets.models.set(asset.key, gltf);
                checkPreloadComplete();
            })
            .catch(() => {
                preloadedAssets.failedCount++;
                checkPreloadComplete();
            });
    });
}

function checkPreloadComplete() {
    const totalAssets = ASSETS_TO_PRELOAD.models.length;
    const loadedAssets = preloadedAssets.models.size;
    const settledAssets = loadedAssets + preloadedAssets.failedCount;

    if (settledAssets >= totalAssets) {
        preloadedAssets.isComplete = true;
        preloadedAssets.isPreloading = false;
    }
}

export function getPreloadedModel(key) {
    return preloadedAssets.models.get(key) || null;
}

export function getPreloadedTexture(key) {
    return preloadedAssets.textures.get(key) || null;
}

export function isPreloadComplete() {
    return preloadedAssets.isComplete;
}

export function getPreloadProgress() {
    const totalAssets = ASSETS_TO_PRELOAD.models.length;
    const settledAssets = preloadedAssets.models.size + preloadedAssets.failedCount;
    return settledAssets / totalAssets;
}
