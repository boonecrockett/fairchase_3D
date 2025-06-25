// js/audio.js
import { gameContext } from './context.js';
import { initSpatialAudio } from './spatial-audio.js';

// --- AUDIO MODULE CONSTANTS ---
const FOREST_SOUND_VOLUME = 8; // dB, increased volume for maximum audibility
const RIFLE_SOUND_VOLUME = 0; // dB, normal volume for rifle shot
const WALK_SOUND_VOLUME = -5; // dB, moderate volume for walking sound
const TITLE_MUSIC_VOLUME = -8; // dB, moderate volume for title screen music
const RIFLE_SOUND_INSTANCES = 3; // Number of rifle sound instances for instant playback
const FOREST_FADE_IN_DURATION = 2; // seconds for forest sound fade-in
const FOREST_FADE_IN_START_VOLUME = -40; // dB, very quiet starting volume for fade-in
const CRICKET_SOUND_VOLUME = 10; // dB, increased volume for maximum evening ambiance
const CROSSFADE_START_TIME = 17.0; // 17:00 (5:00 PM) - start of crossfade
const CROSSFADE_END_TIME = 18.0; // 18:00 (6:00 PM) - end of crossfade (1 hour duration)
const CRICKET_START_TIME = 17.5; // 17:30 (5:30 PM) - midpoint for reference

/**
 * Initializes only the title screen music (called early, before UI initialization).
 */
export function initTitleMusic() {
    console.log("initTitleMusic called"); // Debug logging
    
    // Initialize title screen music
    try {
        console.log("Initializing title music..."); // Debug logging
        gameContext.titleMusic = new Tone.Player({
            url: "assets/sounds/chasing_shadows.mp3",
            loop: true,
            volume: TITLE_MUSIC_VOLUME,
            autostart: false,
            onload: () => {
                console.log("Title music loaded successfully"); // Debug logging
            },
            onerror: (error) => {
                console.warn("Title music could not be loaded:", error); // Debug logging
            }
        }).toDestination();
        
        console.log("Title music initialized"); // Debug logging
        
    } catch (error) {
        console.warn("Failed to initialize title music:", error); // Debug logging
    }
}

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
        console.log("Creating forest sound player...");
        gameContext.forestSound = new Tone.Player({
            url: "assets/sounds/forest.mp3",
            loop: true,
            volume: FOREST_FADE_IN_START_VOLUME, // Start at fade-in volume, not full volume
            autostart: false,
            onload: () => {
                console.log("Forest sound loaded successfully");
                // Try to start the forest sound, but handle autoplay restrictions
                startForestSoundWithUserInteraction();
            },
            onerror: (error) => {
                console.warn("Forest sound could not be loaded:", error);
            }
        }).toDestination();
        
        console.log("Forest sound initialization started");
    } catch (error) {
        console.warn("Failed to initialize forest sound:", error);
    }
    
    // Initialize cricket ambient sound for evening
    try {
        gameContext.cricketSound = new Tone.Player({
            url: "assets/sounds/crickets.mp3",
            loop: true,
            volume: CRICKET_SOUND_VOLUME,
            autostart: false
        }).toDestination();
    } catch (error) {
        console.warn("Failed to initialize cricket sound:", error);
    }
    
    // Initialize spatial audio system for directional deer sounds
    initSpatialAudio();
}

/**
 * Starts forest sound with proper user interaction handling for browser autoplay policies.
 */
