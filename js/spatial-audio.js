// js/spatial-audio.js
import * as THREE from 'three';
import { gameContext } from './context.js';

// --- SPATIAL AUDIO MODULE CONSTANTS ---
const DEER_BLOW_VOLUME = 5; // dB, reduced by 1 dB for better balance
const MAX_AUDIO_DISTANCE = 300; // Maximum distance for audio to be heard (matches deer alert range)
const ROLLOFF_FACTOR = 2; // How quickly sound fades with distance
const DOPPLER_FACTOR = 0.3; // Doppler effect strength

// Sound file paths
const SOUND_PATHS = {
    deerBlow: 'assets/sounds/deer_blow.mp3' // Alarm sound when deer spots hunter
};

/**
 * Initializes the spatial audio system with 3D positioned sounds
 */
export function initSpatialAudio() {
    // console.log('Initializing spatial audio system...'); // Logging disabled
    
    // Initialize spatial audio context
    gameContext.spatialAudio = {
        sounds: {},
        activeSources: new Map()
    };
    
    try {
        // Initialize sound pools for different deer sounds
        initDeerSoundPools();
        
        // console.log('Spatial audio system initialized successfully'); // Logging disabled
    } catch (error) {
        // console.warn('Failed to initialize spatial audio:', error); // Logging disabled
    }
}

/**
 * Initializes sound pools for deer audio effects
 */
function initDeerSoundPools() {
    const soundTypes = ['deerBlow'];
    
    soundTypes.forEach(soundType => {
        gameContext.spatialAudio.sounds[soundType] = [];
        
        // Create multiple instances for overlapping sounds
        const poolSize = 2; // Only need a couple instances for deer blow
        
        for (let i = 0; i < poolSize; i++) {
            try {
                const player = new Tone.Player({
                    url: SOUND_PATHS[soundType],
                    volume: getSoundVolume(soundType),
                    autostart: false,
                    onload: () => {
                        // console.log(`${soundType} ${i + 1} loaded successfully`); // Logging disabled
                    },
                    onerror: (error) => {
                        // console.warn(`Failed to load ${soundType} ${i + 1}:`, error); // Logging disabled
                    }
                });
                
                // Create stereo panner for directional positioning
                const panner = new Tone.Panner(0); // Start at center
                const volume = new Tone.Volume(0);
                
                // Connect player through panner and volume to destination
                player.chain(panner, volume, Tone.Destination);
                
                gameContext.spatialAudio.sounds[soundType].push({
                    player: player,
                    panner: panner,
                    volume: volume,
                    inUse: false
                });
                
            } catch (error) {
                // console.warn(`Failed to initialize ${soundType} ${i + 1}:`, error); // Logging disabled
            }
        }
    });
}

/**
 * Gets the appropriate volume for a sound type
 */
function getSoundVolume(soundType) {
    switch (soundType) {
        case 'deerBlow': return DEER_BLOW_VOLUME;
        default: return -10;
    }
}

/**
 * Updates the spatial audio listener position to follow the player
 */
export function updateSpatialAudioListener() {
    if (!gameContext.spatialAudio || !gameContext.player || !gameContext.camera) {
        return;
    }
    
    // For stereo panning, we don't need to update a listener position
    // The panning is calculated per sound in playPositionalSound()
}

/**
 * Plays a positioned 3D sound at a specific location
 */
