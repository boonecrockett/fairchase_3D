// --- WORLD GENERATION ---
import * as THREE from 'three';
import { gameContext } from './context.js';
import { ImprovedNoise } from './libs/ImprovedNoise.js';
import { DEFAULT_WORLD_SIZE, INITIAL_PLAYER_X, INITIAL_PLAYER_Z } from './constants.js';
import { createWaterMaterial } from './water-shader.js';
import { loadGLTF } from './gltf-loader.js';
import { getQualitySettings } from './quality-settings.js';
import { SpatialHash2D } from './spatial-hash.js';

// --- Constants for World Generation ---
const WORLD_PLANE_SEGMENTS = 255; // Number of segments for the terrain plane
/** Layer used for invisible vegetation proxies (raycasts only; camera stays on layer 0). */
export const VEGETATION_COLLISION_LAYER = 1;

// Cached Perlin noise instance (reused across all height queries)
const perlin = new ImprovedNoise();

// getHeightAt defaults
const DEFAULT_SINE_COSINE_PARAMS = { freq1: 77.8, amp1: 8, freq2: 40.0, amp2: 4 };
const DEFAULT_PERLIN_PARAMS = { quality: 1, noiseZ: Math.random() * 100, amplitudeScale: 1.75, coordinateScale: 0.02 };
const PERLIN_NOISE_ITERATIONS = 4;
const PERLIN_QUALITY_MULTIPLIER = 5;
const DEFAULT_PERLIN_HEIGHT_MULTIPLIER = 15.0;
const DEFAULT_SINE_COSINE_HEIGHT_MULTIPLIER = 1.0;

// createWater defaults
const DEFAULT_WATER_OPACITY = 0.7;

// findDrinkingSpots defaults
const NUM_DRINKING_SPOTS_PER_BODY = 5;
const DRINKING_SPOT_RADIUS_RAND_FACTOR = 0.4;
const DRINKING_SPOT_RADIUS_MIN_FACTOR = 0.9;
const DRINKING_SPOT_Y_OFFSET = 0.5;
const DRINKING_SPOT_MAX_HEIGHT_ABOVE_WATER = 2;
const FALLBACK_DRINKING_SPOT_POSITION = new THREE.Vector3(100, 0, 100);

// createTrees defaults
const TREE_SPAWN_AVOID_PLAYER_RADIUS = 15;
const TREE_TRUNK_BASE_HEIGHT = 4;
const TREE_TRUNK_RAND_HEIGHT = 2;
const TREE_TRUNK_SCALE_MIN_RADIUS = 0.3;
const TREE_TRUNK_SCALE_MAX_RADIUS = 0.4;
const TREE_TRUNK_SEGMENTS = 8;
const HARDWOOD_LEAVES_BASE_RADIUS = 1.5;
const PINE_CANOPY_BASE_HEIGHT = 5;
const PINE_CANOPY_RAND_HEIGHT = 5;
const PINE_CANOPY_BASE_RADIUS = 3;
const PINE_CANOPY_RAND_RADIUS = 4;
const PINE_CANOPY_SEGMENTS = 16;

/**
 * Creates the terrain geometry for the game world based on the provided configuration.
 * It's then rotated to be horizontal and added to the scene.
 * This function also attaches a `getHeightAt` method to the game context for later use.
 * @param {object} worldConfig - The configuration object for the current world, containing terrain settings.
 */
/**
 * Creates a tiled procedural ground texture (canvas) for terrain PBR look.
 */
function createTerrainAlbedoTexture(baseColorHex) {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    const data = image.data;
    const base = new THREE.Color(baseColorHex);
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    const seed = Math.random() * 80;
    const color = new THREE.Color();

    const tileNoise = (u, v, freq, z) => {
        const x = Math.cos(u * Math.PI * 2) * freq;
        const y = Math.sin(u * Math.PI * 2) * freq;
        const p = Math.cos(v * Math.PI * 2) * freq;
        const q = Math.sin(v * Math.PI * 2) * freq;
        return perlin.noise(x + p * 0.17, q + y * 0.13, z);
    };

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const v = y / size;
            const n1 = tileNoise(u, v, 2.4, seed);
            const n2 = tileNoise(u, v, 6.5, seed + 9);
            const n3 = tileNoise(u, v, 14.0, seed + 18);
            const n4 = tileNoise(u, v, 28.0, seed + 27);
            const n = n1 * 0.5 + n2 * 0.28 + n3 * 0.15 + n4 * 0.07;
            const hue = hsl.h + n2 * 0.035 - 0.02;
            const sat = Math.max(0.18, Math.min(0.42, hsl.s * 0.82 + n3 * 0.04));
            const light = Math.max(0.28, Math.min(0.46, hsl.l * 1.35 + n * 0.07));
            color.setHSL(hue, sat, light);
            const i = (y * size + x) * 4;
            data[i] = Math.round(color.r * 255);
            data[i + 1] = Math.round(color.g * 255);
            data[i + 2] = Math.round(color.b * 255);
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(10, 10);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
}

/**
 * Samples the baked heightmap using the same triangle diagonal as
 * THREE.PlaneGeometry. This keeps physics/placement exactly on the rendered
 * terrain instead of interpolating a different bilinear surface.
 */
