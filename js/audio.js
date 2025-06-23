// js/audio.js
import { gameContext } from './context.js';
import { initSpatialAudio } from './spatial-audio.js';

// --- AUDIO MODULE CONSTANTS ---
const FOREST_SOUND_VOLUME = 10; // dB, increased by another 50% from +4dB for maximum audibility
const RIFLE_SOUND_VOLUME = 0; // dB, normal volume for rifle shot
const WALK_SOUND_VOLUME = -5; // dB, moderate volume for walking sound
const RIFLE_SOUND_INSTANCES = 3; // Multiple instances for instant playback
const FOREST_FADE_IN_DURATION = 4; // seconds to fade in forest sound
const FOREST_FADE_IN_START_VOLUME = -40; // dB, very quiet starting volume for fade-in

/**
 * Initializes the audio components, including rifle shot sound, walk sound, and ambient forest sound.
 */
export function initAudio() {
    // Initialize multiple rifle shot sound instances for instant playback
    gameContext.rifleSounds = [];
    gameContext.rifleCurrentIndex = 0;
    
    for (let i = 0; i < RIFLE_SOUND_INSTANCES; i++) {
        try {
            const rifleSound = new Tone.Player({
                url: "assets/sounds/rifle.mp3",
                volume: RIFLE_SOUND_VOLUME,
                autostart: false,
                onload: () => {
                    // console.log(`Rifle sound ${i + 1} loaded successfully`); // Logging disabled
                }
            }).toDestination();
            
            gameContext.rifleSounds.push(rifleSound);
        } catch (error) {
            // console.warn(`Failed to initialize rifle sound ${i + 1}:`, error); // Logging disabled
        }
    }
    
    // Initialize walk sound
    try {
        gameContext.walkSound = new Tone.Player({
            url: "assets/sounds/walk.mp3",
            loop: true,
            volume: WALK_SOUND_VOLUME,
            autostart: false
        }).toDestination();
    } catch (error) {
        // console.warn("Failed to initialize walk sound:", error); // Logging disabled
    }
    
    // Initialize ambient forest sound
    try {
        gameContext.forestSound = new Tone.Player({
            url: "assets/sounds/forest.mp3",
            loop: true,
            volume: FOREST_FADE_IN_START_VOLUME,
            autostart: false,
            onload: () => {
                // console.log("Forest sound loaded successfully"); // Logging disabled
                // Try to start the forest sound, but handle autoplay restrictions
                startForestSoundWithUserInteraction();
            },
            onerror: (error) => {
                // console.warn("Forest sound could not be loaded:", error); // Logging disabled
            }
        }).toDestination();
        
    } catch (error) {
        // console.warn("Failed to initialize forest sound:", error); // Logging disabled
    }
    
    // Initialize spatial audio system for directional deer sounds
    initSpatialAudio();
}

/**
 * Starts forest sound with proper user interaction handling for browser autoplay policies.
 */
function startForestSoundWithUserInteraction() {
    // Function to start audio after user interaction
    const startAudio = async () => {
        try {
            // Ensure Tone.js context is started
            if (Tone.context.state !== 'running') {
                await Tone.start();
                // console.log("Tone.js audio context started"); // Logging disabled
            }
            
            // Start the forest sound with fade-in
            if (gameContext.forestSound && gameContext.forestSound.loaded) {
                fadeInForestSound();
                // console.log("Forest sound started with fade-in"); // Logging disabled
                
                // Remove event listeners after successful start
                document.removeEventListener('click', startAudio);
                document.removeEventListener('keydown', startAudio);
            }
        } catch (error) {
            // console.warn("Could not start forest sound:", error); // Logging disabled
        }
    };
    
    // Add event listeners for user interaction
    document.addEventListener('click', startAudio, { once: true });
    document.addEventListener('keydown', startAudio, { once: true });
    
    // Also try to start immediately (might work if autoplay is allowed)
    startAudio();
}

/**
 * Fades in the forest sound from silent to full volume over the specified duration.
 */
export function fadeInForestSound() {
    if (gameContext.forestSound && gameContext.forestSound.loaded) {
        // Set to starting volume if not already set
        gameContext.forestSound.volume.value = FOREST_FADE_IN_START_VOLUME;
        
        // Start playing if not already started
        if (gameContext.forestSound.state === 'stopped') {
            gameContext.forestSound.start();
        }
        
        // Fade in to target volume
        const now = Tone.now();
        gameContext.forestSound.volume.rampTo(FOREST_SOUND_VOLUME, FOREST_FADE_IN_DURATION, now);
        // console.log("Forest sound fading in over", FOREST_FADE_IN_DURATION, "seconds"); // Logging disabled
    }
}

/**
 * Starts the ambient forest sound if it's loaded and not already playing.
 */
export function startForestSound() {
    if (gameContext.forestSound && gameContext.forestSound.loaded && gameContext.forestSound.state === 'stopped') {
        fadeInForestSound();
    }
}

/**
 * Stops the ambient forest sound.
 */
export function stopForestSound() {
    if (gameContext.forestSound && gameContext.forestSound.state === 'started') {
        gameContext.forestSound.stop();
    }
}

/**
 * Sets the volume of the forest sound.
 * @param {number} volume - Volume in dB (e.g., -20 for quiet, 0 for normal)
 */
export function setForestSoundVolume(volume) {
    if (gameContext.forestSound) {
        gameContext.forestSound.volume.value = volume;
    }
}

/**
 * Plays the rifle shot sound effect.
 */
export function playRifleSound() {
    if (gameContext.rifleSounds && gameContext.rifleSounds.length > 0) {
        const currentRifleSound = gameContext.rifleSounds[gameContext.rifleCurrentIndex];
        if (currentRifleSound) {
            currentRifleSound.start();
            gameContext.rifleCurrentIndex = (gameContext.rifleCurrentIndex + 1) % gameContext.rifleSounds.length;
        }
    }
}

/**
 * Starts the walk sound if it's loaded and not already playing.
 */
export function startWalkSound() {
    if (gameContext.walkSound && gameContext.walkSound.loaded && gameContext.walkSound.state === 'stopped') {
        gameContext.walkSound.start();
    }
}

/**
 * Stops the walk sound.
 */
export function stopWalkSound() {
    if (gameContext.walkSound && gameContext.walkSound.state === 'started') {
        gameContext.walkSound.stop();
    }
}

/**
 * Sets the volume of the walk sound.
 * @param {number} volume - Volume in dB (e.g., -20 for quiet, 0 for normal)
 */
export function setWalkSoundVolume(volume) {
    if (gameContext.walkSound) {
        gameContext.walkSound.volume.value = volume;
    }
}
