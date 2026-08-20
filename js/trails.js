// --- TRAIL SYSTEM ---
// Game trails meander from the country to the pond and sit on the ground.
import * as THREE from 'three';
import { gameContext } from './context.js';

const TRAIL_CONFIG = {
    width: 1.7,
    sampleSpacing: 1.2,
    heightOffset: 0.32,
    color: 0xffffff,
    numMainTrails: 3,
    meander: 108,
    treeAvoidanceRadius: 4.5,
};

function heightAt(x, z) {
    return gameContext.getHeightAt ? gameContext.getHeightAt(x, z) : 0;
}

function trailHeight(x, z) {
    let h = heightAt(x, z);
    h = Math.max(h, heightAt(x + 0.7, z), heightAt(x - 0.7, z));
    h = Math.max(h, heightAt(x, z + 0.7), heightAt(x, z - 0.7));
    return h + TRAIL_CONFIG.heightOffset;
}

function isInWater(x, z, extra = 2) {
    if (gameContext.isWaterAt && extra <= 0) {
        return gameContext.isWaterAt(x, z);
    }
    if (!gameContext.waterBodies) return false;
    for (const water of gameContext.waterBodies) {
        const dx = x - water.position.x;
        const dz = z - water.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        let radius = water.userData?.baseRadius || (water.userData?.config?.size / 2) || 25;
        if (typeof water.userData?.pondSeed === 'number' && water.userData?.baseRadius) {
            radius = radius * 1.15;
        }
        if (dist < radius + extra) return true;
    }
    return false;
}

function pushOutOfWater(x, z, extra = 3) {
    if (!gameContext.waterBodies || gameContext.waterBodies.length === 0) {
        return { x, z };
    }
    for (let i = 0; i < 8; i++) {
        if (!isInWater(x, z, extra)) return { x, z };
        let nearest = null;
        let nearestDist = Infinity;
        for (const water of gameContext.waterBodies) {
            const dx = x - water.position.x;
            const dz = z - water.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz) || 0.001;
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = water;
            }
        }
        if (!nearest) break;
        const dx = x - nearest.position.x;
        const dz = z - nearest.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz) || 0.001;
        x += (dx / dist) * 4;
        z += (dz / dist) * 4;
    }
    return { x, z };
}

function avoidTrees(x, z) {
    const hash = gameContext.treeHash;
    if (!hash || hash.entries.length === 0) return { x, z };
    const candidates = hash.query(x, z, TRAIL_CONFIG.treeAvoidanceRadius + 2);
    let ox = 0;
    let oz = 0;
    for (let i = 0; i < candidates.length; i++) {
        const entry = candidates[i];
        const dx = x - entry.x;
        const dz = z - entry.z;
        const dist = Math.sqrt(dx * dx + dz * dz) || 0.001;
        const keepOut = (entry.radius || 2) + TRAIL_CONFIG.treeAvoidanceRadius * 0.45;
        if (dist < keepOut) {
            const push = (keepOut - dist) / keepOut;
            ox += (dx / dist) * push * 3;
            oz += (dz / dist) * push * 3;
        }
    }
    return { x: x + ox, z: z + oz };
}

function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
        (2 * p1)
        + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
}

function densifyWaypoints(waypoints, spacing) {
    if (waypoints.length < 2) return waypoints;
    const points = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
        const p0 = waypoints[Math.max(0, i - 1)];
        const p1 = waypoints[i];
        const p2 = waypoints[i + 1];
        const p3 = waypoints[Math.min(waypoints.length - 1, i + 2)];
        const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
        const steps = Math.max(1, Math.ceil(segLen / spacing));
        for (let s = 0; s < steps; s++) {
            const t = s / steps;
            points.push({
                x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
                z: catmullRom(p0.z, p1.z, p2.z, p3.z, t),
            });
        }
    }
    points.push(waypoints[waypoints.length - 1]);
    return points;
}