function sampleHeightmap(x, z) {
    const hm = gameContext.heightmap;
    if (!hm || !hm.data) return 0;

    const { data, segments, worldSize } = hm;
    const half = worldSize / 2;
    const u = ((x + half) / worldSize) * segments;
    const v = ((z + half) / worldSize) * segments;
    const max = segments;

    const x0 = Math.max(0, Math.min(max - 1, Math.floor(u)));
    const z0 = Math.max(0, Math.min(max - 1, Math.floor(v)));
    const x1 = Math.min(max, x0 + 1);
    const z1 = Math.min(max, z0 + 1);
    const tx = Math.max(0, Math.min(1, u - x0));
    const tz = Math.max(0, Math.min(1, v - z0));

    const gridW = segments + 1;
    const h00 = data[z0 * gridW + x0];
    const h10 = data[z0 * gridW + x1];
    const h01 = data[z1 * gridW + x0];
    const h11 = data[z1 * gridW + x1];

    // PlaneGeometry emits triangles (h00, h01, h10) and
    // (h01, h11, h10), split along the h01→h10 diagonal.
    if (tx + tz <= 1) {
        return h00
            + tx * (h10 - h00)
            + tz * (h01 - h00);
    }

    return h11
        + (1 - tx) * (h01 - h11)
        + (1 - tz) * (h10 - h11);
}

export function createHills(worldConfig) {
    // Guard against missing or invalid worldConfig or terrain property
    const terrainConfig = worldConfig?.terrain || {};
    const size = terrainConfig.size || DEFAULT_WORLD_SIZE;
    const color = terrainConfig.color || 0x3c5224; // Default to a green color
    const segments = WORLD_PLANE_SEGMENTS;
    const gridW = segments + 1;

    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    const positions = geometry.attributes.position;
    const heightData = new Float32Array(gridW * gridW);

    // Three.js PlaneGeometry vertex order: iy outer, ix inner; plane Y is negated.
    // After rotateX(-PI/2): worldX = planeX, worldZ = -planeY, worldY = planeZ (height).
    let vi = 0;
    for (let iy = 0; iy <= segments; iy++) {
        for (let ix = 0; ix <= segments; ix++) {
            const planeX = (ix / segments - 0.5) * size;
            const planeY = -(iy / segments - 0.5) * size;
            const h = computeTerrainHeight(planeX, planeY, worldConfig);
            positions.setZ(vi, h);
            heightData[iy * gridW + ix] = h;
            vi++;
        }
    }

    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();

    const albedo = createTerrainAlbedoTexture(color);
    const material = new THREE.MeshStandardMaterial({
        map: albedo,
        color: 0xffffff,
        roughness: 0.92,
        metalness: 0.0,
        flatShading: false,
    });
    gameContext.terrain = new THREE.Mesh(geometry, material);
    gameContext.terrain.receiveShadow = true;
    gameContext.scene.add(gameContext.terrain);

    gameContext.heightmap = {
        data: heightData,
        segments,
        worldSize: size,
    };
    gameContext.clearHeightCache?.();

    // Terrain is static - update matrix once after creation
    gameContext.terrain.updateMatrixWorld(true);

    // O(1) triangle-exact height sample — smooth and aligned with the mesh
    gameContext.getHeightAt = (x, z) => sampleHeightmap(x, z);
}

/**
 * Calculates the terrain height at a given world-plane coordinate (x, y before plane rotation).
 * Uses either a sine/cosine formula or Perlin noise based on `worldConfig.terrain.generationMethod`.
 * @param {number} x_world_plane - The x-coordinate on the unrotated world plane.
 * @param {number} y_world_plane - The y-coordinate on the unrotated world plane.
 * @param {object} worldConfig - The world configuration object containing terrain parameters.
 * @returns {number} The calculated height (z-coordinate before rotation, y-coordinate after rotation).
 */
function naturalTerrainHeight(x_world_plane, y_world_plane, worldConfig) {
    const terrainConfig = worldConfig.terrain;

    if (terrainConfig.generationMethod === 'sineCosine') {
        const params = terrainConfig.sineCosineParams || DEFAULT_SINE_COSINE_PARAMS;
        const { freq1, amp1, freq2, amp2 } = params;
        let height = Math.sin(x_world_plane / freq1) * Math.cos(y_world_plane / freq1) * amp1;
        height += Math.sin(x_world_plane / freq2) * Math.cos(y_world_plane / freq2) * amp2;
        return height * (terrainConfig.heightMultiplier || DEFAULT_SINE_COSINE_HEIGHT_MULTIPLIER);
    }

    const perlinParams = terrainConfig.perlinParams || DEFAULT_PERLIN_PARAMS;
    const noiseZ = perlinParams.noiseZ !== undefined ? perlinParams.noiseZ : DEFAULT_PERLIN_PARAMS.noiseZ;
    let currentQuality = perlinParams.quality;
    let height = 0;
    for (let iter = 0; iter < PERLIN_NOISE_ITERATIONS; iter++) {
        height += perlin.noise(
            x_world_plane * perlinParams.coordinateScale / currentQuality,
            y_world_plane * perlinParams.coordinateScale / currentQuality,
            noiseZ,
        ) * perlinParams.amplitudeScale;
        currentQuality *= PERLIN_QUALITY_MULTIPLIER;
    }
    return height * (terrainConfig.heightMultiplier || DEFAULT_PERLIN_HEIGHT_MULTIPLIER);
}

function computeTerrainHeight(x_world_plane, y_world_plane, worldConfig) {
    let height = naturalTerrainHeight(x_world_plane, y_world_plane, worldConfig);

    if (worldConfig.environment && worldConfig.environment.waterBodies) {
        for (const waterBody of worldConfig.environment.waterBodies) {
            if (waterBody.shape !== 'circle') continue;
            const pondX = waterBody.position.x || 0;
            const pondZ = waterBody.position.z || 0;
            const pondRadius = waterBody.size / 2;
            const seed = pondSeedFromConfig(waterBody);
            const dx = x_world_plane - pondX;
            const dz = y_world_plane - pondZ;
            const distanceToPond = Math.sqrt(dx * dx + dz * dz);
            const angle = Math.atan2(dz, dx);
            const shore = pondRadiusAtAngle(pondRadius, angle, seed) + pondShoreNoise(dx, dz, seed);
            const inner = shore + 10;
            const outer = shore + 26;
            if (distanceToPond >= outer) continue;

            const pondFloor = naturalTerrainHeight(pondX, pondZ, worldConfig) - 8;
            if (distanceToPond <= inner) {
                height = pondFloor;
            } else {
                const t = (distanceToPond - inner) / (outer - inner);
                const smooth = t * t * (3 - 2 * t);
                height = pondFloor * (1 - smooth) + height * smooth;
            }
        }
    }

    return height;
}

