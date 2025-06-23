// --- WORLD GENERATION ---
import * as THREE from 'three';
import { gameContext } from './context.js';
import { ImprovedNoise } from './libs/ImprovedNoise.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DEFAULT_WORLD_SIZE } from './constants.js';

// --- Constants for World Generation ---
const WORLD_PLANE_SEGMENTS = 63; // Number of segments for the terrain plane width and depth

// getHeightAt defaults
const DEFAULT_SINE_COSINE_PARAMS = { freq1: 77.8, amp1: 8, freq2: 40.0, amp2: 4 };
const DEFAULT_PERLIN_PARAMS = { quality: 1, noiseZ: undefined, amplitudeScale: 1.75, coordinateScale: 0.02 };
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
export function createHills(worldConfig) {
    // Guard against missing or invalid worldConfig or terrain property
    const terrainConfig = worldConfig?.terrain || {};
    const size = terrainConfig.size || DEFAULT_WORLD_SIZE;
    const color = terrainConfig.color || 0x3c5224; // Default to a green color

    const geometry = new THREE.PlaneGeometry(size, size, WORLD_PLANE_SEGMENTS, WORLD_PLANE_SEGMENTS);
    const positions = geometry.attributes.position;

    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        positions.setZ(i, getHeightAt(x, y, worldConfig));
    }

    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({ color: color });
    gameContext.terrain = new THREE.Mesh(geometry, material);
    gameContext.terrain.receiveShadow = true;
    gameContext.scene.add(gameContext.terrain);

    // Attach a function to the context that can get the height at any world coordinate (x, z)
    gameContext.getHeightAt = (x, z) => getHeightAt(x, z, worldConfig);
}

/**
 * Calculates the terrain height at a given world-plane coordinate (x, y before plane rotation).
 * Uses either a sine/cosine formula or Perlin noise based on `worldConfig.terrain.generationMethod`.
 * @param {number} x_world_plane - The x-coordinate on the unrotated world plane.
 * @param {number} y_world_plane - The y-coordinate on the unrotated world plane.
 * @param {object} worldConfig - The world configuration object containing terrain parameters.
 * @returns {number} The calculated height (z-coordinate before rotation, y-coordinate after rotation).
 */
function getHeightAt(x_world_plane, y_world_plane, worldConfig) {
    let height;
    const terrainConfig = worldConfig.terrain;

    if (terrainConfig.generationMethod === 'sineCosine') {
        const params = terrainConfig.sineCosineParams || DEFAULT_SINE_COSINE_PARAMS;
        const { freq1, amp1, freq2, amp2 } = params;
        height = Math.sin(x_world_plane / freq1) * Math.cos(y_world_plane / freq1) * amp1;
        height += Math.sin(x_world_plane / freq2) * Math.cos(y_world_plane / freq2) * amp2;
        return height * (terrainConfig.heightMultiplier || DEFAULT_SINE_COSINE_HEIGHT_MULTIPLIER);
    } else { // Default to Perlin noise
        const perlin = new ImprovedNoise();
        const perlinParams = terrainConfig.perlinParams || DEFAULT_PERLIN_PARAMS;
        const quality = perlinParams.quality;
        const noiseZ = perlinParams.noiseZ === undefined ? Math.random() * 100 : perlinParams.noiseZ; // Allow specific seed or random
        const amplitudeScale = perlinParams.amplitudeScale;
        const coordinateScale = perlinParams.coordinateScale;
        
        let currentQuality = quality;
        height = 0;
        for (let iter = 0; iter < PERLIN_NOISE_ITERATIONS; iter++) {
            height += perlin.noise(
                x_world_plane * coordinateScale / currentQuality,
                y_world_plane * coordinateScale / currentQuality,
                noiseZ
            ) * amplitudeScale; // Removed incorrect '* currentQuality'
            currentQuality *= PERLIN_QUALITY_MULTIPLIER;
        }
        return height * (terrainConfig.heightMultiplier || DEFAULT_PERLIN_HEIGHT_MULTIPLIER);
    }
}

/**
 * Creates water bodies (lakes, ponds) in the scene based on the `worldConfig`.
 * Populates `gameContext.waterBodies` array.
 * @param {object} worldConfig - The world configuration object, containing `environment.waterBodies` settings.
 */
