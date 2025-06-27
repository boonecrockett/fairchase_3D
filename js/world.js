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
                
                // Create depression within pond radius with smooth falloff
                if (distanceToPond < pondRadius * 1.2) { // Slightly larger than pond for natural slope
                    const depressionDepth = 12; // Increased from 8 to 12 units deep for better water integration
                    const falloffFactor = Math.max(0, 1 - (distanceToPond / (pondRadius * 1.2)));
                    const depression = depressionDepth * falloffFactor * falloffFactor; // Smooth quadratic falloff
                    height -= depression;
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
            // Create natural-looking circular pond with organic edges
            const radius = bodyConfig.size / 2;
            const segments = 64; // More segments for smoother, more natural curves
            
            // Create custom geometry for natural pond shape
            const vertices = [];
            const indices = [];
            
            // Center vertex
            vertices.push(0, 0, 0);
            
            // Create irregular edge vertices for natural look
            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * Math.PI * 2;
                
                // Use only very gentle sine wave variations for extremely smooth edges
                const fineNoise = Math.sin(angle * 20) * 0.015; // Very subtle high frequency ripples
                const mediumNoise = Math.sin(angle * 8) * 0.025; // Gentle medium frequency variation
                const coarseNoise = Math.sin(angle * 4) * 0.035; // Gentle low frequency major shape variation
                
                const totalVariation = 1.0 + fineNoise + mediumNoise + coarseNoise;
                const naturalRadius = radius * Math.max(0.85, Math.min(1.15, totalVariation)); // Clamp between 85% and 115% (very tight range)
                
                // Remove angle noise for smoother edges
                const naturalAngle = angle;
                
                const x = Math.cos(naturalAngle) * naturalRadius;
                const z = Math.sin(naturalAngle) * naturalRadius;
                vertices.push(x, 0, z);
                
                // Create triangles from center to edge
                if (i < segments) {
                    indices.push(0, i + 1, i + 2);
                }
            }
            
            // Create BufferGeometry from vertices
            waterGeometry = new THREE.BufferGeometry();
            waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            waterGeometry.setIndex(indices);
            waterGeometry.computeVertexNormals();
            
        } else {
            // Fallback to simple plane for other shapes
            waterGeometry = new THREE.PlaneGeometry(bodyConfig.size, bodyConfig.size);
        }

        const waterMaterial = new THREE.MeshPhongMaterial({
            color: waterColor,
            transparent: true,
            opacity: bodyConfig.opacity || defaultOpacity,
            side: THREE.DoubleSide,
            reflectivity: 0.8,
            shininess: 50
        });

        const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
        
        // Position the water body (revert to original working approach)
        waterMesh.position.set(
            bodyConfig.position.x || 0,
            bodyConfig.position.y || 0,
            bodyConfig.position.z || 0
        );
        waterMesh.position.y -= 0.1; // Slightly lower water level
        
        // Store original config for easy removal/modification
        waterMesh.userData.config = bodyConfig;
        waterMesh.userData.isPond = bodyConfig.shape === 'circle' && bodyConfig.size <= 100; // Mark small circular bodies as ponds
        
        gameContext.scene.add(waterMesh);
        gameContext.waterBodies.push(waterMesh);
    });
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
    console.log('DEBUG: createBushes called');
    const vegetationConfig = worldConfig.vegetation || {};
    const bushDensity = vegetationConfig.bushDensity || 0.6; // Default density

    const bushesGroup = new THREE.Group();
    gameContext.bushes = bushesGroup;
    gameContext.scene.add(gameContext.bushes);
    console.log('DEBUG: bushesGroup created and added to scene');

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
        console.log(`DEBUG: Bush creation using worldSize: ${worldSize}, range: [${-worldSize/2}, ${worldSize/2}]`);
        
        // Create fewer bush thickets than trees - about 1/4 the density
        const thicketCount = Math.floor((worldConfig.vegetation.treeCount || 50) / 4);
        console.log(`DEBUG: Creating ${thicketCount} bush thickets`);

        for (let i = 0; i < thicketCount; i++) {
            // Create a thicket center point
            const centerX = Math.random() * worldSize - worldSize / 2;
            const centerZ = Math.random() * worldSize - worldSize / 2;
            const centerHeight = gameContext.getHeightAt(centerX, centerZ);

            // Check if thicket center is submerged
            let isSubmerged = false;
            for (const water of gameContext.waterBodies) {
                const distanceToWaterCenter = new THREE.Vector2(centerX - water.position.x, centerZ - water.position.z).length();
                // Get water radius from stored config instead of geometry parameters
                const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50; // Default 50 unit radius
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
                    // Get water radius from stored config instead of geometry parameters
                    const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50; // Default 50 unit radius
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

        console.log(`DEBUG: Bushes created, final bushesGroup size: ${bushesGroup.children.length}`);
    } catch (error) {
        // console.error("Failed to load bush model:", error); // Logging disabled
        // No fallback for bushes - they're decorative
    }
}