function pondSeedFromConfig(bodyConfig) {
    const x = bodyConfig.position?.x || 0;
    const z = bodyConfig.position?.z || 0;
    const radius = (bodyConfig.size || 80) / 2;
    return x * 0.017 + z * 0.023 + radius * 0.011 + 2.7;
}

function pondRadiusAtAngle(baseRadius, angle, seed) {
    const n1 = Math.sin(angle * 2.0 + seed) * 0.13;
    const n2 = Math.sin(angle * 3.0 - seed * 1.7) * 0.08;
    const n3 = Math.sin(angle * 5.0 + seed * 0.45) * 0.045;
    const n4 = Math.sin(angle * 9.0 - seed * 0.8) * 0.02;
    const ellipse = 1 + 0.18 * Math.cos(2 * angle + seed * 0.9);
    return baseRadius * ellipse * (1 + n1 + n2 + n3 + n4);
}

function pondShoreNoise(dx, dz, seed) {
    return Math.sin(dx * 0.16 + seed) * Math.sin(dz * 0.14 - seed * 1.1) * 2.4
        + Math.sin(dx * 0.31 - dz * 0.22 + seed * 2.0) * 1.1;
}

/**
 * Creates water bodies (lakes, ponds) in the scene based on the `worldConfig`.
 * Populates `gameContext.waterBodies` array.
 * @param {object} worldConfig - The world configuration object, containing `environment.waterBodies` settings.
 */
export function createWater(worldConfig) {
    gameContext.waterBodies = [];
    if (!worldConfig.environment || !worldConfig.environment.waterBodies) return;

    const waterBodies = worldConfig.environment.waterBodies;
    const waterColor = worldConfig.environment.waterColor || 0x4682B4;
    const defaultOpacity = worldConfig.environment.waterOpacity || DEFAULT_WATER_OPACITY;

    waterBodies.forEach(bodyConfig => {
        const radius = bodyConfig.size / 2;
        const seed = pondSeedFromConfig(bodyConfig);
        const meshRadius = radius * 1.65;
        const waterGeometry = new THREE.CircleGeometry(meshRadius, 64);
        waterGeometry.rotateX(-Math.PI / 2);

        const waterMaterial = createWaterMaterial({
            color: waterColor,
            opacity: bodyConfig.opacity || defaultOpacity,
            speed: 0.5,
            rippleScale: 0.12,
            center: new THREE.Vector2(bodyConfig.position?.x || 0, bodyConfig.position?.z || 0),
            baseRadius: radius,
            seed,
            shoreWidth: 4.5,
            useMask: bodyConfig.shape === 'circle',
        });

        const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);

        const waterX = bodyConfig.position.x || 0;
        const waterZ = bodyConfig.position.z || 0;

        let waterY;
        if (gameContext.getHeightAt) {
            waterY = gameContext.getHeightAt(waterX, waterZ) + 0.05;
        } else {
            waterY = bodyConfig.position.y || 0;
        }

        waterMesh.position.set(waterX, waterY, waterZ);
        waterMesh.userData.config = bodyConfig;
        waterMesh.userData.isPond = bodyConfig.shape === 'circle' && bodyConfig.size <= 100;
        waterMesh.userData.baseRadius = radius;
        waterMesh.userData.pondSeed = seed;

        gameContext.scene.add(waterMesh);
        gameContext.waterBodies.push(waterMesh);
    });

    gameContext.waterTime = 0;
}

// Throttle water updates
let waterUpdateAccumulator = 0;
const WATER_UPDATE_INTERVAL = 0.05; // Update every 50ms instead of every frame

/**
 * Updates water animation for subtle ripple effect.
 * Call this from the main game loop with delta time.
 * @param {number} delta - Time since last frame in seconds
 */
export function updateWater(delta) {
    if (!gameContext.waterBodies || gameContext.waterBodies.length === 0) return;
    
    gameContext.waterTime = (gameContext.waterTime || 0) + delta;
    
    // Throttle uniform updates
    waterUpdateAccumulator += delta;
    if (waterUpdateAccumulator < WATER_UPDATE_INTERVAL) return;
    waterUpdateAccumulator = 0;
    
    // Update shader uniforms
    for (let i = 0; i < gameContext.waterBodies.length; i++) {
        const water = gameContext.waterBodies[i];
        if (water.material?.uniforms?.uTime) {
            water.material.uniforms.uTime.value = gameContext.waterTime;
        }
    }
}

/**
 * Identifies and stores potential drinking spots for deer near water bodies.
 * Populates `gameContext.drinkingSpots` array.
 */
