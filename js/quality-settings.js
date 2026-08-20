// Graphics quality presets for Fair Chase
// Applied at renderer setup and when vegetation is generated.

export const QUALITY_LEVELS = {
    low: {
        id: 'low',
        label: 'Low',
        pixelRatioCap: 1,
        antialias: false,
        shadowEnabled: false,
        shadowMapSize: 512,
        softShadows: false,
        treeDensity: 0.4,
        bushDensity: 0.4,
        grassDensity: 0.45,
        treeCastShadow: false,
        nearGrassCount: 500,
        // Keep visibility distance identical across quality levels so graphics
        // settings never alter the deer-detection gameplay envelope.
        fogFar: 220,
        cameraFar: 250,
    },
    medium: {
        id: 'medium',
        label: 'Medium',
        pixelRatioCap: 1.5,
        antialias: true,
        shadowEnabled: true,
        shadowMapSize: 1024,
        softShadows: false,
        treeDensity: 0.7,
        bushDensity: 0.7,
        grassDensity: 0.7,
        treeCastShadow: false,
        nearGrassCount: 900,
        fogFar: 220,
        cameraFar: 250,
    },
    high: {
        id: 'high',
        label: 'High',
        pixelRatioCap: 2,
        antialias: true,
        shadowEnabled: true,
        shadowMapSize: 2048,
        softShadows: true,
        treeDensity: 1,
        bushDensity: 1,
        grassDensity: 1,
        treeCastShadow: true,
        nearGrassCount: 1400,
        fogFar: 220,
        cameraFar: 250,
    },
};

const STORAGE_KEY = 'fairchase_graphics_quality';

let currentLevel = 'medium';

export function getQualityLevel() {
    return currentLevel;
}

export function getQualitySettings() {
    return QUALITY_LEVELS[currentLevel] || QUALITY_LEVELS.medium;
}

export function loadQualityPreference() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && QUALITY_LEVELS[saved]) {
            currentLevel = saved;
        }
    } catch (_) {
        // localStorage may be unavailable
    }
    return currentLevel;
}

export function setQualityLevel(level) {
    if (!QUALITY_LEVELS[level]) return getQualitySettings();
    currentLevel = level;
    try {
        localStorage.setItem(STORAGE_KEY, level);
    } catch (_) {
        // ignore
    }
    return QUALITY_LEVELS[level];
}