export function playPositionalSound(soundType, position, velocity = null) {
    // console.log(`Attempting to play positional sound: ${soundType} at position:`, position); // Logging disabled
    
    if (!gameContext.spatialAudio?.sounds[soundType] || !position) {
        // console.warn(`Cannot play sound: spatialAudio=${!!gameContext.spatialAudio}, sounds=${!!gameContext.spatialAudio?.sounds[soundType]}, position=${!!position}`); // Logging disabled
        return;
    }
    
    const soundPool = gameContext.spatialAudio.sounds[soundType];
    // console.log(`Sound pool for ${soundType} has ${soundPool.length} instances`); // Logging disabled
    
    // Find an available sound instance
    let soundInstance = soundPool.find(instance => !instance.inUse);
    
    if (!soundInstance) {
        // If all instances are in use, use the first one (oldest)
        soundInstance = soundPool[0];
        if (soundInstance.player.state === 'started') {
            soundInstance.player.stop();
        }
        // console.log(`All instances in use, reusing first instance for ${soundType}`); // Logging disabled
    } else {
        // console.log(`Found available instance for ${soundType}`); // Logging disabled
    }
    
    try {
        // Mark as in use
        soundInstance.inUse = true;
        
        // Calculate relative position to player
        const playerPos = gameContext.player.position;
        const relativePos = position.clone().sub(playerPos);
        const distance = relativePos.length();
        
        // console.log(`Sound distance: ${distance}, max distance: ${MAX_AUDIO_DISTANCE}`); // Logging disabled
        
        // Only play if within hearing range
        if (distance > MAX_AUDIO_DISTANCE) {
            // console.log(`Sound too far away (${distance} > ${MAX_AUDIO_DISTANCE}), not playing`); // Logging disabled
            soundInstance.inUse = false;
            return;
        }
        
        // Calculate stereo panning based on relative X position
        // Get camera's right vector for proper left/right calculation
        const cameraRight = new THREE.Vector3();
        gameContext.camera.getWorldDirection(cameraRight);
        cameraRight.cross(new THREE.Vector3(0, 1, 0)).normalize();
        
        // Project relative position onto camera's right vector
        const panValue = relativePos.dot(cameraRight) / MAX_AUDIO_DISTANCE;
        soundInstance.panner.pan.value = Math.max(-1, Math.min(1, panValue));
        
        // Calculate distance-based volume attenuation
        const volumeAttenuation = Math.max(0, 1 - (distance / MAX_AUDIO_DISTANCE));
        const attenuatedVolume = getSoundVolume(soundType) + (20 * Math.log10(volumeAttenuation + 0.1));
        soundInstance.volume.volume.value = attenuatedVolume;
        
        // console.log(`Playing ${soundType}: pan=${soundInstance.panner.pan.value.toFixed(2)}, volume=${attenuatedVolume.toFixed(2)}`); // Logging disabled
        
        // Apply Doppler effect if velocity is provided
        if (velocity && DOPPLER_FACTOR > 0) {
            const playerVelocity = gameContext.player.velocity || new THREE.Vector3(0, 0, 0);
            const relativeVelocity = velocity.clone().sub(playerVelocity);
            const dopplerShift = 1 + (relativeVelocity.length() * DOPPLER_FACTOR * 0.01);
            soundInstance.player.playbackRate = Math.max(0.5, Math.min(2.0, dopplerShift));
        }
        
        // Play the sound with a 0.5 second delay
        setTimeout(() => {
            soundInstance.player.start();
            // console.log(`Successfully started playing ${soundType}`); // Logging disabled
            
            // Add fade-out effect for deer blow sound
            if (soundType === 'deerBlow') {
                // Start fade-out at 1.5 seconds (0.5 seconds before end)
                setTimeout(() => {
                    const fadeOutDuration = 0.4; // 400ms fade-out (shorter)
                    const currentVolume = soundInstance.volume.volume.value;
                    const targetVolume = currentVolume - 6; // Gentler fade (only -6dB)
                    
                    // Smooth fade-out using exponential ramp
                    soundInstance.volume.volume.exponentialRampToValueAtTime(
                        targetVolume, 
                        Tone.context.currentTime + fadeOutDuration
                    );
                }, 1500); // Start fade later (1.5 seconds)
            }
        }, 500);
        
        // Mark as available after sound duration
        setTimeout(() => {
            soundInstance.inUse = false;
            // console.log(`${soundType} instance marked as available`); // Logging disabled
        }, 2000); // Assume max 2 second sound duration
        
    } catch (error) {
        // console.warn(`Error playing positional sound ${soundType}:`, error); // Logging disabled
        soundInstance.inUse = false;
    }
}

/**
 * Updates deer audio based on deer state and movement
 */
export function updateDeerAudio(deer, delta) {
    if (!deer || !deer.model || !gameContext.spatialAudio) {
        return;
    }
    
    const currentTime = gameContext.clock.getElapsedTime();
    const deerPosition = deer.model.position;
    const playerDistance = gameContext.player.position.distanceTo(deerPosition);
    
    // Only play sounds if deer is within hearing range
    if (playerDistance > MAX_AUDIO_DISTANCE) {
        return;
    }
    
    // Calculate deer velocity for Doppler effect
    const deerVelocity = deer.lastPosition ? 
        deerPosition.clone().sub(deer.lastPosition).divideScalar(delta) : 
        new THREE.Vector3(0, 0, 0);
    
    // Store current position for next frame
    deer.lastPosition = deerPosition.clone();
}

/**
 * Triggers deer blow sound when deer becomes alert
 * Called directly from deer setState method
 */
export function triggerDeerBlowSound(deer) {
    if (!deer || !deer.model || !gameContext.spatialAudio) {
        return;
    }
    
    const deerPosition = deer.model.position;
    const playerDistance = gameContext.player.position.distanceTo(deerPosition);
    
    // Only play if within hearing range
    if (playerDistance <= MAX_AUDIO_DISTANCE) {
        playPositionalSound('deerBlow', deerPosition);
    }
}

/**
 * Triggers deer blow sound for spawn notifications
 * Plays regardless of distance to alert player of new deer
 */
export function triggerDeerSpawnBlowSound(deer) {
    if (!deer || !deer.model || !gameContext.spatialAudio) {
        return;
    }
    
    const deerPosition = deer.model.position;
    
    // For spawn notifications, always play the sound regardless of distance
    // This alerts the player that a new deer has appeared on the map
    playPositionalSound('deerBlow', deerPosition);
}

/**
 * Stops all spatial audio
 */
export function stopSpatialAudio() {
    if (!gameContext.spatialAudio) {
        return;
    }
    
    try {
        // Stop all sound pools
        Object.values(gameContext.spatialAudio.sounds).forEach(soundPool => {
            soundPool.forEach(instance => {
                if (instance.player.state === 'started') {
                    instance.player.stop();
                }
                instance.inUse = false;
            });
        });
        
    } catch (error) {
        // console.warn('Error stopping spatial audio:', error); // Logging disabled
    }
}

/**
 * Adjusts master spatial audio volume
 */
export function setSpatialAudioVolume(volume) {
    if (!gameContext.spatialAudio) {
        return;
    }
    
    try {
        // Adjust volume for all sound pools
        Object.values(gameContext.spatialAudio.sounds).forEach(soundPool => {
            soundPool.forEach(instance => {
                const baseVolume = getSoundVolume(instance.soundType || 'deerBlow');
                instance.player.volume.value = baseVolume + volume;
            });
        });
        
    } catch (error) {
        // console.warn('Error setting spatial audio volume:', error); // Logging disabled
    }
}