export function findDrinkingSpots() {
    gameContext.drinkingSpots = [];

    if (!gameContext.terrain || !gameContext.waterBodies || gameContext.waterBodies.length === 0) {
        gameContext.drinkingSpots.push(FALLBACK_DRINKING_SPOT_POSITION.clone());
        return;
    }

    const waterLevel = gameContext.waterBodies[0].position.y;
    const possibleSpots = [];
    const sampleStep = 8; // world units — avoid allocating per terrain vertex

    for (const water of gameContext.waterBodies) {
        const radius = water.userData?.config ? (water.userData.config.size / 2) : 50;
        const cx = water.position.x;
        const cz = water.position.z;
        const ringInner = Math.max(2, radius - 4);
        const ringOuter = radius + 6;
        for (let angle = 0; angle < Math.PI * 2; angle += 0.15) {
            for (let r = ringInner; r <= ringOuter; r += sampleStep * 0.5) {
                const x = cx + Math.cos(angle) * r;
                const z = cz + Math.sin(angle) * r;
                const height = gameContext.getHeightAt(x, z);
                if (height > waterLevel && height < waterLevel + DRINKING_SPOT_MAX_HEIGHT_ABOVE_WATER) {
                    possibleSpots.push(new THREE.Vector3(x, height + DRINKING_SPOT_Y_OFFSET, z));
                }
            }
        }
    }

    if (possibleSpots.length > 0) {
        const spotsToTake = Math.min(possibleSpots.length, 50);
        for (let i = 0; i < spotsToTake; i++) {
            const randomIndex = Math.floor(Math.random() * possibleSpots.length);
            gameContext.drinkingSpots.push(possibleSpots[randomIndex]);
            possibleSpots.splice(randomIndex, 1);
        }
    }

    if (gameContext.drinkingSpots.length === 0) {
        gameContext.drinkingSpots.push(FALLBACK_DRINKING_SPOT_POSITION.clone());
    }
}

/** Shared vegetation helpers for instanced trees/bushes */
const _placeDummy = new THREE.Object3D();
const _finalMatrix = new THREE.Matrix4();
let _vegProxyMat = null;

function getVegetationProxyMaterial() {
    if (!_vegProxyMat) {
        _vegProxyMat = new THREE.MeshBasicMaterial({
            colorWrite: false,
            depthWrite: false,
        });
    }
    return _vegProxyMat;
}

/**
 * Creates one shared LOS proxy geometry from the authored model bounds.
 * The marker parent applies the same per-instance scale as the rendered model.
 */
function createVegetationProxyGeometry(modelRoot, type) {
    modelRoot.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(modelRoot);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const horizontalSize = Math.max(size.x, size.z);
    const radiusFactor = type === 'tree' ? 0.32 : 0.42;
    const heightFactor = type === 'tree' ? 0.95 : 0.9;
    const radius = Math.max(0.5, horizontalSize * radiusFactor);
    const height = Math.max(1, size.y * heightFactor);
    const geometry = new THREE.CylinderGeometry(radius * 0.8, radius, height, 8);
    geometry.translate(center.x, bounds.min.y + height / 2, center.z);
    geometry.userData.modelRadius = radius;
    return geometry;
}

function collectMeshTemplates(modelRoot) {
    modelRoot.updateMatrixWorld(true);
    const templates = [];
    const rootInverse = new THREE.Matrix4().copy(modelRoot.matrixWorld).invert();
    modelRoot.traverse((child) => {
        if (!child.isMesh) return;
        const localMatrix = new THREE.Matrix4().multiplyMatrices(rootInverse, child.matrixWorld);
        const material = Array.isArray(child.material) ? child.material[0] : child.material;
        if (material) {
            material.side = THREE.DoubleSide;
        }
        templates.push({
            geometry: child.geometry,
            material,
            localMatrix,
        });
    });
    return templates;
}

function createInstancedMeshes(templates, count, castShadow, receiveShadow, namePrefix) {
    const meshes = templates.map((t, idx) => {
        const mesh = new THREE.InstancedMesh(t.geometry, t.material, count);
        mesh.name = `${namePrefix}_${idx}`;
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
        mesh.frustumCulled = false;
        mesh.count = 0;
        return mesh;
    });
    return meshes;
}

function setInstanceTransform(meshes, templates, index, x, y, z, rotY, scaleX, scaleY, scaleZ) {
    _placeDummy.position.set(x, y, z);
    _placeDummy.rotation.set(0, rotY, 0);
    _placeDummy.scale.set(scaleX, scaleY, scaleZ);
    _placeDummy.updateMatrix();
    for (let m = 0; m < meshes.length; m++) {
        _finalMatrix.multiplyMatrices(_placeDummy.matrix, templates[m].localMatrix);
        meshes[m].setMatrixAt(index, _finalMatrix);
    }
}

function finalizeInstancedMeshes(meshes) {
    for (const mesh of meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
    }
}

function isSubmergedOrNearWater(x, z, terrainHeight, buffer = 1) {
    if (!gameContext.waterBodies) return false;
    for (const water of gameContext.waterBodies) {
        const dwx = x - water.position.x;
        const dwz = z - water.position.z;
        const dist = Math.sqrt(dwx * dwx + dwz * dwz);
        const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50;
        if (dist < waterRadius + buffer && terrainHeight < water.position.y + 1) {
            return true;
        }
    }
    return false;
}

function addVegetationMarker(group, x, y, z, scale, radiusFactor, hash, proxyGeometry) {
    const marker = new THREE.Object3D();
    marker.position.set(x, y, z);
    marker.scale.setScalar(scale);
    marker.userData.isVegetationCollider = true;
    marker.userData.collisionRadius = (scale || 1) * radiusFactor;
    const modelRadius = proxyGeometry?.userData?.modelRadius;
    marker.userData.foliageRadius = modelRadius
        ? modelRadius * scale
        : marker.userData.collisionRadius;

    const proxy = new THREE.Mesh(
        proxyGeometry,
        getVegetationProxyMaterial(),
    );
    proxy.layers.set(VEGETATION_COLLISION_LAYER);
    marker.add(proxy);
    // Keep marker on default layer so map/clones can see hierarchy; proxy alone is layer 1
    group.add(marker);

    if (hash) {
        hash.insert({
            x, z, scale,
            radius: marker.userData.collisionRadius,
            foliageRadius: marker.userData.foliageRadius,
            object: marker,
        });
    }
    return marker;
}

