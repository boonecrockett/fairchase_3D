// --- WORLD GENERATION ---
import * as THREE from 'three';
import { gameContext } from './context.js';
import { ImprovedNoise } from './libs/ImprovedNoise.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DEFAULT_WORLD_SIZE } from './constants.js';
import { createGrassShaderMaterial, createGrassBladeGeometry, updateGrassWind } from './grass-shader.js';
import { createWaterMaterial } from './water-shader.js';

// --- Constants for World Generation ---
const WORLD_PLANE_SEGMENTS = 63; // Number of segments for the terrain plane

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

    // Create a raycaster for accurate terrain height detection
    const terrainRaycaster = new THREE.Raycaster();
    
    // Attach a function to the context that raycasts against the actual terrain mesh
    // This ensures objects are placed on the visible terrain, not the mathematical approximation
    gameContext.getHeightAt = (x, z) => {
        // Ensure terrain world matrix is up to date for accurate raycasting
        if (gameContext.terrain) {
            gameContext.terrain.updateMatrixWorld(true);
        }
        
        // Raycast from above the terrain downward
        const rayOrigin = new THREE.Vector3(x, 500, z);
        const rayDirection = new THREE.Vector3(0, -1, 0);
        terrainRaycaster.set(rayOrigin, rayDirection);
        
        const intersects = terrainRaycaster.intersectObject(gameContext.terrain);
        if (intersects.length > 0) {
            return intersects[0].point.y;
        }
        
        // Fallback to mathematical calculation if raycast fails
        return getHeightAt(x, z, worldConfig);
    };
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
        height = height * (terrainConfig.heightMultiplier || DEFAULT_SINE_COSINE_HEIGHT_MULTIPLIER);
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
        height = height * (terrainConfig.heightMultiplier || DEFAULT_PERLIN_HEIGHT_MULTIPLIER);
    }

    // Apply pond depressions if water bodies exist
    if (worldConfig.environment && worldConfig.environment.waterBodies) {
        for (const waterBody of worldConfig.environment.waterBodies) {
            if (waterBody.shape === 'circle') {
                const pondX = waterBody.position.x || 0;
                const pondZ = waterBody.position.z || 0;
                const pondRadius = waterBody.size / 2;
                
                // Calculate distance from this point to pond center
                const distanceToPond = Math.sqrt(
                    (x_world_plane - pondX) * (x_world_plane - pondX) + 
                    (y_world_plane - pondZ) * (y_world_plane - pondZ)
                );
                
                // Create depression with very smooth cosine falloff for natural-looking edges
                const transitionZone = pondRadius * 1.5; // Wider transition for smoother appearance
                if (distanceToPond < transitionZone) {
                    const depressionDepth = 10;
                    // Use smoothstep-like cosine interpolation for very smooth edges
                    const t = distanceToPond / transitionZone;
                    const smoothFactor = 0.5 * (1 + Math.cos(t * Math.PI)); // Cosine falloff: 1 at center, 0 at edge
                    height -= depressionDepth * smoothFactor;
                }
            }
        }
    }

    return height;
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
        let waterGeometry;
        
        if (bodyConfig.shape === 'circle') {
            // Create smooth circular pond using CircleGeometry for perfect edges
            const radius = bodyConfig.size / 2;
            const segments = 128; // High segment count for very smooth circle
            
            // Use built-in CircleGeometry for smooth edges
            waterGeometry = new THREE.CircleGeometry(radius, segments);
            // Rotate to be horizontal (CircleGeometry is vertical by default)
            waterGeometry.rotateX(-Math.PI / 2);
            
        } else {
            // Fallback to simple plane for other shapes
            waterGeometry = new THREE.PlaneGeometry(bodyConfig.size, bodyConfig.size);
            waterGeometry.rotateX(-Math.PI / 2);
        }

        // Create animated water shader material
        const waterMaterial = createWaterMaterial({
            color: waterColor,
            opacity: bodyConfig.opacity || defaultOpacity,
            speed: 0.5,
            rippleScale: 0.12,
        });

        const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
        
        // Position the water body
        waterMesh.position.set(
            bodyConfig.position.x || 0,
            bodyConfig.position.y || 0,
            bodyConfig.position.z || 0
        );
        waterMesh.position.y -= 0.1; // Slightly lower water level
        
        // Store original config for easy removal/modification
        waterMesh.userData.config = bodyConfig;
        waterMesh.userData.isPond = bodyConfig.shape === 'circle' && bodyConfig.size <= 100;
        
        gameContext.scene.add(waterMesh);
        gameContext.waterBodies.push(waterMesh);
    });
    
    // Store water animation time
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
                // Get water radius from stored config instead of geometry parameters
                const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50; // Default 50 unit radius
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
            const scale = (Math.random() * (worldConfig.vegetation.treeScale.max - worldConfig.vegetation.treeScale.min) + worldConfig.vegetation.treeScale.min);
            treeInstance.scale.set(scale, scale, scale);
            // Position tree slightly into the ground (-0.5) to ensure it's always grounded
            treeInstance.position.set(x, terrainHeight - 0.5, z);
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
                // Get water radius from stored config instead of geometry parameters
                const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50; // Default 50 unit radius
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
                        const scale = (Math.random() * (worldConfig.vegetation.treeScale.max - worldConfig.vegetation.treeScale.min) + worldConfig.vegetation.treeScale.min);

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
            tree.rotation.y = Math.random() * Math.PI * 2;
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
    const vegetationConfig = worldConfig.vegetation || {};
    const bushDensity = vegetationConfig.bushDensity || 0.6; // Default density

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

        const worldSize = worldConfig.terrain.size || DEFAULT_WORLD_SIZE;
        
        // Create fewer bush thickets than trees - about 1/4 the density
        const thicketCount = Math.floor((worldConfig.vegetation.treeCount || 50) / 4);

        for (let i = 0; i < thicketCount; i++) {
            // Create a thicket center point
            let centerX, centerZ, centerHeight;
            
            // 30% chance to place bushes around water edges (but not in water)
            const placeNearWater = Math.random() < 0.3 && gameContext.waterBodies && gameContext.waterBodies.length > 0;
            
            if (placeNearWater) {
                // Pick a random water body and place bushes around its edge
                const water = gameContext.waterBodies[Math.floor(Math.random() * gameContext.waterBodies.length)];
                const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50;
                const angle = Math.random() * Math.PI * 2;
                // Place 5-15 units outside the water edge
                const distFromWater = waterRadius + 5 + Math.random() * 10;
                centerX = water.position.x + Math.cos(angle) * distFromWater;
                centerZ = water.position.z + Math.sin(angle) * distFromWater;
                centerHeight = gameContext.getHeightAt(centerX, centerZ);
            } else {
                centerX = Math.random() * worldSize - worldSize / 2;
                centerZ = Math.random() * worldSize - worldSize / 2;
                centerHeight = gameContext.getHeightAt(centerX, centerZ);
            }

            // Check if thicket center is submerged or too close to water
            let tooCloseToWater = false;
            for (const water of gameContext.waterBodies) {
                const distanceToWaterCenter = new THREE.Vector2(centerX - water.position.x, centerZ - water.position.z).length();
                const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50;
                // Keep bushes at least 3 units outside water edge
                if (distanceToWaterCenter < waterRadius + 3) {
                    tooCloseToWater = true;
                    break;
                }
            }
            if (tooCloseToWater) continue;

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

                // Check if this bush position is too close to water
                let bushTooCloseToWater = false;
                for (const water of gameContext.waterBodies) {
                    const distanceToWaterCenter = new THREE.Vector2(bushX - water.position.x, bushZ - water.position.z).length();
                    const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50;
                    // Keep individual bushes at least 2 units outside water edge
                    if (distanceToWaterCenter < waterRadius + 2) {
                        bushTooCloseToWater = true;
                        break;
                    }
                }
                if (bushTooCloseToWater) continue;

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
                // Position bush at terrain height, sunk into ground to ensure grounding
                // Sink depth based on scale to keep bushes anchored
                const sinkDepth = 0.5 + scale * 0.5;
                bushInstance.position.set(bushX, bushHeight - sinkDepth, bushZ);
                bushInstance.rotation.y = Math.random() * Math.PI * 2;
                bushesGroup.add(bushInstance);
            }
        }

    } catch (error) {
        // console.error("Failed to load bush model:", error); // Logging disabled
    }
}

