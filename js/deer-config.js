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
        size: { x: 0.20, y: 0.16, z: 0.23364 }, // Extended forward 55% total (10% + 15% + 20% + 10%)
        offset: { x: 0, y: 0.72, z: 0.338 }, // Moved down 10% and adjusted forward
        debugColor: 0xFF0000, // Red color for vitals hitbox
    },

    brain: {
        size: { x: 0.12, y: 0.12, z: 0.12 }, // Increased for reliable hit detection
        offset: { x: 0, y: 0.958, z: 0.65 }, // Positioned in head area
        debugColor: 0xFFFF00, // Yellow color for brain hitbox
    },

    gut: {
        size: { x: 0.20, y: 0.16, z: 0.16 }, // Increased for reliable hit detection
        offset: { x: 0, y: 0.72, z: 0.05 }, // Moved down 10% in belly area, clear of vitals and rear
        debugColor: 0x00FF00, // Green color for gut hitbox
    },

    rear: {
        size: { x: 0.20, y: 0.16, z: 0.168 }, // Extended backward 20% for reliable hit detection
        offset: { x: 0, y: 0.8, z: -0.264 }, // Positioned further back in hindquarter area
        debugColor: 0x0000FF, // Blue color for rear hitbox
    },

    spine: {
        size: { x: 0.05094, y: 0.10152, z: 0.6 }, // Width and height increased by 20%, doubled, then increased 50% more
        offset: { x: 0, y: 0.84784, z: 0.1 }, // Moved up further to accommodate larger spine hitbox
        debugColor: 0xFF00FF, // Magenta color for spine hitbox
    },

    neck: {
        size: { x: 0.09, y: 0.1818, z: 0.1 }, // Reduced width and height by 10%
        offset: { x: 0, y: 0.93818, z: 0.58 }, // Moved up additional 10% of height vertically
        rotation: { x: 0.943, y: 0, z: 0 }, // Tilted up 30 degrees total (~54 deg) - added 10 more degrees
        debugColor: 0x00FFFF, // Cyan for neck hitbox
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
        fleeing: 6,              // Updated from 4 to 6 - deer runs away for 6 seconds after alert
    },
    speeds: {
        wandering: 1.96,         // Reduced by additional 30% from 2.8 for slower walking
        thirsty: 3.675,          // Reduced by additional 30% from 5.25 for slower walking
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