function startForestSoundWithUserInteraction() {
    console.log("startForestSoundWithUserInteraction called");
    
    // Function to start audio after user interaction
    const startAudio = async () => {
        try {
            console.log("Attempting to start forest sound...");
            
            // Ensure Tone.js context is started
            if (Tone.context.state !== 'running') {
                await Tone.start();
                console.log("Tone.js audio context started");
            }
            
            // Start the forest sound with fade-in
            if (gameContext.forestSound && gameContext.forestSound.loaded) {
                fadeInForestSound();
                console.log("Forest sound started with fade-in");
                
                // Remove event listeners after successful start
                document.removeEventListener('click', startAudio);
                document.removeEventListener('keydown', startAudio);
            } else {
                console.warn("Forest sound not loaded or not available:", {
                    exists: !!gameContext.forestSound,
                    loaded: gameContext.forestSound?.loaded,
                    state: gameContext.forestSound?.state
                });
            }
        } catch (error) {
            console.warn("Could not start forest sound:", error);
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
        // Ensure we start at the fade-in volume
        gameContext.forestSound.volume.value = FOREST_FADE_IN_START_VOLUME;
        
        // Start playing if not already started
        if (gameContext.forestSound.state === 'stopped') {
            gameContext.forestSound.start();
        }
        
        // Fade in to target volume
        const now = Tone.now();
        gameContext.forestSound.volume.rampTo(FOREST_SOUND_VOLUME, FOREST_FADE_IN_DURATION, now);
        console.log(`Forest sound fading in from ${FOREST_FADE_IN_START_VOLUME} dB to ${FOREST_SOUND_VOLUME} dB over ${FOREST_FADE_IN_DURATION} seconds`);
    } else {
        console.warn("Forest sound not loaded or not available for fade-in");
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

/**
 * Starts the title screen music with user interaction handling for autoplay policies.
 */
export function startTitleMusic() {
    console.log("startTitleMusic called"); // Debug logging
    
    if (!gameContext.titleMusic) {
        console.log("Title music not initialized"); // Debug logging
        return;
    }
    
    // Function to start music after user interaction
    const startMusic = async () => {
        try {
            console.log("Attempting to start title music, loaded:", gameContext.titleMusic.loaded, "state:", gameContext.titleMusic.state); // Debug logging
            
            // Ensure Tone.js context is started
            if (Tone.context.state !== 'running') {
                await Tone.start();
                console.log("Tone.js context started"); // Debug logging
            }
            
            // Wait for the music to load if it's not loaded yet
            if (!gameContext.titleMusic.loaded) {
                console.log("Title music not loaded yet, waiting..."); // Debug logging
                // Try again after a short delay
                setTimeout(() => startTitleMusic(), 500);
                return;
            }
            
            // Start the title music if not already playing
            if (gameContext.titleMusic.state === 'stopped') {
                gameContext.titleMusic.start();
                console.log("Title music started successfully"); // Debug logging
            } else {
                console.log("Title music already playing, state:", gameContext.titleMusic.state); // Debug logging
            }
        } catch (error) {
            console.warn("Could not start title music:", error); // Debug logging
        }
    };
    
    // Try to start immediately
    startMusic();
    
    // Also add fallback listeners for user interaction
    const startOnInteraction = () => {
        console.log("Starting title music on user interaction"); // Debug logging
        startMusic();
        document.removeEventListener('click', startOnInteraction);
        document.removeEventListener('keydown', startOnInteraction);
    };
    
    document.addEventListener('click', startOnInteraction, { once: true });
    document.addEventListener('keydown', startOnInteraction, { once: true });
}

/**
 * Stops the title screen music with a smooth fade-out.
 */
export function stopTitleMusic() {
    if (gameContext.titleMusic && gameContext.titleMusic.state === 'started') {
        const now = Tone.now();
        const fadeOutDuration = 2; // 2 seconds fade-out
        
        // Fade out the title music
        gameContext.titleMusic.volume.rampTo(-40, fadeOutDuration, now);
        
        // Stop the music after fade-out completes
        setTimeout(() => {
            if (gameContext.titleMusic && gameContext.titleMusic.state === 'started') {
                gameContext.titleMusic.stop();
            }
        }, fadeOutDuration * 1000 + 100); // Add small buffer
        
        console.log("Title music fading out"); // Debug logging
    }
}

/**
 * Sets the volume of the title screen music.
 * @param {number} volume - Volume in dB (e.g., -20 for quiet, 0 for normal)
 */
export function setTitleMusicVolume(volume) {
    if (gameContext.titleMusic) {
        gameContext.titleMusic.volume.value = volume;
    }
}

/**
 * Crossfades from forest sounds to cricket sounds for evening ambiance.
 */
export function crossfadeToEveningAmbiance() {
    if (!gameContext.forestSound || !gameContext.cricketSound) {
        console.warn("Forest or cricket sound not initialized for crossfade");
        return;
    }
    
    // Start cricket sound at low volume if not already playing
    if (gameContext.cricketSound.state === 'stopped') {
        gameContext.cricketSound.volume.value = -40; // Start very quiet
        gameContext.cricketSound.start();
    }
    
    console.log("Evening ambiance crossfade started - will progress over 1 game hour");
}

/**
 * Updates the crossfade volumes based on current game time during the transition period.
 */
function updateCrossfadeVolumes(gameTime) {
    if (!gameContext.forestSound || !gameContext.cricketSound) return;
    
    // Evening crossfade (17:00 to 18:00)
    if (gameTime >= CROSSFADE_START_TIME && gameTime <= CROSSFADE_END_TIME) {
        const progress = (gameTime - CROSSFADE_START_TIME) / (CROSSFADE_END_TIME - CROSSFADE_START_TIME);
        
        // Calculate volumes based on crossfade progress (0 = all forest, 1 = all cricket)
        const forestVolume = FOREST_SOUND_VOLUME + (progress * (-40 - FOREST_SOUND_VOLUME));
        const cricketVolume = -40 + (progress * (CRICKET_SOUND_VOLUME - (-40)));
        
        // Apply volumes
        if (gameContext.forestSound.state === 'started') {
            gameContext.forestSound.volume.value = forestVolume;
        }
        if (gameContext.cricketSound.state === 'started') {
            gameContext.cricketSound.volume.value = cricketVolume;
        }
    }
    // Outside crossfade periods - maintain normal volumes
    else {
        // Ensure forest sound is at its target volume during normal times
        if (gameContext.forestSound.state === 'started') {
            const currentVolume = gameContext.forestSound.volume.value;
            if (Math.abs(currentVolume - FOREST_SOUND_VOLUME) > 0.1) {
                console.log(`Forest sound volume corrected from ${currentVolume.toFixed(2)} dB to ${FOREST_SOUND_VOLUME} dB`);
                gameContext.forestSound.volume.value = FOREST_SOUND_VOLUME;
            }
        }
        // Cricket sound should be silent outside evening hours
        if (gameContext.cricketSound.state === 'started' && (gameTime < CROSSFADE_START_TIME || gameTime > 6.0)) {
            gameContext.cricketSound.volume.value = -40; // Very quiet
        }
    }
}

/**
 * Manages ambient sound transitions based on game time.
 * Should be called regularly (e.g., in the game loop) to check for time-based audio changes.
 */
export function updateAmbianceForTime(gameTime) {
    // Start evening crossfade at 17:00
    if (!gameContext.eveningCrossfadeTriggered && gameTime >= CROSSFADE_START_TIME) {
        gameContext.eveningCrossfadeTriggered = true;
        crossfadeToEveningAmbiance();
    }
    
    // Reset evening flag at dawn (no morning crossfade)
    if (gameContext.eveningCrossfadeTriggered && gameTime >= 5.0 && gameTime < 5.1) {
        gameContext.eveningCrossfadeTriggered = false;
        // Stop cricket sound completely at dawn
        if (gameContext.cricketSound && gameContext.cricketSound.state === 'started') {
            gameContext.cricketSound.stop();
        }
    }
    
    // Update crossfade volumes during evening transition period only
    updateCrossfadeVolumes(gameTime);
}