/**
 * Procedurally generates and places trees in the game world.
 * Uses InstancedMesh for draw calls; Object3D markers for collision/LOS.
 * @param {object} worldConfig - The world configuration, containing vegetation settings.
 */
export async function createTrees(worldConfig) {
    const quality = getQualitySettings();
    const worldSize = worldConfig.terrain.size || DEFAULT_WORLD_SIZE;
    const baseCount = worldConfig.vegetation.treeCount || 50;
    const treeCount = Math.max(10, Math.floor(baseCount * quality.treeDensity));
    const treesGroup = new THREE.Group();
    treesGroup.name = 'trees';
    gameContext.trees = treesGroup;
    gameContext.scene.add(gameContext.trees);
    gameContext.treeHash = new SpatialHash2D(20);
    gameContext.treeInstancedMeshes = [];

    const castShadow = !!quality.treeCastShadow;

    try {
        const gltf = await loadGLTF('assets/landscapes/tree.glb');
        const treeModel = gltf.scene;
        treeModel.position.set(0, 0, 0);
        treeModel.rotation.set(0, 0, 0);
        treeModel.scale.set(1, 1, 1);

        const templates = collectMeshTemplates(treeModel);
        if (templates.length === 0) throw new Error('Tree model has no meshes');
        const proxyGeometry = createVegetationProxyGeometry(treeModel, 'tree');

        const meshes = createInstancedMeshes(templates, treeCount, castShadow, true, 'tree');
        meshes.forEach((m) => gameContext.scene.add(m));
        gameContext.treeInstancedMeshes = meshes;

        let placed = 0;
        let attempts = 0;
        const maxAttempts = treeCount * 8;
        while (placed < treeCount && attempts < maxAttempts) {
            attempts++;
            const x = Math.random() * worldSize - worldSize / 2;
            const z = Math.random() * worldSize - worldSize / 2;
            const terrainHeight = gameContext.getHeightAt(x, z);
            if (isSubmergedOrNearWater(x, z, terrainHeight, 0)) continue;

            const dx = x - INITIAL_PLAYER_X;
            const dz = z - INITIAL_PLAYER_Z;
            if (Math.sqrt(dx * dx + dz * dz) < TREE_SPAWN_AVOID_PLAYER_RADIUS) continue;

            const scale = (Math.random() * (worldConfig.vegetation.treeScale.max - worldConfig.vegetation.treeScale.min) + worldConfig.vegetation.treeScale.min);
            const rotY = Math.random() * Math.PI * 2;
            const y = terrainHeight - 0.5;

            setInstanceTransform(meshes, templates, placed, x, y, z, rotY, scale, scale, scale);
            addVegetationMarker(
                treesGroup,
                x,
                y,
                z,
                scale,
                1.8,
                gameContext.treeHash,
                proxyGeometry,
            );
            placed++;
        }

        for (const mesh of meshes) mesh.count = placed;
        finalizeInstancedMeshes(meshes);
    } catch (error) {
        console.warn('Tree GLB failed, using procedural fallback', error);
        const canopyMaterial = new THREE.MeshLambertMaterial({ color: worldConfig.vegetation.canopyColor });
        const trunkMaterial = new THREE.MeshLambertMaterial({ color: worldConfig.vegetation.trunkColor });
        const trunkGeo = new THREE.CylinderGeometry(TREE_TRUNK_SCALE_MIN_RADIUS, TREE_TRUNK_SCALE_MAX_RADIUS, TREE_TRUNK_BASE_HEIGHT, TREE_TRUNK_SEGMENTS);
        const canopyGeo = new THREE.DodecahedronGeometry(HARDWOOD_LEAVES_BASE_RADIUS);
        const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMaterial, treeCount);
        const canopyMesh = new THREE.InstancedMesh(canopyGeo, canopyMaterial, treeCount);
        const proxyGeometry = new THREE.CylinderGeometry(1.5, 2, 12, 8);
        proxyGeometry.translate(0, 6, 0);
        proxyGeometry.userData.modelRadius = 2;
        trunkMesh.castShadow = castShadow;
        canopyMesh.castShadow = castShadow;
        trunkMesh.receiveShadow = true;
        canopyMesh.receiveShadow = true;
        gameContext.scene.add(trunkMesh, canopyMesh);
        gameContext.treeInstancedMeshes = [trunkMesh, canopyMesh];

        let placed = 0;
        for (let i = 0; i < treeCount * 4 && placed < treeCount; i++) {
            const x = Math.random() * worldSize - worldSize / 2;
            const z = Math.random() * worldSize - worldSize / 2;
            const terrainHeight = gameContext.getHeightAt(x, z);
            if (isSubmergedOrNearWater(x, z, terrainHeight, 0)) continue;
            const dx = x - INITIAL_PLAYER_X;
            const dz = z - INITIAL_PLAYER_Z;
            if (Math.sqrt(dx * dx + dz * dz) < TREE_SPAWN_AVOID_PLAYER_RADIUS) continue;
            const scale = (Math.random() * (worldConfig.vegetation.treeScale.max - worldConfig.vegetation.treeScale.min) + worldConfig.vegetation.treeScale.min);
            const rotY = Math.random() * Math.PI * 2;
            const trunkH = (TREE_TRUNK_BASE_HEIGHT + Math.random() * TREE_TRUNK_RAND_HEIGHT) * scale;

            _placeDummy.position.set(x, terrainHeight + trunkH / 2, z);
            _placeDummy.rotation.set(0, rotY, 0);
            _placeDummy.scale.set(scale, scale, scale);
            _placeDummy.updateMatrix();
            trunkMesh.setMatrixAt(placed, _placeDummy.matrix);

            _placeDummy.position.set(x, terrainHeight + trunkH, z);
            _placeDummy.updateMatrix();
            canopyMesh.setMatrixAt(placed, _placeDummy.matrix);

            addVegetationMarker(
                treesGroup,
                x,
                terrainHeight,
                z,
                scale,
                1.8,
                gameContext.treeHash,
                proxyGeometry,
            );
            placed++;
        }
        trunkMesh.count = placed;
        canopyMesh.count = placed;
        finalizeInstancedMeshes([trunkMesh, canopyMesh]);
    }
}