function buildMeander(startX, startZ, endX, endZ, worldHalf, meanderScale = 1) {
    const dx = endX - startX;
    const dz = endZ - startZ;
    const dist = Math.hypot(dx, dz) || 1;
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const perpX = -dirZ;
    const perpZ = dirX;
    const meander = TRAIL_CONFIG.meander * meanderScale;
    const waypointCount = Math.max(8, Math.floor(dist / 24));
    const waypoints = [];
    let offset = (Math.random() - 0.5) * meander;
    const phase = Math.random() * Math.PI * 2;
    const phase2 = Math.random() * Math.PI * 2;
    const amp1 = meander * (0.75 + Math.random() * 0.45);
    const amp2 = meander * (0.28 + Math.random() * 0.22);

    for (let i = 0; i <= waypointCount; i++) {
        const t = i / waypointCount;
        offset = offset * 0.68 + (Math.random() - 0.5) * meander * 0.9;
        const nearEnd = t < 0.12 ? t / 0.12 : (t > 0.88 ? (1 - t) / 0.12 : 1);
        const lateral = (
            offset
            + Math.sin(t * Math.PI * 2.15 + phase) * amp1
            + Math.sin(t * Math.PI * 4.4 + phase2) * amp2
        ) * nearEnd;
        let x = startX + dirX * dist * t + perpX * lateral;
        let z = startZ + dirZ * dist * t + perpZ * lateral;
        x = Math.max(-worldHalf, Math.min(worldHalf, x));
        z = Math.max(-worldHalf, Math.min(worldHalf, z));
        const cleared = pushOutOfWater(x, z, 4);
        const steered = avoidTrees(cleared.x, cleared.z);
        waypoints.push(steered);
    }

    const last = pushOutOfWater(endX, endZ, 5);
    waypoints[waypoints.length - 1] = last;
    return densifyWaypoints(waypoints, TRAIL_CONFIG.sampleSpacing)
        .map((p) => {
            const kept = pushOutOfWater(p.x, p.z, 3);
            return new THREE.Vector3(kept.x, trailHeight(kept.x, kept.z), kept.z);
        })
        .filter((p, index, arr) => {
            if (isInWater(p.x, p.z, 1.5) && index > 3) return false;
            if (index === 0) return true;
            const prev = arr[index - 1];
            return Math.hypot(p.x - prev.x, p.z - prev.z) > 0.4;
        });
}

