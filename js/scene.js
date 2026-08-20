// js/scene.js
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { gameContext } from './context.js';
import { getQualitySettings, loadQualityPreference } from './quality-settings.js';

const DEFAULT_SKY_COLOR = 0x6ca0dc;

function configureRenderer(renderer, quality, width, height) {
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = quality.shadowEnabled;
    renderer.shadowMap.type = quality.softShadows
        ? THREE.PCFSoftShadowMap
        : THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = quality.shadowEnabled;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
}

function createRenderer(quality, width, height) {
    const renderer = new THREE.WebGLRenderer({
        antialias: quality.antialias,
        alpha: true,
        powerPreference: 'high-performance',
    });
    configureRenderer(renderer, quality, width, height);
    return renderer;
}

/**
 * Sets up the main Three.js scene, camera, renderer, lighting, and event listeners.
 * Populates the shared gameContext object with essential scene components.
 */
export function setupScene() {
    loadQualityPreference();
    const quality = getQualitySettings();

    if (!gameContext.scene) {
        gameContext.scene = new THREE.Scene();
    }
    gameContext.scene.fog = new THREE.Fog(DEFAULT_SKY_COLOR, 50, quality.fogFar);

    const width = window.innerWidth || 800;
    const height = window.innerHeight || 600;
    
    if (!gameContext.camera) {
        gameContext.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, quality.cameraFar);
    } else {
        gameContext.camera.far = quality.cameraFar;
        gameContext.camera.fov = gameContext.camera.fov || 60;
        gameContext.camera.updateProjectionMatrix();
    }

    if (!gameContext.renderer) {
        gameContext.renderer = createRenderer(quality, width, height);
        document.body.appendChild(gameContext.renderer.domElement);
    } else {
        applyQualityToRenderer(quality);
    }
    
    // Remove prior lights/sky if re-setup
    if (gameContext.scene.sun) {
        gameContext.scene.remove(gameContext.scene.sun);
        gameContext.scene.remove(gameContext.scene.sun.target);
    }
    if (gameContext.scene.ambientLight) {
        gameContext.scene.remove(gameContext.scene.ambientLight);
    }
    if (gameContext.scene.hemiLight) {
        gameContext.scene.remove(gameContext.scene.hemiLight);
    }
    if (gameContext.sky) {
        gameContext.scene.remove(gameContext.sky);
        gameContext.sky = null;
    }

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(100, 100, 50);
    light.castShadow = quality.shadowEnabled;
    const shadowSize = quality.shadowMapSize;
    light.shadow.mapSize.width = shadowSize;
    light.shadow.mapSize.height = shadowSize;
    light.shadow.camera.near = 1;
    light.shadow.camera.far = 300;
    light.shadow.camera.left = -40;
    light.shadow.camera.right = 40;
    light.shadow.camera.top = 40;
    light.shadow.camera.bottom = -40;
    light.shadow.bias = -0.001;
    light.shadow.normalBias = 0.02;
    gameContext.scene.add(light);
    gameContext.scene.add(light.target);

    const ambientLight = new THREE.AmbientLight(0x404040, 0.55);
    gameContext.scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xb1d0ff, 0x6a8a42, 0.42);
    gameContext.scene.add(hemiLight);

    // Physical-ish sky dome
    const sky = new Sky();
    sky.scale.setScalar(450000);
    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 6;
    skyUniforms['rayleigh'].value = 1.8;
    skyUniforms['mieCoefficient'].value = 0.004;
    skyUniforms['mieDirectionalG'].value = 0.8;
    gameContext.scene.add(sky);
    gameContext.sky = sky;

    gameContext.scene.sun = light;
    gameContext.scene.ambientLight = ambientLight;
    gameContext.scene.hemiLight = hemiLight;

    gameContext.clock.reset();
    gameContext.clock.connect(document);

    _shadowBoundsInitialized = false;
}

/**
 * Apply quality settings to an existing renderer (e.g. menu change before start).
 */
export function applyQualityToRenderer(quality = getQualitySettings()) {
    let renderer = gameContext.renderer;
    if (!renderer) return;

    const contextAntialias = !!renderer.getContext()
        .getContextAttributes()
        ?.antialias;

    // Antialiasing is immutable after WebGL context creation. Recreate the
    // renderer when this preset bit changes, preserving the canvas position.
    if (contextAntialias !== quality.antialias) {
        const oldRenderer = renderer;
        const oldCanvas = oldRenderer.domElement;
        const parent = oldCanvas.parentNode;
        const replacement = createRenderer(
            quality,
            window.innerWidth || 800,
            window.innerHeight || 600,
        );

        if (parent) {
            parent.replaceChild(replacement.domElement, oldCanvas);
        }
        oldRenderer.dispose();
        oldRenderer.forceContextLoss();
        gameContext.renderer = replacement;
        renderer = replacement;
    } else {
        configureRenderer(
            renderer,
            quality,
            window.innerWidth || 800,
            window.innerHeight || 600,
        );
    }

    if (gameContext.camera) {
        gameContext.camera.far = quality.cameraFar;
        gameContext.camera.updateProjectionMatrix();
    }
    if (gameContext.scene?.fog) {
        gameContext.scene.fog.far = quality.fogFar;
    }
    if (gameContext.scene?.sun) {
        gameContext.scene.sun.castShadow = quality.shadowEnabled;
        gameContext.scene.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
        if (gameContext.scene.sun.shadow.map) {
            gameContext.scene.sun.shadow.map.dispose();
            gameContext.scene.sun.shadow.map = null;
        }
    }
}

// Pre-computed shadow offset to avoid creating new Vector3 every frame
const _shadowOffset = new THREE.Vector3(100, 100, 50).normalize().multiplyScalar(150);
const _shadowOffsetScratch = new THREE.Vector3();
const SHADOW_LIGHT_DISTANCE = 150;
const _skySun = new THREE.Vector3();

let _shadowBoundsInitialized = false;

/**
 * Updates the shadow camera to follow the player and maintain consistent shadow coverage
 */
export function updateShadowCamera() {
    if (!gameContext.scene?.sun || !gameContext.camera) return;
    if (!gameContext.renderer?.shadowMap?.enabled) return;

    const light = gameContext.scene.sun;
    const playerPosition = gameContext.camera.position;

    let offset;
    if (gameContext.sunDirection) {
        offset = _shadowOffsetScratch
            .copy(gameContext.sunDirection)
            .multiplyScalar(SHADOW_LIGHT_DISTANCE);
    } else {
        offset = _shadowOffset;
    }
    light.position.copy(playerPosition).add(offset);

    light.target.position.copy(playerPosition);
    light.target.updateMatrixWorld();

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

/**
 * Sync Three.js Sky sun position with the directional light / time of day.
 */
export function updateSkySun() {
    if (!gameContext.sky || !gameContext.sunDirection) return;
    _skySun.copy(gameContext.sunDirection);
    gameContext.sky.material.uniforms['sunPosition'].value.copy(_skySun);
}