/**
 * Procedurally generates and places bush thickets via InstancedMesh.
 * @param {object} worldConfig - The world configuration, containing vegetation settings.
 */
export async function createBushes(worldConfig) {
    const quality = getQualitySettings();
    const vegetationConfig = worldConfig.vegetation || {};
    const bushesGroup = new THREE.Group();
    bushesGroup.name = 'bushes';
    gameContext.bushes = bushesGroup;
    gameContext.scene.add(gameContext.bushes);
    gameContext.bushHash = new SpatialHash2D(20);
    gameContext.bushInstancedMeshes = [];

    const worldSize = worldConfig.terrain.size || DEFAULT_WORLD_SIZE;
    const baseThickets = vegetationConfig.bushCount || Math.floor((worldConfig.vegetation.treeCount || 50) / 4);
    const thicketCount = Math.max(0, Math.floor(baseThickets * quality.bushDensity));
    if (thicketCount === 0) return;

    const maxBushes = thicketCount * 5;
    const castShadow = !!quality.treeCastShadow;

    try {
        const gltf = await loadGLTF('assets/landscapes/bush.glb');
        const bushModel = gltf.scene;
        bushModel.position.set(0, 0, 0);
        bushModel.rotation.set(0, 0, 0);
        bushModel.scale.set(1, 1, 1);

        const templates = collectMeshTemplates(bushModel);
        if (templates.length === 0) throw new Error('Bush model has no meshes');
        const proxyGeometry = createVegetationProxyGeometry(bushModel, 'bush');

        const meshes = createInstancedMeshes(templates, maxBushes, castShadow, true, 'bush');
        meshes.forEach((m) => gameContext.scene.add(m));
        gameContext.bushInstancedMeshes = meshes;

        let placed = 0;
        for (let i = 0; i < thicketCount && placed < maxBushes; i++) {
            let centerX, centerZ, centerHeight;
            const placeNearWater = Math.random() < 0.3 && gameContext.waterBodies && gameContext.waterBodies.length > 0;

            if (placeNearWater) {
                const water = gameContext.waterBodies[Math.floor(Math.random() * gameContext.waterBodies.length)];
                const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50;
                const angle = Math.random() * Math.PI * 2;
                const distFromWater = waterRadius + 5 + Math.random() * 10;
                centerX = water.position.x + Math.cos(angle) * distFromWater;
                centerZ = water.position.z + Math.sin(angle) * distFromWater;
                centerHeight = gameContext.getHeightAt(centerX, centerZ);
            } else {
                centerX = Math.random() * worldSize - worldSize / 2;
                centerZ = Math.random() * worldSize - worldSize / 2;
                centerHeight = gameContext.getHeightAt(centerX, centerZ);
            }

            let tooCloseToWater = false;
            for (const water of gameContext.waterBodies || []) {
                const dwx = centerX - water.position.x;
                const dwz = centerZ - water.position.z;
                const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50;
                if (Math.sqrt(dwx * dwx + dwz * dwz) < waterRadius + 3) {
                    tooCloseToWater = true;
                    break;
                }
            }
            if (tooCloseToWater) continue;

            const spDx = centerX - INITIAL_PLAYER_X;
            const spDz = centerZ - INITIAL_PLAYER_Z;
            if (Math.sqrt(spDx * spDx + spDz * spDz) < TREE_SPAWN_AVOID_PLAYER_RADIUS) continue;

            const bushesInThicket = 2 + Math.floor(Math.random() * 4);
            const thicketRadius = 3 + Math.random() * 4;

            for (let j = 0; j < bushesInThicket && placed < maxBushes; j++) {
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.random() * thicketRadius;
                const bushX = centerX + Math.cos(angle) * distance;
                const bushZ = centerZ + Math.sin(angle) * distance;
                const bushHeight = gameContext.getHeightAt(bushX, bushZ);

                let bushTooCloseToWater = false;
                for (const water of gameContext.waterBodies || []) {
                    const dwx = bushX - water.position.x;
                    const dwz = bushZ - water.position.z;
                    const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50;
                    if (Math.sqrt(dwx * dwx + dwz * dwz) < waterRadius + 2) {
                        bushTooCloseToWater = true;
                        break;
                    }
                }
                if (bushTooCloseToWater) continue;

                let scale;
                const sizeRandom = Math.random();
                if (sizeRandom < 0.4) scale = 0.15 + Math.random() * 0.15;
                else if (sizeRandom < 0.8) scale = 0.3 + Math.random() * 0.2;
                else scale = 0.5 + Math.random() * 0.25;

                const sinkDepth = 0.5 + scale * 0.5;
                const y = bushHeight - sinkDepth;
                const rotY = Math.random() * Math.PI * 2;
                setInstanceTransform(meshes, templates, placed, bushX, y, bushZ, rotY, scale, scale, scale);
                addVegetationMarker(
                    bushesGroup,
                    bushX,
                    y,
                    bushZ,
                    scale,
                    1.5,
                    gameContext.bushHash,
                    proxyGeometry,
                );
                placed++;
            }
        }

        for (const mesh of meshes) mesh.count = placed;
        finalizeInstancedMeshes(meshes);
    } catch (error) {
        console.warn('Bush GLB failed', error);
    }
}