export function createWater(worldConfig) {
    gameContext.waterBodies = [];
    if (!worldConfig.environment) return;

    const waterLevel = worldConfig.environment.waterLevel || 0; // Default water level at y=0
    const worldSize = worldConfig.terrain.size || DEFAULT_WORLD_SIZE;

    const waterGeometry = new THREE.PlaneGeometry(worldSize, worldSize);
    const waterMaterial = new THREE.MeshBasicMaterial({
        color: worldConfig.environment.waterColor,
        transparent: true,
        opacity: worldConfig.environment.waterOpacity || DEFAULT_WATER_OPACITY,
        side: THREE.DoubleSide
    });

    const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.y = waterLevel;
    gameContext.scene.add(waterMesh);
    gameContext.waterBodies.push(waterMesh);
}

/**
 * Identifies and stores potential drinking spots for deer near water bodies.
 * Populates `gameContext.drinkingSpots` array.
 */
export function findDrinkingSpots() {
    gameContext.drinkingSpots = [];

    if (!gameContext.terrain || !gameContext.waterBodies || gameContext.waterBodies.length === 0) {
        // console.warn("Cannot find drinking spots without terrain and water."); // Logging disabled
        gameContext.drinkingSpots.push(FALLBACK_DRINKING_SPOT_POSITION.clone());
        return;
    }

    const waterLevel = gameContext.waterBodies[0].position.y;
    const terrainGeo = gameContext.terrain.geometry;
    const positions = terrainGeo.attributes.position;
    const possibleSpots = [];

    // Systematically scan all terrain vertices for valid shoreline spots
    for (let i = 0; i < positions.count; i++) {
        const localPos = new THREE.Vector3().fromBufferAttribute(positions, i);
        const worldPos = gameContext.terrain.localToWorld(localPos.clone());
        const height = worldPos.y;

        // Check if the vertex is on land and within the valid height range above water
        if (height > waterLevel && height < waterLevel + DRINKING_SPOT_MAX_HEIGHT_ABOVE_WATER) {
            possibleSpots.push(worldPos);
        }
    }

    // If we found possible spots, select a subset of them randomly
    if (possibleSpots.length > 0) {
        const spotsToTake = Math.min(possibleSpots.length, 50); // Take up to 50 spots
        for (let i = 0; i < spotsToTake; i++) {
            const randomIndex = Math.floor(Math.random() * possibleSpots.length);
            const spot = possibleSpots[randomIndex].clone();
            spot.y += DRINKING_SPOT_Y_OFFSET;
            gameContext.drinkingSpots.push(spot);
            possibleSpots.splice(randomIndex, 1); // Avoid picking the same spot twice
        }
    }

    if (gameContext.drinkingSpots.length === 0) {
        // console.warn("No valid drinking spots found after scanning terrain, adding a fallback."); // Logging disabled
        gameContext.drinkingSpots.push(FALLBACK_DRINKING_SPOT_POSITION.clone());
    }
}

/**
 * Procedurally generates and places trees in the game world.
 * Populates `gameContext.trees` (a THREE.Group) and adds it to the scene.
 * @param {object} worldConfig - The world configuration, containing vegetation settings.
 */
