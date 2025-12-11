// --- DEER CONFIGURATION ---
// Extracted from deer.js for better modularity and maintainability

export const deerConfig = {
    name: 'deer',
    modelPath: 'assets/White_Tailed_Deer_Male.glb',
        scale: 1.5, // Adjusted for realistic world scaling
        yOffset: 0.7, // Adjusted for new model scale
    bodyColor: 0x8B4513,
    bodySize: { x: 2, y: 1, z: 1 },
    heightOffset: 0.0, // Reset to 0.0 to fix deer floating above ground
    worldBoundaryMargin: 50, // Increased from 20 to 50 for more room near boundaries

    vitals: {
        name: 'Right Lung',
        size: { x: 0.04, y: 0.19, z: 0.13 },
        offset: { x: -0.02, y: 0.71, z: 0.3 },
        rotation: { x: -0.6, y: 0, z: 0 },
        debugColor: 0xFF0000,
    },

    gut: {
        name: 'Gut',
        size: { x: 0.24, y: 0.14, z: 0.23 },
        offset: { x: 0, y: 0.66, z: -0.02 },
        debugColor: 0x00FF00,
    },

    rear: {
        name: 'Rear',
        size: { x: 0.2, y: 0.22, z: 0.21 },
        offset: { x: 0, y: 0.7, z: -0.25 },
        debugColor: 0x0000FF,
    },

    spine: {
        name: 'Spine',
        size: { x: 0.02547, y: 0.04, z: 0.6 },
        offset: { x: 0, y: 0.84, z: 0.1 },
        debugColor: 0xFF00FF,
    },

    neck: {
        name: 'Neck',
        size: { x: 0.06, y: 0.08, z: 0.29 },
        offset: { x: 0.01, y: 0.85, z: 0.48 },
        rotation: { x: -0.73, y: 0, z: 0 },
        debugColor: 0x00FFFF,
    },

    brain: {
        name: 'Brain',
        size: { x: 0.09, y: 0.09, z: 0.09 },
        offset: { x: 0.01, y: 0.98, z: 0.62 },
        debugColor: 0xFFFF00,
    },

    shoulderLeft: {
        name: 'Shoulder Left',
        size: { x: 0.06, y: 0.3, z: 0.12 },
        offset: { x: 0.1, y: 0.66, z: 0.32 },
        debugColor: 0xFFA500,
    },

    shoulderRight: {
        name: 'Shoulder Right',
        size: { x: 0.06, y: 0.3, z: 0.12 },
        offset: { x: -0.1, y: 0.66, z: 0.32 },
        debugColor: 0xFFA500,
    },

    heart: {
        name: 'Heart',
        size: { x: 0.1, y: 0.07, z: 0.07 },
        offset: { x: 0, y: 0.64, z: 0.23 },
        debugColor: 0xE98EE1,
    },

    semiVitalBack: {
        name: 'Semi Vital Back',
        size: { x: 0.1, y: 0.1, z: 0.4 },
        offset: { x: 0, y: 0.78, z: 0.06 },
        debugColor: 0x27BE63,
    },

    liver: {
        name: 'Liver',
        size: { x: 0.11, y: 0.13, z: 0.09 },
        offset: { x: 0, y: 0.66, z: 0.15 },
        rotation: { x: 0, y: 0.04, z: 0 },
        debugColor: 0xF90B57,
    },

    semiVitalGut: {
        name: 'Semi-vital Gut',
        size: { x: 0.1, y: 0.11, z: 0.59 },
        offset: { x: 0, y: 0.53, z: 0.04 },
        debugColor: 0xCBAB5B,
    },

    throat: {
        name: 'Throat area',
        size: { x: 0.07, y: 0.32, z: 0.09 },
        offset: { x: 0.01, y: 0.74, z: 0.48 },
        rotation: { x: 0.84, y: 0, z: 0 },
        debugColor: 0xED8476,
    },

    leftLung: {
        name: 'Left Lung',
        size: { x: 0.04, y: 0.19, z: 0.13 },
        offset: { x: 0.03, y: 0.71, z: 0.3 },
        rotation: { x: -0.65, y: 0, z: 0 },
        debugColor: 0xF417CC,
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
        grazing: 4,              // Reduced from 6 - less time stationary
        drinking: 6,             // Reduced from 8 - less time spent drinking
        fleeing: 12,             // Deer runs away for 12 seconds after alert
    },
    speeds: {
        wandering: 0.98,         // +10% from 0.89
        thirsty: 1.76,           // +10% from 1.6
        fleeing: 16.2,           // Reduced 10% from 18
        wounded: 7.0,            // Calibrated: 10.0 * 0.7 = 7.0 for matched animation
    },
    rotationSpeed: 0.85, // Radians per second, scaled for new model size
    legAnimationSpeeds: {
        wandering: 6.6,      // +10% from 6
        thirsty: 6.6,        // +10% from 6
        fleeing: 25.2,       // Reduced 10% from 28 to match slower flee speed
        wounded: 16,         // Increased to match faster wounded speed
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
                trackShapeRadius: 0.06, // Scaled down from 0.18
        trackOpacityStart: 1.0,
        trackFadeDurationS: 5400, // Increased from 4500 - tracks last longer
        trackCreationDistanceThreshold: 0.233, // Reduced from 0.35 by 33% to increase track frequency by 50%
        bloodDropColor: 0x880000,
        bloodDropSize: 0.045, // Reduced by 50% from 0.09 for much smaller blood drops
        bloodOpacityStart: 0.9, // Increased from 0.8 - more visible blood
        bloodFadeDurationS: 5400, // Increased from 4500 - blood lasts longer
        bloodDropCreationDistanceThreshold: 0.8, // Reduced from 1.3 to place blood drops closer to tracks
    },

    // Spawning
    respawnBoundaryMargin: 100,
};
