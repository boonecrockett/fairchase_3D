// js/audio.js
import { gameContext } from './context.js';
import { initSpatialAudio } from './spatial-audio.js';

// --- AUDIO MODULE CONSTANTS ---
const FOREST_SOUND_VOLUME = -5; // dB, raised by 1 dB for better balance
const RIFLE_SOUND_VOLUME = 0; // dB, normal volume for rifle shot
const WALK_SOUND_VOLUME = -7; // dB, reduced by 1 dB for better balance
const WATERWALK_SOUND_VOLUME = -5; // dB, moderate volume for water walking sound
const FOLIAGEWALK_SOUND_VOLUME = 0; // dB, louder for better audibility when walking through brush
const TITLE_MUSIC_VOLUME = -8; // dB, moderate volume for title screen music
const RIFLE_SOUND_INSTANCES = 3; // Number of rifle sound instances for instant playback
const FOREST_FADE_IN_DURATION = 2; // seconds for forest sound fade-in
const FOREST_FADE_IN_START_VOLUME = -40; // dB, very quiet starting volume for fade-in
const CRICKET_SOUND_VOLUME = 6; // dB, reduced by 1 dB for better balance
const CROSSFADE_START_TIME = 17.5; // 17:30 (5:30 PM) - start of cricket fade-in
const CROSSFADE_END_TIME = 18.5; // 18:30 (6:30 PM) - end of cricket fade-in (1 hour duration)
const CRICKET_START_TIME = 17.5; // 17:30 (5:30 PM) - cricket start time
const CRICKET_END_TIME = 24.0; // 24:00 (midnight) - cricket end time

/**
 * Initializes only the title screen music (called early, before UI initialization).
 */
export function initTitleMusic() {
    // Initialize title screen music
    try {
        gameContext.titleMusic = new Tone.Player({
            url: "assets/sounds/chasing_shadows.mp3",
            loop: true,
            volume: TITLE_MUSIC_VOLUME,
            autostart: false,
            onload: () => {
                // Title music loaded successfully
            },
            onerror: (error) => {
                // Title music could not be loaded
            }
        }).toDestination();
        
    } catch (error) {
        // Failed to initialize title music
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
                    // Rifle sound loaded successfully
                }
            }).toDestination();
            
            gameContext.rifleSounds.push(rifleSound);
        } catch (error) {
            // Failed to initialize rifle sound
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
        // Failed to initialize walk sound
    }
    
    // Initialize water walk sound
    try {
        gameContext.waterWalkSound = new Tone.Player({
            url: "assets/sounds/waterwalk.mp3",
            loop: true,
            volume: WATERWALK_SOUND_VOLUME,
            autostart: false
        }).toDestination();
    } catch (error) {
        // Failed to initialize water walk sound
    }
    
    // Initialize foliage walk sound
    try {
        gameContext.foliageWalkSound = new Tone.Player({
            url: "assets/sounds/foliagewalk.mp3",
            loop: true,
            volume: FOLIAGEWALK_SOUND_VOLUME,
            autostart: false
        }).toDestination();
    } catch (error) {
        console.error('Failed to initialize foliage walk sound:', error);
    }
    
    // Initialize ambient forest sound with seamless looping
    try {
        gameContext.forestSound = new Tone.Player({
            url: "assets/sounds/forest.mp3",
            loop: true,
            volume: FOREST_FADE_IN_START_VOLUME, // Start at fade-in volume, not full volume
            autostart: false,
            // No fade parameters - let the perfect loop play completely seamlessly
            onload: () => {
                // Forest sound loaded successfully
                // Try to start the forest sound, but handle autoplay restrictions
                startForestSoundWithUserInteraction();
            },
            onerror: (error) => {
                // Forest sound could not be loaded
            }
        }).toDestination();
        
    } catch (error) {
        // Failed to initialize forest sound
    }
    
    // Initialize cricket ambient sound for evening with seamless looping
    try {
        gameContext.cricketSound = new Tone.Player({
            url: "assets/sounds/crickets.mp3",
            loop: true,
            volume: CRICKET_SOUND_VOLUME,
            autostart: false,
            // No fade parameters - let the perfect loop play completely seamlessly
        }).toDestination();
    } catch (error) {
        // Failed to initialize cricket sound
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
            }
            
            // Start the forest sound with fade-in
            if (gameContext.forestSound && gameContext.forestSound.loaded) {
                fadeInForestSound();
                
                // Event listeners are now self-removing with { once: true }, so no manual removal is needed.
            } else {
                // Forest sound not loaded or not available
            }
        } catch (error) {
            // Could not start forest sound
        }
    };
    
    // Add self-removing event listeners for the first user interaction
    document.addEventListener('click', startAudio, { once: true });
    document.addEventListener('keydown', startAudio, { once: true });
    
    // Also try to start immediately (might work if autoplay is allowed)
    startAudio();
}

