// js/audio.js
import { gameContext } from './context.js';

// --- AUDIO MODULE CONSTANTS ---
const GUNSHOT_NOTE = "C1";
const GUNSHOT_DURATION = "0.5s";

/**
 * Initializes the audio components, specifically the gunshot sound synthesizer.
 */
export function initAudio() {
    gameContext.gunshotSound = new Tone.MembraneSynth().toDestination();
}

/**
 * Plays the gunshot sound effect.
 */
export function playGunshotSound() {
    if (gameContext.gunshotSound) {
        gameContext.gunshotSound.triggerAttackRelease(GUNSHOT_NOTE, GUNSHOT_DURATION);
    }
}
