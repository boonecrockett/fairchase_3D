// --- TRAIL SYSTEM ---
// Creates natural game trails from water sources to different areas of the map
import * as THREE from 'three';
import { gameContext } from './context.js';

// Trail configuration
const TRAIL_CONFIG = {
    width: 0.6,                    // Trail width in units (narrow game trail)
    segmentLength: 2.5,            // Distance between trail points
    heightOffset: 0.02,            // Minimal offset - use polygon offset for z-fighting
    color: 0x3D3830,               // Gray-brown (worn dirt path)
    opacity: 0.5,                  // More transparent for subtle blending
    numMainTrails: 3,              // Number of main trails reaching water (2-3)
    curviness: 0.15,               // How much trails curve (0-1) - reduced for smoother paths
    treeAvoidanceRadius: 3.0,      // How far to stay from trees
    treeAvoidanceStrength: 0.8,    // How strongly to avoid trees (0-1)
};

/**
 * Creates all game trails in the world
 * Trails start from map edges and converge toward water, branching naturally
 * @param {object} worldConfig - World configuration
 */
export function createTrails(worldConfig) {
    console.log('🛤️ TRAILS: Starting trail creation...');
    
    if (!gameContext.waterBodies || gameContext.waterBodies.length === 0) {
        console.log('🛤️ TRAILS: No water bodies found, skipping trail creation');
        return;
    }
    
    if (!gameContext.getHeightAt) {
        console.log('🛤️ TRAILS: getHeightAt not available, skipping trail creation');
        return;
    }
    
    console.log(`🛤️ TRAILS: Found ${gameContext.waterBodies.length} water bodies`);
    
    const trailsGroup = new THREE.Group();
    trailsGroup.name = 'trails';
    
    // Create trail texture
    const trailTexture = createTrailTexture();
    
    const worldSize = worldConfig?.terrain?.size || 500;
    const mapEdge = worldSize * 0.45; // Stay slightly inside map bounds
    
    // For each water body, create trails from map edges converging to it
    for (const waterBody of gameContext.waterBodies) {
        const waterPos = waterBody.position;
        const waterRadius = waterBody.userData?.config?.size / 2 || 25;
        
        // Create main trails from different directions (edges of map)
        // Spread them around the compass - N, SE, SW (or similar)
        const mainAngles = [];
        const baseAngle = Math.random() * Math.PI * 2; // Random starting rotation
        for (let i = 0; i < TRAIL_CONFIG.numMainTrails; i++) {
            mainAngles.push(baseAngle + (i / TRAIL_CONFIG.numMainTrails) * Math.PI * 2);
        }
        
        for (let i = 0; i < mainAngles.length; i++) {
            const angle = mainAngles[i];
            
            // Start point at map edge
            const edgeX = waterPos.x + Math.cos(angle) * mapEdge;
            const edgeZ = waterPos.z + Math.sin(angle) * mapEdge;
            
            // Clamp to actual map bounds
            const startX = Math.max(-mapEdge, Math.min(mapEdge, edgeX));
            const startZ = Math.max(-mapEdge, Math.min(mapEdge, edgeZ));
            
            // End point stops short of water (1 unit from shoreline)
            const shorelineBuffer = 1;
            const endX = waterPos.x + Math.cos(angle + Math.PI) * (waterRadius + shorelineBuffer);
            const endZ = waterPos.z + Math.sin(angle + Math.PI) * (waterRadius + shorelineBuffer);
            
            // Generate main trail path from edge to water
            const mainTrailPoints = generateTrailToTarget(startX, startZ, endX, endZ, worldConfig);
            
            if (mainTrailPoints.length > 5) {
                const trailMesh = createTrailMesh(mainTrailPoints, trailTexture, 1.0);
                if (trailMesh) trailsGroup.add(trailMesh);
                
                // Create 1-2 branches that split off from this main trail
                const numBranches = 1 + Math.floor(Math.random() * 2);
                for (let b = 0; b < numBranches; b++) {
                    // Branch starts somewhere in the first 60% of the trail
                    const branchStartRatio = 0.15 + Math.random() * 0.45;
                    const branchStartIndex = Math.floor(mainTrailPoints.length * branchStartRatio);
                    const branchPoint = mainTrailPoints[branchStartIndex];
                    
                    // Branch goes off at an angle toward a different part of the map edge
                    const branchAngle = angle + (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 4 + Math.random() * Math.PI / 4);
                    const branchLength = 30 + Math.random() * 50;
                    
                    const branchEndX = branchPoint.x + Math.cos(branchAngle) * branchLength;
                    const branchEndZ = branchPoint.z + Math.sin(branchAngle) * branchLength;
                    
                    // Generate branch from the split point outward (away from water)
                    const branchPoints = generateTrailToTarget(
                        branchPoint.x, branchPoint.z,
                        branchEndX, branchEndZ,
                        worldConfig
                    );
                    
                    if (branchPoints.length > 5) {
                        const branchMesh = createTrailMesh(branchPoints, trailTexture, 0.75);
                        if (branchMesh) trailsGroup.add(branchMesh);
                    }
                }
            }
        }
    }
    
    gameContext.trails = trailsGroup;
    gameContext.scene.add(trailsGroup);
    console.log(`🛤️ TRAILS: Created ${trailsGroup.children.length} trail segments`);
}

