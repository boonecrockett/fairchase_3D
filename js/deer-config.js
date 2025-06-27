// --- DEER CONFIGURATION ---
// Extracted from deer.js for better modularity and maintainability

export const deerConfig = {
    name: 'deer',
    modelPath: 'assets/White_Tailed_Deer_Male.glb',
    scale: 4.4, // Increased by 10% from 4.0 for better realism
    yOffset: 0, // Add missing yOffset property
    bodyColor: 0x8B4513,
    bodySize: { x: 2, y: 1, z: 1 },
    heightOffset: 0.0, // Reduced from 0.3 to eliminate floating - deer feet should touch ground
    worldBoundaryMargin: 50, // Increased from 20 to 50 for more room near boundaries

    vitals: {
        size: { x: 0.252, y: 0.252, z: 0.252 }, // Shrunk by 10% from 0.28 to 0.252 (0.28 * 0.9)
        offset: { x: 0, y: 0.65, z: 0.3 }, // Moved forward 0.1 toward head (z: 0.2→0.3)
        debugColor: 0xFF0000,
    },

    brain: {
        size: { x: 0.1, y: 0.1, z: 0.1 }, // Resized to 0.1x0.1x0.1 units for maximum precision
        offset: { x: 0, y: 1.02, z: 0.6 }, // Moved down 0.03 (y: 1.05→1.02)
        debugColor: 0x00FF00, // Green color for brain hitbox
    },

    neck: {
        radiusTop: 0.2,
        radiusBottom: 0.2,
        height: 0.8,
        segments: 8,
        positionYOffset: 0.4,
        groupOffset: { x: 1, y: 0.5, z: 0 },
        rotationZ: -Math.PI / 4,
    },

    head: {
        size: { x: 0.6, y: 0.5, z: 0.7 },
        positionYOffset: 0.6,
    },

    legs: {
        radiusTop: 0.1,
        radiusBottom: 0.1,
        height: 1,
        segments: 8,
        yOffset: -0.5,
        positions: [
            { x: 0.8, z: 0.4 }, { x: 0.8, z: -0.4 },
            { x: -0.8, z: 0.4 }, { x: -0.8, z: -0.4 }
        ],
    },

    // AI Behavior
    alertDistanceThreshold: 250,  // Increased from 60 - deer becomes alert at longer distance
    fleeDistanceThreshold: 150,   // Increased from 35 - deer flees when player gets closer
    wanderMinRadius: 15,         // Reduced from 20 - deer stays closer to current area
    wanderMaxRadiusAddition: 40, // Reduced from 50 - less wandering range
    wanderTargetReachThreshold: 5.0,
    stateTimers: {
        grazing: 6,              // Increased from 4 - more time spent grazing for 40% total time
        drinking: 8,             // Reduced from 10 - less time spent drinking
        fleeing: 4,              // Updated from 3 to 4 - deer runs away for 4 seconds after alert
    },
    speeds: {
        wandering: 2.8,          // Reduced by 30% from 4.0 to better match walk animation
        thirsty: 5.25,           // Reduced by 30% from 7.5 to better match walk animation
        fleeing: 27.0,           // Keep fleeing speed unchanged
        wounded: 13.5,           // Keep wounded speed unchanged for escape realism
    },
    rotationSpeed: 2.5, // Radians per second for smooth turning
    legAnimationSpeeds: {
        wandering: 12,
        thirsty: 12,
        fleeing: 35,
        wounded: 20,
    },
    legRotationAmplitude: 0.5,
    neckLerpFactor: 0.1,
    neckRotations: {
        grazing: Math.PI / 2.5,
        drinking: Math.PI / 2,
        alert: Math.PI / 4,
        default: Math.PI / 4,
    },

    // Tracking
    tracking: {
        trackColor: 0x4B3621,
        trackShapeRadius: 0.18, // Increased from 0.1536 - slightly larger, more visible tracks
        trackOpacityStart: 1.0,
        trackFadeDurationS: 5400, // Increased from 4500 - tracks last longer
        trackCreationDistanceThreshold: 1.8, // Reduced from 2.0 - more frequent tracks
        bloodDropColor: 0x880000,
        bloodDropSize: 0.15, // Increased from 0.13 - more visible blood drops
        bloodOpacityStart: 0.9, // Increased from 0.8 - more visible blood
        bloodFadeDurationS: 5400, // Increased from 4500 - blood lasts longer
        bloodDropCreationDistanceThreshold: 1.3, // Reduced from 1.5 - more frequent blood drops
    },

    // Spawning
    respawnBoundaryMargin: 100,
};