function hash01(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

function organicHalfScale(along, seed, side) {
    const s = seed + side * 19.17;
    return 0.88
        + 0.16 * Math.sin(along * 0.19 + s)
        + 0.1 * Math.sin(along * 0.47 + s * 1.7)
        + 0.06 * Math.sin(along * 1.05 - s * 0.6)
        + 0.05 * (hash01(along * 0.11 + s) * 2 - 1);
}

function endTaper(i, count) {
    if (i < 6) return (i + 1) / 7;
    if (i > count - 7) return (count - i) / 7;
    return 1;
}

function createTrailTexture() {
    const width = 128;
    const height = 256;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#c48a48';
        ctx.fillRect(0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const x = (i / 4) % width;
            const u = x / (width - 1);
            const fromCenter = Math.abs(u - 0.5) * 2;
            const noise = (Math.random() - 0.5) * 22;
            const pebble = Math.random() < 0.04 ? -28 : 0;
            const pack = 1 - fromCenter * 0.08;
            let r = 196 * pack + noise + pebble;
            let g = 132 * pack + noise * 0.65 + pebble;
            let b = 58 * pack + noise * 0.35 + pebble;
            const rut = Math.min(Math.abs(u - 0.37), Math.abs(u - 0.63));
            if (rut < 0.055) {
                r -= 18;
                g -= 14;
                b -= 8;
            }
            data[i] = Math.max(0, Math.min(255, r));
            data[i + 1] = Math.max(0, Math.min(255, g));
            data[i + 2] = Math.max(0, Math.min(255, b));
            data[i + 3] = 255;
        }
    ctx.putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function createTrailMesh(points, texture, widthMultiplier = 1) {
    if (points.length < 4) return null;
    const width = TRAIL_CONFIG.width * widthMultiplier;
    const vertices = [];
    const uvs = [];
    const indices = [];
    const edges = [];
    const seed = Math.random() * 40;
    let uvY = 0;
    let along = 0;

    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        let dx;
        let dz;
        if (i === 0) {
            dx = points[1].x - point.x;
            dz = points[1].z - point.z;
        } else if (i === points.length - 1) {
            dx = point.x - points[i - 1].x;
            dz = point.z - points[i - 1].z;
        } else {
            dx = points[i + 1].x - points[i - 1].x;
            dz = points[i + 1].z - points[i - 1].z;
        }
        if (i > 0) {
            along += Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z);
        }
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        const taper = endTaper(i, points.length);
        const leftScale = organicHalfScale(along, seed, 0) * taper;
        const rightScale = organicHalfScale(along, seed, 1) * taper;
        const leftW = width * 0.5 * leftScale;
        const rightW = width * 0.5 * rightScale;
        const leftX = point.x - nx * leftW;
        const leftZ = point.z - nz * leftW;
        const rightX = point.x + nx * rightW;
        const rightZ = point.z + nz * rightW;
        vertices.push(
            leftX, trailHeight(leftX, leftZ), leftZ,
            rightX, trailHeight(rightX, rightZ), rightZ,
        );
        uvs.push(0, uvY, 1, uvY);
        uvY += 0.22;
        edges.push({ l: leftScale, r: rightScale });
        if (i > 0) {
            const base = (i - 1) * 2;
            indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        side: THREE.DoubleSide,
        fog: true,
        toneMapped: false,
        transparent: false,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -12,
        polygonOffsetUnits: -24,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.renderOrder = 2;
    mesh.userData.centerline = points.map((p) => ({ x: p.x, z: p.z }));
    mesh.userData.edges = edges;
    return mesh;
}

function paintTrailSplat(trailsGroup, worldSize) {
    const size = 4096;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const scale = size / worldSize;

    for (let t = 0; t < trailsGroup.children.length; t++) {
        const trail = trailsGroup.children[t];
        const line = trail.userData?.centerline;
        const edges = trail.userData?.edges;
        if (!line || line.length < 2) continue;
        for (let i = 1; i < line.length; i++) {
            const env = ((edges?.[i]?.l ?? 1) + (edges?.[i]?.r ?? 1)) * 0.5;
            const prevEnv = ((edges?.[i - 1]?.l ?? 1) + (edges?.[i - 1]?.r ?? 1)) * 0.5;
            const wobble = 1 + Math.sin(i * 0.41 + t) * 0.1 + Math.sin(i * 1.15) * 0.05;
            const prev = line[i - 1];
            ctx.beginPath();
            ctx.moveTo((prev.x / worldSize + 0.5) * size, (prev.z / worldSize + 0.5) * size);
            ctx.lineTo((line[i].x / worldSize + 0.5) * size, (line[i].z / worldSize + 0.5) * size);
            ctx.lineWidth = Math.max(1.4, TRAIL_CONFIG.width * 0.5 * (env + prevEnv) * wobble * scale);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
        }
    }

    const splat = new THREE.CanvasTexture(canvas);
    splat.wrapS = THREE.ClampToEdgeWrapping;
    splat.wrapT = THREE.ClampToEdgeWrapping;
    splat.colorSpace = THREE.SRGBColorSpace;
    splat.minFilter = THREE.LinearFilter;
    splat.magFilter = THREE.LinearFilter;
    splat.generateMipmaps = false;
    splat.needsUpdate = true;
    return splat;
}

function applyTrailSplatToTerrain(trailsGroup, worldSize) {
    const terrain = gameContext.terrain;
    if (!terrain?.material || !trailsGroup.children.length) return;
    const splat = paintTrailSplat(trailsGroup, worldSize);
    const material = terrain.material;
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTrailSplat = { value: splat };
        shader.uniforms.uWorldSize = { value: worldSize };
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vTrailWorld;`,
        ).replace(
            '#include <project_vertex>',
            `vTrailWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
            #include <project_vertex>`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            uniform sampler2D uTrailSplat;
            uniform float uWorldSize;
            varying vec3 vTrailWorld;`,
        ).replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            vec2 trailUv = vec2(vTrailWorld.x / uWorldSize + 0.5, vTrailWorld.z / uWorldSize + 0.5);
            float trailMask = texture2D(uTrailSplat, trailUv).a;
            vec3 worn = diffuseColor.rgb * vec3(1.05, 0.68, 0.40) * 0.74;
            diffuseColor.rgb = mix(diffuseColor.rgb, worn, trailMask);`,
        );
    };
    material.customProgramCacheKey = () => 'terrain-trail-splat-v4';
    material.needsUpdate = true;
}

function shorelinePoint(water, angle) {
    const radius = (water.userData?.baseRadius || (water.userData?.config?.size / 2) || 25) + 6;
    return {
        x: water.position.x + Math.cos(angle) * radius,
        z: water.position.z + Math.sin(angle) * radius,
    };
}