/**
 * Procedurally generates and places grass throughout the game world.
 * Creates scattered grass patches for natural-looking ground cover.
 * @param {object} worldConfig - The world configuration, containing vegetation settings.
 * @returns {Promise} Resolves when grass is loaded and placed
 */
export function createGrass(worldConfig) {
    console.log('🌿 GRASS: Starting grass creation...');
    const loader = new GLTFLoader();
    
    return new Promise((resolve, reject) => {
        // Delay to ensure terrain is fully ready
        setTimeout(() => {
            loader.load('assets/landscapes/redgrass1.glb', (gltf) => {
                console.log('🌿 GRASS: Model loaded successfully');
                
                let grassGeometry = null;
                let grassMaterial = null;
                
                // Find the first mesh to use as a template
                let modelBoundingBox = null;
            gltf.scene.traverse((child) => {
                if (child.isMesh && !grassGeometry) {
                    grassGeometry = child.geometry;
                    
                    // Compute bounding box to find model's vertical extent
                    grassGeometry.computeBoundingBox();
                    modelBoundingBox = grassGeometry.boundingBox;
                    
                    if (child.material) {
                        grassMaterial = child.material;
                        if (Array.isArray(grassMaterial)) grassMaterial = grassMaterial[0];
                        
                        grassMaterial.side = THREE.DoubleSide;
                        grassMaterial.shininess = 0;
                        grassMaterial.specular = new THREE.Color(0x000000);
                        grassMaterial.reflectivity = 0;
                        grassMaterial.color.setHex(0xc4d44a);
                        grassMaterial.needsUpdate = true;
                    }
                }
            });
            
            // Log model bounds to understand its origin
            if (modelBoundingBox) {
                console.log('🌿 GRASS: Model bounding box:', modelBoundingBox.min.y, 'to', modelBoundingBox.max.y);
            }

            if (!grassGeometry || !grassMaterial) {
                console.warn('No mesh found in grass model');
                return;
            }

            // Check terrain is ready
            if (!gameContext.terrain || !gameContext.terrain.geometry) {
                console.warn('🌿 GRASS: Terrain not ready, skipping brush creation');
                return;
            }
            
            console.log('🌿 GRASS: Terrain ready, proceeding with placement... v2');

            const vegetationConfig = worldConfig?.environment?.vegetation || {};
            const grassDensity = vegetationConfig.grassDensity || 0.8;
            const worldSize = worldConfig?.terrain?.size || DEFAULT_WORLD_SIZE;
            
            const numGrassClusters = Math.floor((worldSize * worldSize * grassDensity) / 8000);
            const maxPlantsPerCluster = 80;
            const maxInstances = numGrassClusters * maxPlantsPerCluster;

            const instancedMesh = new THREE.InstancedMesh(grassGeometry, grassMaterial, maxInstances);
            instancedMesh.receiveShadow = true;
            instancedMesh.castShadow = false;
            instancedMesh.name = 'grass';

            const dummy = new THREE.Object3D();
            let instanceIndex = 0;
            
            // Ensure terrain world matrix is updated before raycasting
            gameContext.terrain.updateMatrixWorld(true);
            
            // Test terrain height at multiple points to verify raycasting works
            const testHeight1 = gameContext.getHeightAt(0, 0);
            const testHeight2 = gameContext.getHeightAt(100, 0);
            const testHeight3 = gameContext.getHeightAt(-100, 0);
            const testHeight4 = gameContext.getHeightAt(0, 100);
            console.log('🌿 GRASS: Test heights - origin:', testHeight1.toFixed(2), 'x+100:', testHeight2.toFixed(2), 'x-100:', testHeight3.toFixed(2), 'z+100:', testHeight4.toFixed(2));
            
            // Debug: Check if water body exists and log its position
            if (gameContext.waterBodies && gameContext.waterBodies.length > 0) {
                const water = gameContext.waterBodies[0];
                console.log('🌿 GRASS: Water body at:', water.position.x.toFixed(2), water.position.y.toFixed(2), water.position.z.toFixed(2));
                // Test height at water center
                const waterCenterHeight = gameContext.getHeightAt(water.position.x, water.position.z);
                console.log('🌿 GRASS: Terrain height at water center:', waterCenterHeight.toFixed(2), 'Water Y:', water.position.y.toFixed(2));
            }
            
            // Track min/max heights for debugging
            let minHeight = Infinity, maxHeight = -Infinity;
            let sampleCount = 0;
            
            // Store grass cluster positions for collision/sound detection
            const grassClusterPositions = [];

            for (let i = 0; i < numGrassClusters; i++) {
                // Random position for cluster
                const clusterCenterX = (Math.random() - 0.5) * worldSize * 0.9;
                const clusterCenterZ = (Math.random() - 0.5) * worldSize * 0.9;
                const clusterCenterHeight = gameContext.getHeightAt(clusterCenterX, clusterCenterZ);
                
                if (clusterCenterHeight === null) continue;
                
                // Skip if in water
                let isSubmerged = false;
                if (gameContext.waterBodies) {
                    for (const water of gameContext.waterBodies) {
                        const dist = new THREE.Vector2(clusterCenterX - water.position.x, clusterCenterZ - water.position.z).length();
                        const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50;
                        if (dist < waterRadius && clusterCenterHeight < water.position.y + 0.5) {
                            isSubmerged = true;
                            break;
                        }
                    }
                }
                if (isSubmerged) continue;
                
                // Skip near player spawn
                if (Math.sqrt(clusterCenterX * clusterCenterX + (clusterCenterZ - 10) ** 2) < 10) continue;
                
                const plantsInCluster = 40 + Math.floor(Math.random() * 11);
                const clusterRadius = 1.5 + Math.random() * 2;
                
                // Store cluster position for sound/collision detection
                // Use slightly larger radius for detection since grass visually spreads a bit
                const detectionRadius = clusterRadius * 1.2;
                grassClusterPositions.push({ x: clusterCenterX, z: clusterCenterZ, radius: detectionRadius });
                
                for (let j = 0; j < plantsInCluster; j++) {
                    if (instanceIndex >= maxInstances) break;

                    const angle = Math.random() * Math.PI * 2;
                    const distance = Math.random() * clusterRadius;
                    const grassX = clusterCenterX + Math.cos(angle) * distance;
                    const grassZ = clusterCenterZ + Math.sin(angle) * distance;
                    
                    const grassHeight = gameContext.getHeightAt(grassX, grassZ);
                    if (grassHeight === null || grassHeight === undefined) continue;
                    
                    // Skip if in water
                    let grassSubmerged = false;
                    if (gameContext.waterBodies) {
                        for (const water of gameContext.waterBodies) {
                            const dist = new THREE.Vector2(grassX - water.position.x, grassZ - water.position.z).length();
                            const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50;
                            if (dist < waterRadius && grassHeight < water.position.y + 0.2) {
                                grassSubmerged = true;
                                break;
                            }
                        }
                    }
                    if (grassSubmerged) continue;
                    
                    const baseScale = 0.12 + Math.random() * 0.08;
                    
                    // Track height range
                    if (grassHeight < minHeight) minHeight = grassHeight;
                    if (grassHeight > maxHeight) maxHeight = grassHeight;
                    sampleCount++;
                    
                    // The model is rotated 90 degrees on X axis, so original Z becomes Y
                    // After rotation: original Z-min (-17.77) becomes the bottom of the model
                    // We need to offset DOWN by the scaled min.z value to place the base at ground level
                    // Since min.z is negative (-17.77), multiplying by scale and adding moves it down
                    const yOffset = modelBoundingBox ? modelBoundingBox.min.z * baseScale : 0;
                    
                    dummy.position.set(grassX, grassHeight + yOffset, grassZ);
                    dummy.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI * 2);
                    dummy.scale.set(baseScale, baseScale, baseScale);
                    dummy.updateMatrix();
                    
                    instancedMesh.setMatrixAt(instanceIndex, dummy.matrix);
                    instanceIndex++;
                }
            }
            
            // Log height range and offset used for grass placement
            const sampleOffset = modelBoundingBox ? modelBoundingBox.min.z * 0.15 : 0;
            console.log(`🌿 GRASS: Height range - min: ${minHeight.toFixed(2)}, max: ${maxHeight.toFixed(2)}, samples: ${sampleCount}`);
            console.log(`🌿 GRASS: Model min.z: ${modelBoundingBox?.min.z}, yOffset at scale 0.15: ${sampleOffset.toFixed(2)}`);
            
            instancedMesh.count = instanceIndex;
            instancedMesh.instanceMatrix.needsUpdate = true; // Force matrix update
            gameContext.grass = instancedMesh;
            gameContext.grassClusterPositions = grassClusterPositions;
            gameContext.scene.add(instancedMesh);
            console.log(`🌿 GRASS: Created ${instanceIndex} grass instances in ${grassClusterPositions.length} clusters`);
            
            resolve(); // Grass loading complete
        }, 
        undefined,
        (error) => {
            console.error('🌿 GRASS: Failed to load grass model:', error);
            reject(error);
        });
    }, 1000); // Wait 1 second for terrain to be ready
    });
}