export async function createTrees(worldConfig) {
    const worldSize = worldConfig.terrain.size || DEFAULT_WORLD_SIZE;
    const treeCount = worldConfig.vegetation.treeCount;
    const treesGroup = new THREE.Group();
    gameContext.trees = treesGroup;
    gameContext.scene.add(gameContext.trees);

    const loader = new GLTFLoader();

    try {
        const gltf = await loader.loadAsync('assets/landscapes/tree.glb');
        const treeModel = gltf.scene;

        treeModel.traverse(node => {
            if (node.isMesh) {
                node.castShadow = true;
            }
        });

        for (let i = 0; i < treeCount; i++) {
            const x = Math.random() * worldSize - worldSize / 2;
            const z = Math.random() * worldSize - worldSize / 2;
            const terrainHeight = gameContext.getHeightAt(x, z);

            let isSubmerged = false;
            for (const water of gameContext.waterBodies) {
                const distanceToWaterCenter = new THREE.Vector2(x - water.position.x, z - water.position.z).length();
                const waterRadius = water.geometry.parameters.radius || (water.geometry.parameters.width / 2);
                if (distanceToWaterCenter < waterRadius && terrainHeight < water.position.y + 1) {
                    isSubmerged = true;
                    break;
                }
            }
            if (isSubmerged) continue;

            if (new THREE.Vector3(x, terrainHeight, z).distanceTo(new THREE.Vector3(0, gameContext.getHeightAt(0, 10), 10)) < TREE_SPAWN_AVOID_PLAYER_RADIUS) {
                continue;
            }

            const treeInstance = treeModel.clone();
            const scale = (Math.random() * (worldConfig.vegetation.treeScale.max - worldConfig.vegetation.treeScale.min) + worldConfig.vegetation.treeScale.min) * 0.81;
            treeInstance.scale.set(scale, scale, scale);
            // Position tree at terrain height - Y is the vertical axis after terrain rotation
            treeInstance.position.set(x, terrainHeight, z);
            treeInstance.rotation.y = Math.random() * Math.PI * 2;
            treesGroup.add(treeInstance);
        }
    } catch (error) {
        // console.error("Failed to load tree model, falling back to procedural trees.", error); // Logging disabled
        
        // --- Procedural Fallback ---
        const canopyMaterial = new THREE.MeshLambertMaterial({ color: worldConfig.vegetation.canopyColor });
        const trunkMaterial = new THREE.MeshLambertMaterial({ color: worldConfig.vegetation.trunkColor });

        for (let i = 0; i < treeCount; i++) {
            const x = Math.random() * worldSize - worldSize / 2;
            const z = Math.random() * worldSize - worldSize / 2;
            const terrainHeight = gameContext.getHeightAt(x, z);

            let isSubmerged = false;
            for (const water of gameContext.waterBodies) {
                const distanceToWaterCenter = new THREE.Vector2(x - water.position.x, z - water.position.z).length();
                const waterRadius = water.geometry.parameters.radius || (water.geometry.parameters.width / 2);
                if (distanceToWaterCenter < waterRadius && terrainHeight < water.position.y + 1) {
                    isSubmerged = true;
                    break;
                }
            }
            if (isSubmerged) continue;

            if (new THREE.Vector3(x, terrainHeight, z).distanceTo(new THREE.Vector3(0, gameContext.getHeightAt(0, 10), 10)) < TREE_SPAWN_AVOID_PLAYER_RADIUS) {
                continue;
            }

            const tree = new THREE.Group();
            const scale = (Math.random() * (worldConfig.vegetation.treeScale.max - worldConfig.vegetation.treeScale.min) + worldConfig.vegetation.treeScale.min) * 0.81;

            const trunkHeight = (TREE_TRUNK_BASE_HEIGHT + Math.random() * TREE_TRUNK_RAND_HEIGHT) * scale;
            const trunkGeometry = new THREE.CylinderGeometry(TREE_TRUNK_SCALE_MIN_RADIUS * scale, TREE_TRUNK_SCALE_MAX_RADIUS * scale, trunkHeight, TREE_TRUNK_SEGMENTS);
            const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
            trunk.position.y = trunkHeight / 2;
            trunk.castShadow = true;
            tree.add(trunk);

            let canopy;
            const treeType = worldConfig.vegetation.treeType || 'pine';

            if (treeType === 'hardwood') {
                const leavesRadius = (HARDWOOD_LEAVES_BASE_RADIUS + Math.random()) * scale;
                canopy = new THREE.Mesh(new THREE.DodecahedronGeometry(leavesRadius), canopyMaterial);
                canopy.position.y = trunkHeight;
            } else {
                const canopyHeight = (PINE_CANOPY_BASE_HEIGHT + Math.random() * PINE_CANOPY_RAND_HEIGHT) * scale;
                const canopyRadius = (PINE_CANOPY_BASE_RADIUS + Math.random() * PINE_CANOPY_RAND_RADIUS) * scale;
                canopy = new THREE.Mesh(new THREE.ConeGeometry(canopyRadius, canopyHeight, PINE_CANOPY_SEGMENTS), canopyMaterial);
                canopy.position.y = trunkHeight;
            }

            canopy.castShadow = true;
            tree.add(canopy);

            // Position tree at terrain height - Y is the vertical axis after terrain rotation
            tree.position.set(x, terrainHeight, z);
            treesGroup.add(tree);
        }
    }
}

/**
 * Procedurally generates and places bush thickets in the game world.
 * Creates small clusters of bushes for natural-looking vegetation.
 * @param {object} worldConfig - The world configuration, containing vegetation settings.
 */