/**
 * Procedurally generates and places grass throughout the game world.
 * Creates scattered grass patches for natural-looking ground cover.
 * @param {object} worldConfig - The world configuration, containing vegetation settings.
 */
export function createGrass(worldConfig) {
    const loader = new GLTFLoader();
    
    try {
        loader.load('assets/landscapes/redgrass1.glb', (gltf) => {
            const grassModel = gltf.scene;
            grassModel.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = false; // Disable shadow casting to eliminate harsh shadows
                    child.receiveShadow = true; // Keep shadow receiving for natural lighting
                    
                    // Simple material handling - let the model use its original materials
                    if (child.material) {
                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                        materials.forEach(material => {
                            if (material) {
                                material.side = THREE.DoubleSide; // Ensure grass is visible from both sides
                                
                                // Fix specular highlights - make grass more matte and natural
                                if (material.shininess !== undefined) {
                                    material.shininess = 0; // Remove shininess for matte appearance
                                }
                                if (material.specular !== undefined) {
                                    material.specular.setHex(0x000000); // Remove specular highlights
                                }
                                if (material.reflectivity !== undefined) {
                                    material.reflectivity = 0; // Remove reflectivity
                                }
                                
                                // Set natural forest floor grass color for midday
                                if (material.color !== undefined) {
                                    material.color.setHex(0x9eb529); // Natural forest floor green
                                }
                                
                                material.needsUpdate = true;
                            }
                        });
                    }
                }
            });

            const grassGroup = new THREE.Group();
            grassGroup.name = 'grass';
            
            // Get vegetation config with defaults
            const vegetationConfig = worldConfig?.environment?.vegetation || {};
            const grassDensity = vegetationConfig.grassDensity || 0.8; // Higher density than bushes
            const worldSize = worldConfig?.terrain?.size || DEFAULT_WORLD_SIZE;
            const halfSize = worldSize / 2;
            
            // Calculate number of grass clusters based on density and world size (much fewer clusters, very large size)
            const numGrassClusters = Math.floor((worldSize * worldSize * grassDensity) / 16000); // Much fewer clusters since each is very large
            
            for (let i = 0; i < numGrassClusters; i++) {
                // Try to position clusters near trees or bushes for natural appearance
                let clusterCenterX, clusterCenterZ, clusterCenterHeight;
                let foundVegetationLocation = false;
                
                // Attempt to find a tree or bush location for natural grass placement
                const vegetationSources = [];
                if (gameContext.trees && gameContext.trees.children.length > 0) {
                    vegetationSources.push(...gameContext.trees.children);
                }
                if (gameContext.bushes && gameContext.bushes.children.length > 0) {
                    vegetationSources.push(...gameContext.bushes.children);
                }
                
                if (vegetationSources.length > 0) {
                    // Try up to 15 times to find a good vegetation location
                    for (let attempt = 0; attempt < 15; attempt++) {
                        const randomVegetation = vegetationSources[Math.floor(Math.random() * vegetationSources.length)];
                        if (randomVegetation && randomVegetation.position) {
                            // Position cluster near the vegetation base with some random offset
                            const offsetDistance = 2 + Math.random() * 5; // 2-7 units from vegetation base
                            const offsetAngle = Math.random() * Math.PI * 2;
                            clusterCenterX = randomVegetation.position.x + Math.cos(offsetAngle) * offsetDistance;
                            clusterCenterZ = randomVegetation.position.z + Math.sin(offsetAngle) * offsetDistance;
                            clusterCenterHeight = gameContext.getHeightAt(clusterCenterX, clusterCenterZ);
                            foundVegetationLocation = true;
                            break;
                        }
                    }
                }
                
                // Fallback to random position if no vegetation location found
                if (!foundVegetationLocation) {
                    clusterCenterX = (Math.random() - 0.5) * worldSize * 0.9;
                    clusterCenterZ = (Math.random() - 0.5) * worldSize * 0.9;
                    clusterCenterHeight = gameContext.getHeightAt(clusterCenterX, clusterCenterZ);
                }
                
                // Skip if cluster center is underwater
                let isSubmerged = false;
                for (const water of gameContext.waterBodies) {
                    const distanceToWaterCenter = new THREE.Vector2(clusterCenterX - water.position.x, clusterCenterZ - water.position.z).length();
                    const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50;
                    if (distanceToWaterCenter < waterRadius && clusterCenterHeight < water.position.y + 0.5) {
                        isSubmerged = true;
                        break;
                    }
                }
                if (isSubmerged) continue;
                
                // Skip if too close to player spawn
                if (new THREE.Vector3(clusterCenterX, clusterCenterHeight, clusterCenterZ).distanceTo(new THREE.Vector3(0, gameContext.getHeightAt(0, 10), 10)) < 10) {
                    continue;
                }
                
                // Create 40-50 grass plants in a very large natural cluster
                const plantsInCluster = 40 + Math.floor(Math.random() * 11); // 40-50 plants per cluster
                const clusterRadius = 1.5 + Math.random() * 2; // 1.5-3.5 unit radius for tighter clustering (reduced from 4-10)
                
                for (let j = 0; j < plantsInCluster; j++) {
                    // Position plants randomly within the cluster radius
                    const angle = Math.random() * Math.PI * 2;
                    const distance = Math.random() * clusterRadius;
                    const grassX = clusterCenterX + Math.cos(angle) * distance;
                    const grassZ = clusterCenterZ + Math.sin(angle) * distance;
                    const grassHeight = gameContext.getHeightAt(grassX, grassZ);
                    
                    // Check if this grass position is submerged
                    let grassSubmerged = false;
                    for (const water of gameContext.waterBodies) {
                        const distanceToWaterCenter = new THREE.Vector2(grassX - water.position.x, grassZ - water.position.z).length();
                        const waterRadius = water.userData.config ? (water.userData.config.size / 2) : 50;
                        if (distanceToWaterCenter < waterRadius && grassHeight < water.position.y + 0.2) {
                            grassSubmerged = true;
                            break;
                        }
                    }
                    if (grassSubmerged) continue;
                    
                    const grassInstance = grassModel.clone();
                    
                    // Use raycasting to properly anchor grass to terrain surface
                    const raycaster = new THREE.Raycaster();
                    const startHeight = Math.max(grassHeight + 100, 200); // Start well above terrain
                    raycaster.set(
                        new THREE.Vector3(grassX, startHeight, grassZ), // Start well above terrain
                        new THREE.Vector3(0, -1, 0) // Cast downward
                    );
                    
                    // Raycast against the terrain to find exact ground position
                    let finalY = grassHeight; // Fallback to calculated height
                    
                    if (gameContext.terrain && gameContext.terrain.geometry) {
                        const intersects = raycaster.intersectObject(gameContext.terrain, false);
                        if (intersects.length > 0) {
                            // Use the exact intersection point for perfect ground anchoring
                            finalY = intersects[0].point.y;
                        } else {
                            // If raycasting fails, use the more accurate getHeightAt function
                            finalY = gameContext.getHeightAt(grassX, grassZ);
                        }
                    } else {
                        // Fallback to getHeightAt if terrain is not available
                        finalY = gameContext.getHeightAt(grassX, grassZ);
                    }
                    
                    // Position grass at exact terrain height with minimal vertical offset
                    grassInstance.position.set(grassX, finalY + 0.05, grassZ); // Reduced offset from 0.1 to 0.05
                    
                    // Small realistic scale for grass - ground cover size (doubled)
                    const baseScale = 0.1 + Math.random() * 0.1; // 0.1-0.2 base scale (doubled from 0.05-0.1)
                    const scaleX = baseScale;
                    const scaleY = baseScale * 0.5; // Even shorter height
                    const scaleZ = baseScale;
                    grassInstance.scale.set(scaleX, scaleY, scaleZ);
                    
                    // Random rotation for natural variation
                    grassInstance.rotation.y = Math.random() * Math.PI * 2;
                    
                    grassGroup.add(grassInstance);
                }
            }
            
            gameContext.grass = grassGroup;
            gameContext.scene.add(grassGroup);
        });
        
    } catch (error) {
        // Silently handle grass loading errors - grass is decorative
    }
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
        
        // Use a larger detection radius for initial check
        const detectionRadius = waterRadius * 1.1;
        
        // Check if player is within expanded water body radius
        if (distance <= detectionRadius) {
            // Height check that accounts for pond depression depth
            const playerHeight = gameContext.getHeightAt(x, z);
            
            // Check if player is below water surface (in the depression) or very close to water level
            // Player should be at or below water surface level, with some tolerance for slopes
            if (playerHeight <= waterY + 1.5) {
                return true;
            }
        }
    }
    
    return false;
}
