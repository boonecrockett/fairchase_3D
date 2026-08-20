import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

let sharedLoader = null;
let sharedDraco = null;
const gltfPromiseCache = new Map();

/**
 * Returns a shared GLTFLoader with Draco support for compressed assets.
 */
export function createGLTFLoader() {
    if (sharedLoader) return sharedLoader;

    sharedDraco = new DRACOLoader();
    // Google-hosted decoders; matches Draco used by gltf-transform optimize
    sharedDraco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    sharedDraco.setDecoderConfig({ type: 'js' });

    sharedLoader = new GLTFLoader();
    sharedLoader.setDRACOLoader(sharedDraco);
    return sharedLoader;
}

/**
 * Loads and parses each GLTF path once. Import-time deer loading, menu
 * preloading, and world creation all share the same promise and decoded data.
 */
export function loadGLTF(path) {
    if (gltfPromiseCache.has(path)) {
        return gltfPromiseCache.get(path);
    }

    const promise = createGLTFLoader()
        .loadAsync(path)
        .catch((error) => {
            gltfPromiseCache.delete(path);
            throw error;
        });
    gltfPromiseCache.set(path, promise);
    return promise;
}