/**
 * Gets terrain-only height using direct raycast (avoids hitting trees)
 */
function getTerrainOnlyHeight(x, z) {
    if (!gameContext.terrain || !gameContext.terrain.geometry) {
        return gameContext.getHeightAt ? gameContext.getHeightAt(x, z) : 0;
    }
    
    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
    raycaster.far = 2000;
    
    // Only intersect terrain mesh, not trees or other objects
    const intersects = raycaster.intersectObject(gameContext.terrain, false);
    if (intersects.length > 0) {
        return intersects[0].point.y;
    }
    
    // Fallback to getHeightAt if raycast fails
    return gameContext.getHeightAt ? gameContext.getHeightAt(x, z) : 0;
}

/**
 * Check if a position is too close to any tree
 * @returns {object|null} - Returns the closest tree info if too close, null otherwise
 */
function getTreeAvoidance(x, z) {
    if (!gameContext.trees || gameContext.trees.length === 0) {
        return null;
    }
    
    let closestTree = null;
    let closestDist = Infinity;
    
    for (const tree of gameContext.trees) {
        const dx = x - tree.position.x;
        const dz = z - tree.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist < TRAIL_CONFIG.treeAvoidanceRadius && dist < closestDist) {
            closestDist = dist;
            closestTree = { position: tree.position, distance: dist };
        }
    }
    
    return closestTree;
}

/**
 * Generates a trail path from start to target, avoiding trees
 */