export function createTrails(worldConfig) {
    if (!gameContext.waterBodies || gameContext.waterBodies.length === 0) return;
    if (!gameContext.getHeightAt) return;

    const trailsGroup = new THREE.Group();
    trailsGroup.name = 'trails';
    const trailTexture = createTrailTexture();
    const worldSize = worldConfig?.terrain?.size || 1000;
    const mapEdge = worldSize * 0.42;

    for (const waterBody of gameContext.waterBodies) {
        const baseAngle = Math.random() * Math.PI * 2;
        for (let i = 0; i < TRAIL_CONFIG.numMainTrails; i++) {
            const angle = baseAngle + (i / TRAIL_CONFIG.numMainTrails) * Math.PI * 2
                + (Math.random() - 0.5) * 0.35;
            const startAngle = angle + (Math.random() - 0.5) * 0.55;
            const startX = Math.max(-mapEdge, Math.min(mapEdge, waterBody.position.x + Math.cos(startAngle) * mapEdge));
            const startZ = Math.max(-mapEdge, Math.min(mapEdge, waterBody.position.z + Math.sin(startAngle) * mapEdge));
            const shoreAngle = angle + (Math.random() > 0.5 ? 1 : -1) * (0.4 + Math.random() * 0.75);
            const shore = shorelinePoint(waterBody, shoreAngle);
            const points = buildMeander(startX, startZ, shore.x, shore.z, mapEdge);
            if (points.length < 8) continue;
            const mesh = createTrailMesh(points, trailTexture, 1);
            if (mesh) trailsGroup.add(mesh);

            const numBranches = 1 + Math.floor(Math.random() * 2);
            for (let b = 0; b < numBranches; b++) {
                const startIndex = Math.floor(points.length * (0.2 + Math.random() * 0.45));
                const start = points[startIndex];
                const branchAngle = angle + (Math.random() > 0.5 ? 1 : -1) * (0.5 + Math.random() * 1.05);
                const branchLen = 80 + Math.random() * 90;
                const endX = Math.max(-mapEdge, Math.min(mapEdge, start.x + Math.cos(branchAngle) * branchLen));
                const endZ = Math.max(-mapEdge, Math.min(mapEdge, start.z + Math.sin(branchAngle) * branchLen));
                const branchPoints = buildMeander(start.x, start.z, endX, endZ, mapEdge, 0.85);
                if (branchPoints.length < 6) continue;
                const branchMesh = createTrailMesh(branchPoints, trailTexture, 0.78);
                if (branchMesh) trailsGroup.add(branchMesh);
            }
        }
    }

    gameContext.trails = trailsGroup;
    gameContext.scene.add(trailsGroup);
    applyTrailSplatToTerrain(trailsGroup, worldSize);
}

export function isOnTrail(x, z, radius = TRAIL_CONFIG.width) {
    const hit = getNearestTrailSample(x, z, radius);
    return !!hit;
}

export function getNearestTrailSample(x, z, maxDist = 80) {
    if (!gameContext.trails || !gameContext.trails.children) return null;
    let best = null;
    let bestDist = maxDist;
    for (const trail of gameContext.trails.children) {
        const line = trail.userData?.centerline;
        if (!line || line.length < 2) continue;
        for (let i = 0; i < line.length; i++) {
            const p = line[i];
            const dist = Math.hypot(x - p.x, z - p.z);
            if (dist < bestDist) {
                bestDist = dist;
                best = { trail, index: i, x: p.x, z: p.z, distance: dist };
            }
        }
    }
    return best;
}

/**
 * Next point along a trail, biased toward a destination (usually the pond).
 */
export function getTrailWaypointToward(x, z, destX, destZ, lookahead = 28) {
    const nearest = getNearestTrailSample(x, z, 90);
    if (!nearest) return null;
    const line = nearest.trail.userData.centerline;
    const destDist = (i) => Math.hypot(line[i].x - destX, line[i].z - destZ);
    const step = destDist(Math.min(line.length - 1, nearest.index + 1))
        < destDist(Math.max(0, nearest.index - 1))
        ? 1
        : -1;
    let i = nearest.index;
    let traveled = 0;
    while (i + step >= 0 && i + step < line.length && traveled < lookahead) {
        const a = line[i];
        const b = line[i + step];
        traveled += Math.hypot(b.x - a.x, b.z - a.z);
        i += step;
    }
    const p = line[i];
    return { x: p.x, z: p.z, onTrail: nearest.distance < TRAIL_CONFIG.width * 1.4 };
}
