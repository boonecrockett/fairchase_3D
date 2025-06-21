// js/constants.js
/**
 * @fileoverview This file contains globally used constants for the game.
 * Grouped by category for better organization.
 */

// --- PLAYER CONSTANTS ---
/**
 * Mouse sensitivity for player camera controls.
 * @type {number}
 */
export const MOUSE_SENSITIVITY = 0.002;

// --- TIME AND DAY/NIGHT CYCLE CONSTANTS ---
/**
 * Multiplier for how fast game time progresses relative to real-time.
 * Higher values mean faster days.
 * @type {number}
 */
export const GAME_TIME_SPEED_MULTIPLIER = 0.05;
/**
 * Total hours in a game day.
 * @type {number}
 */
export const HOURS_IN_DAY = 24;
/**
 * The hour at which dawn begins (ambient light starts increasing).
 * @type {number}
 */
export const DAWN_START_HOUR = 5;
/**
 * The hour at which full morning light is achieved.
 * @type {number}
 */
export const MORNING_START_HOUR = 8;
/**
 * The hour at which afternoon begins (lighting may subtly change).
 * @type {number}
 */
export const AFTERNOON_START_HOUR = 12;
/**
 * The hour at which dusk begins (ambient light starts decreasing).
 * @type {number}
 */
export const DUSK_START_HOUR = 17;
/**
 * The hour at which night begins (minimal ambient light, fog increases).
 * This also marks the end of dusk.
 * @type {number}
 */
export const NIGHT_START_HOUR = 19;

// --- SLEEP SEQUENCE CONSTANTS ---
/**
 * Initial delay in milliseconds before the sleep sequence overlay starts fading in.
 * @type {number}
 */
export const SLEEP_SEQUENCE_DELAY_MS = 100;
/**
 * Duration in milliseconds of the main sleep period when the screen is fully faded.
 * @type {number}
 */
export const SLEEP_SEQUENCE_MAIN_DURATION_MS = 3000;
/**
 * Duration in milliseconds for the sleep overlay to fade out, revealing the new day.
 * @type {number}
 */
export const SLEEP_FADE_OUT_DURATION_MS = 2000;

// --- FOG CONSTANTS ---
/**
 * Maximum fog density during the night.
 * @type {number}
 */
export const FOG_DENSITY_NIGHT = 0.015;
/**
 * Maximum fog density during the day.
 * @type {number}
 */
export const FOG_DENSITY_DAY = 0.005;
/**
 * Lerp factor for smooth fog density transitions between day and night.
 * Smaller values result in smoother, slower transitions.
 * @type {number}
 */
export const FOG_LERP_FACTOR = 0.05;

// --- WORLD CONSTANTS ---
/**
 * Default size (width and depth) for the terrain plane if not specified in a world preset.
 * @type {number}
 */
export const DEFAULT_WORLD_SIZE = 1000;
/**
 * Number of width segments for the terrain geometry. Higher values mean more detail but lower performance.
 * @type {number}
 */
export const WORLD_WIDTH_SEGMENTS = 100;
/**
 * Number of depth segments for the terrain geometry. Higher values mean more detail but lower performance.
 * @type {number}
 */
export const WORLD_DEPTH_SEGMENTS = 100;