function generateTrailToTarget(startX, startZ, endX, endZ, worldConfig) {
    const points = [];
    let currentX = startX;
    let currentZ = startZ;
    
    const worldSize = worldConfig?.terrain?.size || 500;
    const worldHalfSize = worldSize * 0.45;
    
    console.log(`🛤️ Trail: start(${startX.toFixed(1)}, ${startZ.toFixed(1)}) -> end(${endX.toFixed(1)}, ${endZ.toFixed(1)}), worldHalfSize=${worldHalfSize}`);
    
    // Calculate total distance and direction to target
    const totalDist = Math.sqrt((endX - startX) ** 2 + (endZ - startZ) ** 2);
    let distanceTraveled = 0;
    
    // Maximum iterations to prevent infinite loops
    const maxIterations = Math.ceil(totalDist / TRAIL_CONFIG.segmentLength) * 2;
    let iterations = 0;
    
    while (distanceTraveled < totalDist && iterations < maxIterations) {
        iterations++;
        
        // Get terrain height at this point
        const y = getTerrainOnlyHeight(currentX, currentZ) + TRAIL_CONFIG.heightOffset;
        
        // Check bounds - use full world size, not reduced
        const fullWorldHalfSize = worldSize * 0.49;
        if (Math.abs(currentX) > fullWorldHalfSize || Math.abs(currentZ) > fullWorldHalfSize) {
            console.log(`🛤️ Trail stopped at bounds: (${currentX.toFixed(1)}, ${currentZ.toFixed(1)})`);
            break;
        }
        
        // Check if we're too close to water (stop before shoreline)
        let tooCloseToWater = false;
        if (gameContext.waterBodies) {
            for (const water of gameContext.waterBodies) {
                const dist = Math.sqrt(
                    (currentX - water.position.x) ** 2 + 
                    (currentZ - water.position.z) ** 2
                );
                const waterRadius = water.userData?.config?.size / 2 || 25;
                // Stop 1 unit before water edge
                if (dist < waterRadius + 1) {
                    tooCloseToWater = true;
                    break;
                }
            }
        }
        
        // If too close to water, stop the trail here
        if (tooCloseToWater) {
            break;
        }
        
        points.push(new THREE.Vector3(currentX, y, currentZ));
        
        // Calculate base direction toward target
        const toTargetX = endX - currentX;
        const toTargetZ = endZ - currentZ;
        const distToTarget = Math.sqrt(toTargetX * toTargetX + toTargetZ * toTargetZ);
        
        if (distToTarget < TRAIL_CONFIG.segmentLength) {
            // Close enough to target - don't add final point (already handled by water check)
            break;
        }
        
        // Normalize direction to target
        let dirX = toTargetX / distToTarget;
        let dirZ = toTargetZ / distToTarget;
        
        // Add natural curviness
        const curveAmount = (Math.random() - 0.5) * TRAIL_CONFIG.curviness;
        const angle = Math.atan2(dirZ, dirX) + curveAmount;
        dirX = Math.cos(angle);
        dirZ = Math.sin(angle);
        
        // Check for tree avoidance
        const nextX = currentX + dirX * TRAIL_CONFIG.segmentLength;
        const nextZ = currentZ + dirZ * TRAIL_CONFIG.segmentLength;
        const treeNearby = getTreeAvoidance(nextX, nextZ);
        
        if (treeNearby) {
            // Steer away from tree
            const awayX = nextX - treeNearby.position.x;
            const awayZ = nextZ - treeNearby.position.z;
            const awayDist = Math.sqrt(awayX * awayX + awayZ * awayZ);
            
            if (awayDist > 0.01) {
                const avoidStrength = TRAIL_CONFIG.treeAvoidanceStrength * 
                    (1 - treeNearby.distance / TRAIL_CONFIG.treeAvoidanceRadius);
                
                dirX = dirX * (1 - avoidStrength) + (awayX / awayDist) * avoidStrength;
                dirZ = dirZ * (1 - avoidStrength) + (awayZ / awayDist) * avoidStrength;
                
                // Renormalize
                const newLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
                dirX /= newLen;
                dirZ /= newLen;
            }
        }
        
        // Apply slope influence (trails follow contours)
        const currentAngle = Math.atan2(dirZ, dirX);
        const slopeInfluence = getSlopeInfluence(currentX, currentZ, currentAngle);
        const adjustedAngle = currentAngle + slopeInfluence * 0.05;
        dirX = Math.cos(adjustedAngle);
        dirZ = Math.sin(adjustedAngle);
        
        // Move to next point
        currentX += dirX * TRAIL_CONFIG.segmentLength;
        currentZ += dirZ * TRAIL_CONFIG.segmentLength;
        distanceTraveled += TRAIL_CONFIG.segmentLength;
    }
    
    console.log(`🛤️ Trail generated: ${points.length} points, iterations: ${iterations}`);
    return points;
}

/**
 * Gets slope influence to make trails follow natural contours
 */
function getSlopeInfluence(x, z, direction) {
    const sampleDist = 2;
    const leftX = x + Math.cos(direction - Math.PI/2) * sampleDist;
    const leftZ = z + Math.sin(direction - Math.PI/2) * sampleDist;
    const rightX = x + Math.cos(direction + Math.PI/2) * sampleDist;
    const rightZ = z + Math.sin(direction + Math.PI/2) * sampleDist;
    
    // Use terrain-only height to avoid tree interference
    const leftHeight = getTerrainOnlyHeight(leftX, leftZ);
    const rightHeight = getTerrainOnlyHeight(rightX, rightZ);
    
    // Prefer to turn toward lower ground (paths follow valleys)
    return (leftHeight - rightHeight) * 0.05;
}

/**
 * Creates a trail mesh from path points
 */
