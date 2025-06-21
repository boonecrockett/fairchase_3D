export const worldPresets = {
    "Hardwood Forest": {
        terrain: {
            color: 0x556B2F, // DarkOliveGreen
            size: 1000,
            generationMethod: 'sineCosine',
            sineCosineParams: { freq1: 77.8, amp1: 8, freq2: 40.0, amp2: 4 }, // Frequencies scaled for 1000 world size
            heightMultiplier: 1.0, // Amplitudes in sineCosineParams define height
        },
        environment: {
            skyColor: 0x87CEEB, // SkyBlue
            fogColor: 0x87CEEB,
            waterColor: 0x4682B4, // SteelBlue
            waterLevel: -15, // Lowered for consistency with new water body depths
            waterBodies: [
                { shape: 'circle', size: 120, position: { x: 150, y: -14, z: -150 }, opacity: 0.8 },
                { shape: 'circle', size: 100, position: { x: -200, y: -15, z: 200 }, opacity: 0.7 },
                { shape: 'circle', size: 80, position: { x: 250, y: -12, z: 280 }, opacity: 0.75 } // Adjusted -5 to -12, slightly shallower
            ]
        },
        vegetation: {
            treeCount: 600,
            canopyColor: 0x228B22, // ForestGreen
            trunkColor: 0x8B4513, // SaddleBrown
            treeScale: { min: 0.9, max: 1.6 },
            treeType: 'hardwood'
        }
    },
    "Alpine Forest": {
        terrain: {
            color: 0x967969, // LightBrown
            size: 1000,
            generationMethod: 'perlin',
            perlinParams: { 
                quality: 1, 
                noiseZ: Math.random() * 100, 
                amplitudeScale: 1.75, 
                coordinateScale: 0.02 
            },
            heightMultiplier: 15
        },
        vegetation: {
            treeCount: 400,
            treeScale: { min: 0.8, max: 1.2 },
            canopyColor: 0x228B22, // Forest Green
            trunkColor: 0x8B4513,  // Saddle Brown
        },
        environment: {
            waterLevel: -1,
            waterColor: 0x336699, // Blue
            skyColor: 0x87CEEB,
            fogColor: 0xddeeff,
            waterBodies: [
                { shape: 'circle', size: 150, position: { x: 0, y: 0, z: 0 }, opacity: 0.8 }
            ]
        }
    },
    "Desert Canyon": {
        terrain: {
            color: 0xD2B48C, // Tan
            size: 1000,
            generationMethod: 'perlin',
            perlinParams: { 
                quality: 1, 
                noiseZ: Math.random() * 100, 
                amplitudeScale: 2.0, // Slightly higher for more dramatic features
                coordinateScale: 0.025 // Slightly different scale for variety
            },
            heightMultiplier: 20 // Steeper hills for canyon effect
        },
        vegetation: {
            treeCount: 50, // Fewer "trees" (cacti/rocks)
            treeScale: { min: 0.5, max: 1.5 },
            canopyColor: 0x2E8B57, // Cactus green
            trunkColor: 0x9B7D64,  // Rocky brown
        },
        environment: {
            waterLevel: -15, // Small oasis
            waterColor: 0x336699, 
            skyColor: 0xFFA500,
            fogColor: 0xFFDAB9,
            waterBodies: [
                { shape: 'circle', size: 50, position: { x: -250, y: -14, z: -250 }, opacity: 0.85 }
            ]
        }
    }
};