export async function createBushes(worldConfig) {
    const worldSize = worldConfig.terrain.size || DEFAULT_WORLD_SIZE;
    // Create fewer bush thickets than trees - about 1/4 the density
    const thicketCount = Math.floor((worldConfig.vegetation.treeCount || 50) / 4);
    const bushesGroup = new THREE.Group();
    gameContext.bushes = bushesGroup;
    gameContext.scene.add(gameContext.bushes);

    const loader = new GLTFLoader();

    try {
        const gltf = await loader.loadAsync('assets/landscapes/bush.glb');
        const bushModel = gltf.scene;

        bushModel.traverse(node => {
            if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = true;
            }
        });

        for (let i = 0; i < thicketCount; i++) {
            // Create a thicket center point
            const centerX = Math.random() * worldSize - worldSize / 2;
            const centerZ = Math.random() * worldSize - worldSize / 2;
            const centerHeight = gameContext.getHeightAt(centerX, centerZ);

            // Check if thicket center is submerged
            let isSubmerged = false;
            for (const water of gameContext.waterBodies) {
                const distanceToWaterCenter = new THREE.Vector2(centerX - water.position.x, centerZ - water.position.z).length();
                const waterRadius = water.geometry.parameters.radius || (water.geometry.parameters.width / 2);
                if (distanceToWaterCenter < waterRadius && centerHeight < water.position.y + 1) {
                    isSubmerged = true;
                    break;
                }
            }
            if (isSubmerged) continue;

            // Avoid player spawn area
            if (new THREE.Vector3(centerX, centerHeight, centerZ).distanceTo(new THREE.Vector3(0, gameContext.getHeightAt(0, 10), 10)) < TREE_SPAWN_AVOID_PLAYER_RADIUS) {
                continue;
            }

            // Create 2-5 bushes in a small cluster around the center point
            const bushesInThicket = 2 + Math.floor(Math.random() * 4); // 2-5 bushes
            const thicketRadius = 3 + Math.random() * 4; // 3-7 unit radius

            for (let j = 0; j < bushesInThicket; j++) {
                // Position bushes randomly within the thicket radius
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.random() * thicketRadius;
                const bushX = centerX + Math.cos(angle) * distance;
                const bushZ = centerZ + Math.sin(angle) * distance;
                const bushHeight = gameContext.getHeightAt(bushX, bushZ);

                // Check if this bush position is submerged
                let bushSubmerged = false;
                for (const water of gameContext.waterBodies) {
                    const distanceToWaterCenter = new THREE.Vector2(bushX - water.position.x, bushZ - water.position.z).length();
                    const waterRadius = water.geometry.parameters.radius || (water.geometry.parameters.width / 2);
                    if (distanceToWaterCenter < waterRadius && bushHeight < water.position.y + 1) {
                        bushSubmerged = true;
                        break;
                    }
                }
                if (bushSubmerged) continue;

                const bushInstance = bushModel.clone();
                
                // Create varied bush sizes with weighted distribution
                // Small bushes (deer body height): 40% chance, scale 0.15-0.3 (reduced by 50%)
                // Medium bushes: 40% chance, scale 0.3-0.5 (reduced by 50%)
                // Large bushes: 20% chance, scale 0.5-0.75 (reduced by 50%)
                let scale;
                const sizeRandom = Math.random();
                if (sizeRandom < 0.4) {
                    // Small bushes - deer can hide behind with head showing
                    scale = 0.15 + Math.random() * 0.15; // 0.15-0.3 (was 0.3-0.6)
                } else if (sizeRandom < 0.8) {
                    // Medium bushes - standard size
                    scale = 0.3 + Math.random() * 0.2; // 0.3-0.5 (was 0.6-1.0)
                } else {
                    // Large bushes - taller cover
                    scale = 0.5 + Math.random() * 0.25; // 0.5-0.75 (was 1.0-1.5)
                }
                
                bushInstance.scale.set(scale, scale, scale);
                // Bushes should be smaller than trees - scale between 0.5 and 1.2
                // const scale = 0.5 + Math.random() * 0.7;
                // bushInstance.scale.set(scale, scale, scale);
                // Position bush at terrain height
                bushInstance.position.set(bushX, bushHeight, bushZ);
                bushInstance.rotation.y = Math.random() * Math.PI * 2;
                bushesGroup.add(bushInstance);
            }
        }

    } catch (error) {
        // console.error("Failed to load bush model:", error); // Logging disabled
        // No fallback for bushes - they're decorative
    }
}