/**
 * Procedurally generates and places grass throughout the game world.
 * Creates scattered grass patches for natural-looking ground cover.
 * @param {object} worldConfig - The world configuration, containing vegetation settings.
 * @returns {Promise} Resolves when grass is loaded and placed
 */
export function createGrass(worldConfig) {
    const quality = getQualitySettings();

    return new Promise((resolve) => {
        loadGLTF('assets/landscapes/redgrass1.glb').then((gltf) => {
            let grassGeometry = null;
            let grassMaterial = null;
            let modelBoundingBox = null;

            gltf.scene.traverse((child) => {
                if (child.isMesh && !grassGeometry) {
                    grassGeometry = child.geometry;
                    grassGeometry.computeBoundingBox();
                    modelBoundingBox = grassGeometry.boundingBox;
                    if (child.material) {
                        grassMaterial = child.material;
                        if (Array.isArray(grassMaterial)) grassMaterial = grassMaterial[0];
                        grassMaterial.side = THREE.DoubleSide;
                        grassMaterial.alphaTest = Math.max(grassMaterial.alphaTest || 0, 0.4);
                        if ('shininess' in grassMaterial) grassMaterial.shininess = 0;
                        if ('specular' in grassMaterial) grassMaterial.specular = new THREE.Color(0x000000);
                        if ('reflectivity' in grassMaterial) grassMaterial.reflectivity = 0;
                        grassMaterial.color.setHex(0xc4d44a);
                        grassMaterial.needsUpdate = true;
                    }
                }
            });

            if (!grassGeometry || !grassMaterial) {
                console.warn('No mesh found in grass model');
                resolve();
                return;
            }

            if (!gameContext.terrain || !gameContext.terrain.geometry) {
                console.warn('Terrain not ready, skipping grass');
                resolve();
                return;
            }

            const vegetationConfig = worldConfig?.environment?.vegetation || {};
            const grassDensity = (vegetationConfig.grassDensity || 0.8) * quality.grassDensity;
            const worldSize = worldConfig?.terrain?.size || DEFAULT_WORLD_SIZE;

            const extraScatter = quality.nearGrassCount || 0;
            const numGrassClusters = Math.floor((worldSize * worldSize * grassDensity) / 6500);
            const maxPlantsPerCluster = 50;
            const maxInstances = numGrassClusters * maxPlantsPerCluster + extraScatter;

            const instancedMesh = new THREE.InstancedMesh(grassGeometry, grassMaterial, maxInstances);
            instancedMesh.receiveShadow = true;
            instancedMesh.castShadow = false;
            instancedMesh.frustumCulled = false;
            instancedMesh.name = 'grass';

            const dummy = new THREE.Object3D();
            let instanceIndex = 0;
            gameContext.terrain.updateMatrixWorld(true);
            const grassClusterPositions = [];
            gameContext.grassHash = new SpatialHash2D(15);

            const recordGrass = (grassX, grassZ, scale) => {
                gameContext.grassHash.insert({
                    x: grassX,
                    z: grassZ,
                    radius: Math.max(0.7, scale * 12),
                });
            };

            for (let i = 0; i < numGrassClusters; i++) {
                const clusterCenterX = (Math.random() - 0.5) * worldSize * 0.9;
                const clusterCenterZ = (Math.random() - 0.5) * worldSize * 0.9;
                const clusterCenterHeight = gameContext.getHeightAt(clusterCenterX, clusterCenterZ);
                if (clusterCenterHeight === null) continue;
                if (isGrassInWater(clusterCenterX, clusterCenterHeight, clusterCenterZ)) continue;

                const plantsInCluster = 18 + Math.floor(Math.random() * 10);
                const clusterRadius = 6 + Math.random() * 6;
                grassClusterPositions.push({ x: clusterCenterX, z: clusterCenterZ, radius: clusterRadius });

                for (let j = 0; j < plantsInCluster; j++) {
                    if (instanceIndex >= maxInstances) break;
                    const angle = Math.random() * Math.PI * 2;
                    const distance = Math.random() * clusterRadius;
                    const grassX = clusterCenterX + Math.cos(angle) * distance;
                    const grassZ = clusterCenterZ + Math.sin(angle) * distance;
                    const grassHeight = gameContext.getHeightAt(grassX, grassZ);
                    if (grassHeight === null || grassHeight === undefined) continue;
                    if (isGrassInWater(grassX, grassHeight, grassZ)) continue;

                    const scale = placeGrassClump(dummy, grassX, grassZ, grassHeight, modelBoundingBox, 0.07, 0.04);
                    instancedMesh.setMatrixAt(instanceIndex, dummy.matrix);
                    recordGrass(grassX, grassZ, scale);
                    instanceIndex++;
                }
            }

            for (let i = 0; i < extraScatter && instanceIndex < maxInstances; i++) {
                const grassX = (Math.random() - 0.5) * worldSize * 0.9;
                const grassZ = (Math.random() - 0.5) * worldSize * 0.9;
                const grassHeight = gameContext.getHeightAt(grassX, grassZ);
                if (grassHeight === null || grassHeight === undefined) continue;
                if (isGrassInWater(grassX, grassHeight, grassZ)) continue;
                const scale = placeGrassClump(dummy, grassX, grassZ, grassHeight, modelBoundingBox, 0.07, 0.04);
                instancedMesh.setMatrixAt(instanceIndex, dummy.matrix);
                recordGrass(grassX, grassZ, scale);
                instanceIndex++;
            }

            instancedMesh.count = instanceIndex;
            instancedMesh.instanceMatrix.needsUpdate = true;
            instancedMesh.computeBoundingSphere();
            gameContext.grass = instancedMesh;
            gameContext.grassClusterPositions = grassClusterPositions;
            gameContext.scene.add(instancedMesh);
            gameContext.shaderGrass = null;
            gameContext.updateGrassWind = null;

            resolve();
        }).catch((error) => {
            console.error('Failed to load grass model:', error);
            resolve();
        });
    });
}