function createTrailMesh(points, texture, widthMultiplier = 1.0) {
    if (points.length < 2) return null;
    
    const width = TRAIL_CONFIG.width * widthMultiplier;
    
    // Create geometry for the trail
    const vertices = [];
    const uvs = [];
    const indices = [];
    
    let uvY = 0;
    
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        
        // Calculate direction for this segment
        let direction;
        if (i === 0) {
            direction = new THREE.Vector2(
                points[1].x - point.x,
                points[1].z - point.z
            ).normalize();
        } else if (i === points.length - 1) {
            direction = new THREE.Vector2(
                point.x - points[i-1].x,
                point.z - points[i-1].z
            ).normalize();
        } else {
            direction = new THREE.Vector2(
                points[i+1].x - points[i-1].x,
                points[i+1].z - points[i-1].z
            ).normalize();
        }
        
        // Perpendicular vector for width
        const perpX = -direction.y * width * 0.5;
        const perpZ = direction.x * width * 0.5;
        
        // Taper the trail at ends
        let taperFactor = 1.0;
        if (i < 3) {
            taperFactor = (i + 1) / 4;
        } else if (i > points.length - 4) {
            taperFactor = (points.length - i) / 4;
        }
        
        // Add left and right vertices
        vertices.push(
            point.x - perpX * taperFactor, point.y, point.z - perpZ * taperFactor,
            point.x + perpX * taperFactor, point.y, point.z + perpZ * taperFactor
        );
        
        // UVs
        uvs.push(0, uvY, 1, uvY);
        uvY += 0.5;
        
        // Create triangles (except for first point)
        if (i > 0) {
            const baseIndex = (i - 1) * 2;
            indices.push(
                baseIndex, baseIndex + 1, baseIndex + 2,
                baseIndex + 1, baseIndex + 3, baseIndex + 2
            );
        }
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    
    // Use polygon offset to render trail on top of terrain without floating
    const material = new THREE.MeshLambertMaterial({
        color: TRAIL_CONFIG.color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: TRAIL_CONFIG.opacity,
        depthWrite: false,           // Don't write to depth buffer
        polygonOffset: true,         // Enable polygon offset
        polygonOffsetFactor: -1,     // Negative to render in front
        polygonOffsetUnits: -1,
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;            // Render after terrain
    
    return mesh;
}

/**
 * Creates a procedural dirt trail texture
 */
function createTrailTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Base dirt color
    ctx.fillStyle = '#5c4a3d';
    ctx.fillRect(0, 0, size, size);
    
    // Add noise/variation for natural look
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
        const x = (i / 4) % size;
        const y = Math.floor((i / 4) / size);
        
        // Add noise
        const noise = (Math.random() - 0.5) * 30;
        
        // Fade edges for softer trail borders
        const edgeFade = Math.min(x, size - x, y, size - y) / (size * 0.3);
        const fade = Math.min(1, edgeFade);
        
        data[i] = Math.max(0, Math.min(255, data[i] + noise));     // R
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise)); // G
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise)); // B
        data[i + 3] = Math.floor(255 * fade * TRAIL_CONFIG.opacity);   // A
    }
    
    ctx.putImageData(imageData, 0, 0);
    
    // Add some darker patches (worn areas)
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 5; i++) {
        const patchX = Math.random() * size;
        const patchY = Math.random() * size;
        const patchSize = 10 + Math.random() * 20;
        
        const gradient = ctx.createRadialGradient(
            patchX, patchY, 0,
            patchX, patchY, patchSize
        );
        gradient.addColorStop(0, 'rgba(60, 45, 35, 0.3)');
        gradient.addColorStop(1, 'rgba(60, 45, 35, 0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    
    return texture;
}

/**
 * Checks if a position is on a trail (useful for deer AI)
 * @param {number} x - X coordinate
 * @param {number} z - Z coordinate
 * @returns {boolean} True if position is on a trail
 */
export function isOnTrail(x, z) {
    if (!gameContext.trails || !gameContext.trails.children) return false;
    
    const checkRadius = TRAIL_CONFIG.width * 0.7; // Slightly wider than visual for gameplay
    
    try {
        for (const trailMesh of gameContext.trails.children) {
            if (!trailMesh.geometry || !trailMesh.geometry.attributes || !trailMesh.geometry.attributes.position) {
                continue;
            }
            
            const positions = trailMesh.geometry.attributes.position;
            
            // Check against trail vertices (simplified check)
            for (let i = 0; i < positions.count; i += 2) {
                const vx = positions.getX(i);
                const vz = positions.getZ(i);
                
                const dist = Math.sqrt((x - vx) ** 2 + (z - vz) ** 2);
                if (dist < checkRadius) {
                    return true;
                }
            }
        }
    } catch (e) {
        // Silently fail if trail check errors
        return false;
    }
    
    return false;
}