/**
 * Fades in the forest sound from silent to full volume over the specified duration with smooth transitions.
 */
export function fadeInForestSound() {
    if (gameContext.forestSound && gameContext.forestSound.loaded) {
        // Ensure we start at the fade-in volume
        gameContext.forestSound.volume.value = FOREST_FADE_IN_START_VOLUME;
        
        // Start playing if not already started
        if (gameContext.forestSound.state === 'stopped') {
            gameContext.forestSound.start();
        }
        
        // Use smooth rampTo for more natural fade-in
        gameContext.forestSound.volume.rampTo(FOREST_SOUND_VOLUME, FOREST_FADE_IN_DURATION);
        
        // Set a timeout to log completion
        setTimeout(() => {
            // Forest sound fade-in completed
        }, FOREST_FADE_IN_DURATION * 1000);
    } else {
        // Forest sound not loaded or not available for fade-in
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
 * Sets the volume of the forest sound with smooth transition to prevent audio blips.
 * @param {number} volume - Volume in dB (e.g., -20 for quiet, 0 for normal)
 */
export function setForestSoundVolume(volume) {
    if (gameContext.forestSound) {
        // Use rampTo for smooth volume transitions instead of instant changes
        gameContext.forestSound.volume.rampTo(volume, 0.1); // 100ms smooth transition
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
 * Starts the water walk sound if it's loaded and not already playing.
 */
export function startWaterWalkSound() {
    if (gameContext.waterWalkSound && gameContext.waterWalkSound.loaded && gameContext.waterWalkSound.state === 'stopped') {
        gameContext.waterWalkSound.start();
    }
}

/**
 * Stops the water walk sound.
 */
export function stopWaterWalkSound() {
    if (gameContext.waterWalkSound && gameContext.waterWalkSound.state === 'started') {
        gameContext.waterWalkSound.stop();
    }
}

/**
 * Sets the volume of the water walk sound.
 * @param {number} volume - Volume in dB (e.g., -20 for quiet, 0 for normal)
 */
export function setWaterWalkSoundVolume(volume) {
    if (gameContext.waterWalkSound) {
        gameContext.waterWalkSound.volume.value = volume;
    }
}

/**
 * Starts the foliage walk sound if it's loaded and not already playing.
 */
export function startFoliageWalkSound() {
    if (gameContext.foliageWalkSound && gameContext.foliageWalkSound.loaded && gameContext.foliageWalkSound.state === 'stopped') {
        gameContext.foliageWalkSound.start();
    }
}

/**
 * Stops the foliage walk sound.
 */
export function stopFoliageWalkSound() {
    if (gameContext.foliageWalkSound && gameContext.foliageWalkSound.state === 'started') {
        gameContext.foliageWalkSound.stop();
    }
}

/**
 * Sets the volume of the foliage walk sound.
 * @param {number} volume - Volume in dB (e.g., -20 for quiet, 0 for normal)
 */
export function setFoliageWalkSoundVolume(volume) {
    if (gameContext.foliageWalkSound) {
        gameContext.foliageWalkSound.volume.value = volume;
    }
}

/**
 * Starts the title screen music with user interaction handling for autoplay policies.
 */
let titleMusicRetries = 0;
const MAX_TITLE_MUSIC_RETRIES = 20; // 10 seconds max (20 * 500ms)

export function startTitleMusic() {
    // Function to start music after user interaction
    const startMusic = async () => {
        try {
            // Ensure Tone.js context is started
            if (Tone.context.state !== 'running') {
                await Tone.start();
            }
            
            // Wait for the music to load if it's not loaded yet
            if (!gameContext.titleMusic.loaded) {
                if (titleMusicRetries < MAX_TITLE_MUSIC_RETRIES) {
                    titleMusicRetries++;
                    setTimeout(() => startTitleMusic(), 500);
                }
                return;
            }
            
            // Start the title music if not already playing
            if (gameContext.titleMusic.state === 'stopped') {
                gameContext.titleMusic.start();
            } else {
                // Title music already playing
            }
        } catch (error) {
            // Could not start title music
        }
    };
    
    // Try to start immediately
    startMusic();
    
    // Also add fallback listeners for user interaction
    const startOnInteraction = () => {
        startMusic();
        // Listeners are now self-removing.
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
        // Forest or cricket sound not initialized for crossfade
        return;
    }
    
    // Start cricket sound at low volume if not already playing
    if (gameContext.cricketSound.state === 'stopped') {
        gameContext.cricketSound.volume.value = -40; // Start very quiet
        gameContext.cricketSound.start();
    }
}

/**
 * Updates the crossfade volumes based on current game time during the transition period.
 */
function updateCrossfadeVolumes(gameTime) {
    if (!gameContext.forestSound || !gameContext.cricketSound) return;
    
    const VOLUME_TOLERANCE = 0.5; // Only adjust volume if difference is > 0.5 dB
    
    // Evening crossfade (17:30 to 18:30)
    if (gameTime >= CROSSFADE_START_TIME && gameTime <= CROSSFADE_END_TIME) {
        const progress = (gameTime - CROSSFADE_START_TIME) / (CROSSFADE_END_TIME - CROSSFADE_START_TIME);
        
        // Calculate volumes based on crossfade progress (0 = all forest, 1 = all cricket)
        const forestVolume = FOREST_SOUND_VOLUME + (progress * (-40 - FOREST_SOUND_VOLUME));
        const cricketVolume = -40 + (progress * (CRICKET_SOUND_VOLUME - (-40)));
        
        // Apply volumes only if they need significant adjustment
        if (gameContext.forestSound.state === 'started') {
            const currentForestVolume = gameContext.forestSound.volume.value;
            if (Math.abs(currentForestVolume - forestVolume) > VOLUME_TOLERANCE) {
                gameContext.forestSound.volume.rampTo(forestVolume, 0.1);
            }
        }
        if (gameContext.cricketSound.state === 'started') {
            const currentCricketVolume = gameContext.cricketSound.volume.value;
            if (Math.abs(currentCricketVolume - cricketVolume) > VOLUME_TOLERANCE) {
                gameContext.cricketSound.volume.rampTo(cricketVolume, 0.1);
            }
        }
    }
    // Cricket active period (18:30 to midnight) - keep crickets at full volume
    else if (gameTime > CROSSFADE_END_TIME && gameTime < CRICKET_END_TIME) {
        // Keep forest sound quiet and crickets at full volume
        if (gameContext.forestSound.state === 'started') {
            const currentForestVolume = gameContext.forestSound.volume.value;
            if (Math.abs(currentForestVolume - (-40)) > VOLUME_TOLERANCE) {
                gameContext.forestSound.volume.rampTo(-40, 0.1);
            }
        }
        if (gameContext.cricketSound.state === 'started') {
            const currentCricketVolume = gameContext.cricketSound.volume.value;
            if (Math.abs(currentCricketVolume - CRICKET_SOUND_VOLUME) > VOLUME_TOLERANCE) {
                gameContext.cricketSound.volume.rampTo(CRICKET_SOUND_VOLUME, 0.1);
            }
        }
    }
    // Outside cricket hours - maintain normal forest volume, silence crickets
    else {
        // Ensure forest sound is at its target volume during normal times
        if (gameContext.forestSound.state === 'started') {
            const currentVolume = gameContext.forestSound.volume.value;
            if (Math.abs(currentVolume - FOREST_SOUND_VOLUME) > VOLUME_TOLERANCE) {
                gameContext.forestSound.volume.rampTo(FOREST_SOUND_VOLUME, 0.1);
            }
        }
        // Cricket sound should be silent outside evening hours
        if (gameContext.cricketSound.state === 'started' && (gameTime < CRICKET_START_TIME || gameTime > CRICKET_END_TIME)) {
            const currentCricketVolume = gameContext.cricketSound.volume.value;
            if (Math.abs(currentCricketVolume - (-40)) > VOLUME_TOLERANCE) {
                gameContext.cricketSound.volume.rampTo(-40, 0.1);
            }
        }
    }
}

/**
 * Manages ambient sound transitions based on game time.
 * Should be called regularly (e.g., in the game loop) to check for time-based audio changes.
 */
export function updateAmbianceForTime(gameTime) {
    // Start evening crossfade at 17:30
    if (!gameContext.eveningCrossfadeTriggered && gameTime >= CROSSFADE_START_TIME) {
        gameContext.eveningCrossfadeTriggered = true;
        crossfadeToEveningAmbiance();
    }
    
    // Stop cricket sound at midnight (handles both time >= 24.0 and wrap to 0.0)
    const isMidnight = gameTime >= CRICKET_END_TIME || (gameTime >= 0.0 && gameTime < 0.1);
    if (gameContext.eveningCrossfadeTriggered && isMidnight) {
        gameContext.eveningCrossfadeTriggered = false;
        // Fade out cricket sound smoothly at midnight instead of abrupt stop
        if (gameContext.cricketSound && gameContext.cricketSound.state === 'started') {
            gameContext.cricketSound.volume.rampTo(-60, 0.5); // Fade to silence over 500ms
            setTimeout(() => {
                if (gameContext.cricketSound.state === 'started') {
                    gameContext.cricketSound.stop();
                    // Reset volume for next evening
                    gameContext.cricketSound.volume.value = CRICKET_SOUND_VOLUME;
                }
            }, 500);
        }
    }
    
    // Update crossfade volumes during evening transition period only
    updateCrossfadeVolumes(gameTime);
}