function isGrassInWater(x, y, z) {
    if (!gameContext.waterBodies) return false;
    for (const water of gameContext.waterBodies) {
        const dx = x - water.position.x;
        const dz = z - water.position.z;
        const radius = (water.userData?.config?.size / 2 || 50) + 8;
        if (dx * dx + dz * dz < radius * radius && y < water.position.y + 2) {
            return true;
        }
    }
    return false;
}

function placeGrassClump(dummy, x, z, y, modelBoundingBox, minScale, scaleRange) {
    const scale = minScale + Math.random() * scaleRange;
    const yOffset = modelBoundingBox ? modelBoundingBox.min.z * scale : 0;
    dummy.position.set(x, y + yOffset, z);
    dummy.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI * 2);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    return scale;
}

export function createGroundCover(worldConfig) {
    return new Promise((resolve) => {
    // Use setTimeout to avoid blocking the main thread
    setTimeout(() => {
        const worldSize = worldConfig?.terrain?.size || DEFAULT_WORLD_SIZE;
        
        // Create simple grass blade geometry (thin triangular blade)
        const bladeWidth = 0.1;
        const bladeHeight = 0.25; // Short ankle-high grass
        
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([
            -bladeWidth/2, 0, 0,           // bottom left
            bladeWidth/2, 0, 0,            // bottom right
            0, bladeHeight, 0,             // top center
        ]);
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();
        
        // Natural grass green material
        const material = new THREE.MeshLambertMaterial({
            color: 0x4a7f2e,  // Forest grass green
            side: THREE.DoubleSide,
        });
        
        // Reasonable grass count - 10,000 max for performance
        const grassCount = Math.min(10000, Math.floor(worldSize * worldSize * 0.04));
        const instancedGrass = new THREE.InstancedMesh(geometry, material, grassCount);
        instancedGrass.name = 'groundCover';
        instancedGrass.receiveShadow = true;
        
        const dummy = new THREE.Object3D();
        let instanceIndex = 0;
        
        for (let i = 0; i < grassCount; i++) {
            const x = (Math.random() - 0.5) * worldSize * 0.95;
            const z = (Math.random() - 0.5) * worldSize * 0.95;
            const y = gameContext.getHeightAt ? gameContext.getHeightAt(x, z) : 0;
            
            // Skip if in water
            let inWater = false;
            if (gameContext.waterBodies) {
                for (const water of gameContext.waterBodies) {
                    const dist = Math.sqrt((x - water.position.x) ** 2 + (z - water.position.z) ** 2);
                    const radius = water.userData?.config?.size / 2 || 50;
                    if (dist < radius + 2) {
                        inWater = true;
                        break;
                    }
                }
            }
            if (inWater) continue;
            
            // Skip near player spawn
            const spDx = x - INITIAL_PLAYER_X;
            const spDz = z - INITIAL_PLAYER_Z;
            if (Math.sqrt(spDx * spDx + spDz * spDz) < 5) continue;
            
            // Random scale and rotation for natural variety
            const scale = 0.8 + Math.random() * 0.8; // 0.8-1.6 scale
            const rotY = Math.random() * Math.PI * 2;
            
            dummy.position.set(x, y, z);
            dummy.rotation.set(0, rotY, 0);
            dummy.scale.set(scale, scale + Math.random() * 0.5, scale);
            dummy.updateMatrix();
            
            instancedGrass.setMatrixAt(instanceIndex, dummy.matrix);
            instanceIndex++;
        }
        
        instancedGrass.count = instanceIndex;
        instancedGrass.instanceMatrix.needsUpdate = true;
        instancedGrass.computeBoundingSphere(); // Required for r151+ frustum culling
        
        gameContext.groundCover = instancedGrass;
        gameContext.scene.add(instancedGrass);
        
        resolve();
    }, 100); // Delay to let other initialization complete first
    });
}

/**
 * Checks if there is water at the specified coordinates.
 * @param {number} x - X coordinate to check
 * @param {number} z - Z coordinate to check
 * @returns {boolean} True if there is water at the specified position
 */
export function isWaterAt(x, z) {
    if (!gameContext.waterBodies || gameContext.waterBodies.length === 0) {
        return false;
    }
    
    // Check if position is within any water body
    for (const waterBody of gameContext.waterBodies) {
        const waterX = waterBody.position.x;
        const waterZ = waterBody.position.z;
        const waterY = waterBody.position.y;
        const dx = x - waterX;
        const dz = z - waterZ;
        const distance = Math.sqrt(dx * dx + dz * dz);

        let waterRadius = 10;
        if (waterBody.userData?.baseRadius) {
            const angle = Math.atan2(dz, dx);
            waterRadius = pondRadiusAtAngle(
                waterBody.userData.baseRadius,
                angle,
                waterBody.userData.pondSeed || 0,
            ) + pondShoreNoise(dx, dz, waterBody.userData.pondSeed || 0);
        } else if (waterBody.userData?.config) {
            waterRadius = waterBody.userData.config.size / 2;
        }

        if (distance <= waterRadius - 0.4) {
            // Get the terrain height at this position (cached to avoid per-frame raycasts)
            const terrainHeight = gameContext.getCachedHeightAt(x, z);
            
            // Player is in water only if:
            // 1. They are within the water radius AND
            // 2. The terrain at their position is at or below water level
            // Use a small tolerance (0.3) for slight terrain variations
            if (terrainHeight <= waterY + 0.3) {
                return true;
            }
        }
    }
    
    return false;
}