/**
 * Creates efficient GPU shader-based grass with wind animation.
 * This is more performant than model-based grass and includes realistic wind effects.
 * @param {object} worldConfig - The world configuration, containing vegetation settings.
 */
export function createShaderGrass(worldConfig) {
    const vegetationConfig = worldConfig?.environment?.vegetation || {};
    const grassDensity = vegetationConfig.grassDensity || 0.8;
    const worldSize = worldConfig?.terrain?.size || DEFAULT_WORLD_SIZE;
    
    // Use procedural geometry and shader material
    const grassGeometry = createGrassBladeGeometry();
    const grassMaterial = createGrassShaderMaterial();
    
    // Higher density for shader grass since it's more efficient
    const grassCount = Math.floor(worldSize * worldSize * grassDensity * 0.5);
    const instancedGrass = new THREE.InstancedMesh(grassGeometry, grassMaterial, grassCount);
    instancedGrass.name = 'shaderGrass';
    instancedGrass.frustumCulled = true;
    
    const dummy = new THREE.Object3D();
    let instanceIndex = 0;
    
    // Distribute grass across the terrain
    for (let i = 0; i < grassCount; i++) {
        const x = (Math.random() - 0.5) * worldSize * 0.95;
        const z = (Math.random() - 0.5) * worldSize * 0.95;
        const y = gameContext.getHeightAt(x, z);
        
        // Skip if in water
        let inWater = false;
        if (gameContext.waterBodies) {
            for (const water of gameContext.waterBodies) {
                const dist = Math.sqrt((x - water.position.x) ** 2 + (z - water.position.z) ** 2);
                const radius = water.userData?.config?.size / 2 || 50;
                if (dist < radius && y < water.position.y + 0.5) {
                    inWater = true;
                    break;
                }
            }
        }
        if (inWater) continue;
        
        // Skip near player spawn
        if (Math.sqrt(x * x + (z - 10) ** 2) < 8) continue;
        
        // Random scale and rotation for variety
        const scale = 0.8 + Math.random() * 0.6;
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
    
    gameContext.shaderGrass = instancedGrass;
    gameContext.scene.add(instancedGrass);
    
    // Store update function for animation loop
    gameContext.updateGrassWind = (delta) => updateGrassWind(instancedGrass, delta);
}

/**
 * Creates short ground cover grass across the terrain.
 * This is ankle-high grass that covers the ground for a natural forest floor.
 * @param {object} worldConfig - The world configuration
 */
export function createGroundCover(worldConfig) {
    console.log('🌱 GROUND COVER: Starting ground cover creation...');
    
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
            if (Math.sqrt(x * x + (z - 10) ** 2) < 5) continue;
            
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
        
        gameContext.groundCover = instancedGrass;
        gameContext.scene.add(instancedGrass);
        
        console.log(`🌱 GROUND COVER: Created ${instanceIndex} grass blades`);
    }, 100); // Delay to let other initialization complete first
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
        const distance = Math.sqrt((x - waterX) * (x - waterX) + (z - waterZ) * (z - waterZ));
        
        // Get water body radius from config or estimate from size
        let waterRadius = 10; // Default radius
        if (waterBody.userData && waterBody.userData.config) {
            waterRadius = waterBody.userData.config.size / 2;
        }
        
        // Use ACTUAL water radius (not expanded) - must be inside the water body
        // Reduce by 5% to account for natural pond edge variations
        const detectionRadius = waterRadius * 0.95;
        
        // Check if player is within actual water body radius
        if (distance <= detectionRadius) {
            // Get the actual terrain height at this position
            const terrainHeight = gameContext.getHeightAt(x, z);
            
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
