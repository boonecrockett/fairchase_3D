import * as THREE from 'three';
import { gameContext } from './context.js';
import { DAWN_START_HOUR, NIGHT_START_HOUR } from './constants.js';

// Throttle lighting updates - no need to update every frame
let lightingUpdateAccumulator = 0;
const LIGHTING_UPDATE_INTERVAL = 0.1; // Update every 100ms

/**
 * Checks if it is currently night time in the game.
 * @returns {boolean} True if night, false if day
 */
export function isNight() {
    const currentTime = gameContext.gameTime;
    return currentTime < DAWN_START_HOUR || currentTime > NIGHT_START_HOUR;
}

/**
 * Interpolates between two hex colors
 * @param {number} color1 - First color as hex number
 * @param {number} color2 - Second color as hex number  
 * @param {number} factor - Interpolation factor (0-1)
 * @returns {number} Interpolated color as hex number
 */
function interpolateColor(color1, color2, factor) {
    const c1 = new THREE.Color(color1);
    const c2 = new THREE.Color(color2);
    return c1.lerp(c2, factor).getHex();
}

/**
 * Adjusts color saturation and luminosity
 * @param {number} hexColor - Original hex color
 * @param {number} saturationFactor - Multiplier for saturation (0.5 = 50% saturation)
 * @param {number} luminosityFactor - Multiplier for luminosity (1.2 = 20% brighter)
 * @returns {number} Adjusted hex color
 */
function adjustColorSaturationAndLuminosity(hexColor, saturationFactor, luminosityFactor) {
    const color = new THREE.Color(hexColor);
    
    // Convert to HSL
    const hsl = {};
    color.getHSL(hsl);
    
    // Adjust saturation and luminosity
    hsl.s *= saturationFactor;
    hsl.l *= luminosityFactor;
    
    // Clamp values
    hsl.s = Math.min(1, Math.max(0, hsl.s));
    hsl.l = Math.min(1, Math.max(0, hsl.l));
    
    // Convert back to RGB and return hex
    color.setHSL(hsl.h, hsl.s, hsl.l);
    return color.getHex();
}

// Throttle time display updates
let timeDisplayAccumulator = 0;
const TIME_DISPLAY_UPDATE_INTERVAL = 0.5; // Update every 500ms - clock only shows minutes anyway

/**
 * Updates the time display in the UI
 */
export function updateTimeDisplay() {
    // Throttle DOM updates
    timeDisplayAccumulator += gameContext.deltaTime || 0.016;
    if (timeDisplayAccumulator < TIME_DISPLAY_UPDATE_INTERVAL) return;
    timeDisplayAccumulator = 0;
    
    if (gameContext.timeValueElement) {
        const hours = Math.floor(gameContext.gameTime);
        const minutes = Math.floor((gameContext.gameTime - hours) * 60);
        const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        gameContext.timeValueElement.textContent = timeString;
    } else {
        const clockElement = document.getElementById('clock-value');
        if (clockElement) {
            const hours = Math.floor(gameContext.gameTime);
            const minutes = Math.floor((gameContext.gameTime - hours) * 60);
            const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            clockElement.textContent = timeString;
            gameContext.timeValueElement = clockElement;
        }
    }
}

/**
 * Updates dynamic lighting based on game time
 */
export function updateDynamicLighting() {
    if (!gameContext.scene || !gameContext.scene.sun || !gameContext.scene.ambientLight) return;
    
    // Throttle updates - lighting doesn't need to change every frame
    lightingUpdateAccumulator += gameContext.deltaTime || 0.016;
    if (lightingUpdateAccumulator < LIGHTING_UPDATE_INTERVAL) return;
    lightingUpdateAccumulator = 0;
    
    const timeOfDay = gameContext.gameTime; // 0-24 hours
    const sun = gameContext.scene.sun;
    const ambientLight = gameContext.scene.ambientLight;
    
    // Calculate sun position (arc across the sky)
    const sunAngle = ((timeOfDay - 6) / 12) * Math.PI; // 6 AM to 6 PM arc
    const sunHeight = Math.sin(sunAngle);
    const sunX = Math.cos(sunAngle) * 300;
    const sunY = Math.max(10, sunHeight * 200 + 50); // Keep sun above horizon
    const sunZ = 100;
    
    sun.position.set(sunX, sunY, sunZ);
    
    // Define lighting phases throughout the day
    let sunColor, ambientColor, skyColor, sunIntensity, ambientIntensity;
    
    if (timeOfDay >= 4.5 && timeOfDay < 7) {
        // Sunrise (4:30-7:00 AM) - Gradual transition from night to morning
        const progress = (timeOfDay - 4.5) / 2.5; // 2.5 hour duration
        // From night colors to sunrise/golden hour start colors
        sunColor = interpolateColor(0x0f0f23, 0xff6b35, progress); // Very dark blue to orange
        ambientColor = interpolateColor(0x0a0a1a, 0x8b4513, progress); // Nearly black to warm brown
        skyColor = adjustColorSaturationAndLuminosity(
            interpolateColor(0x0f0f23, 0xff8c69, progress), 0.5, 1.2 // Dark blue to salmon
        );
        sunIntensity = 0.1 + progress * 0.7; // 0.1 to 0.8
        ambientIntensity = 0.1 + progress * 0.4; // 0.1 to 0.5
        
    } else if (timeOfDay >= 7 && timeOfDay < 10) {
        // Early Morning (7-10 AM) - golden hour
        const progress = (timeOfDay - 7) / 3;
        sunColor = interpolateColor(0xff6b35, 0xffd700, progress); // Orange to gold
        ambientColor = interpolateColor(0x8b4513, 0xdaa520, progress); // Brown to goldenrod
        skyColor = adjustColorSaturationAndLuminosity(
            interpolateColor(0xff8c69, 0x87ceeb, progress), 0.5, 1.2
        ); // Salmon to sky blue with reduced saturation and increased luminosity
        sunIntensity = 0.8 + progress * 0.2; // 0.8 to 1.0
        ambientIntensity = 0.5 + progress * 0.2; // 0.5 to 0.7
        
    } else if (timeOfDay >= 10 && timeOfDay < 15) {
        // Midday (10 AM - 3 PM) - bright white/blue light
        const progress = (timeOfDay - 10) / 5;
        sunColor = interpolateColor(0xffd700, 0xffffff, progress); // Gold to white
        ambientColor = interpolateColor(0xdaa520, 0xf0f8ff, progress); // Goldenrod to alice blue
        skyColor = adjustColorSaturationAndLuminosity(
            interpolateColor(0x87ceeb, 0x4169e1, progress), 0.5, 1.2
        ); // Sky blue to royal blue with reduced saturation and increased luminosity
        sunIntensity = 1.0; // Peak brightness
        ambientIntensity = 0.7; // Peak ambient
        
    } else if (timeOfDay >= 15 && timeOfDay < 17) {
        // Late Afternoon (3-5 PM) - warm white to golden
        const progress = (timeOfDay - 15) / 2;
        sunColor = interpolateColor(0xffffff, 0xffd700, progress); // White to gold
        ambientColor = interpolateColor(0xf0f8ff, 0xdaa520, progress); // Alice blue to goldenrod
        skyColor = adjustColorSaturationAndLuminosity(
            interpolateColor(0x4169e1, 0xff8c69, progress), 0.5, 1.2
        ); // Royal blue to salmon
        sunIntensity = 1.0 - progress * 0.2; // 1.0 to 0.8
        ambientIntensity = 0.7 - progress * 0.2; // 0.7 to 0.5
        
    } else if (timeOfDay >= 17 && timeOfDay < 19.5) {
        // Sunset (5-7:30 PM) - Golden to orange/red to purple
        const progress = (timeOfDay - 17) / 2.5;
        sunColor = interpolateColor(0xffd700, 0xff4500, progress); // Gold to orange-red
        ambientColor = interpolateColor(0xdaa520, 0x483d8b, progress); // Goldenrod to dark slate blue
        skyColor = adjustColorSaturationAndLuminosity(
            interpolateColor(0xff8c69, 0x191970, progress), 0.6, 1.0
        ); // Salmon to midnight blue
        sunIntensity = 0.8 - progress * 0.7; // 0.8 to 0.1
        ambientIntensity = 0.5 - progress * 0.4; // 0.5 to 0.1
        
    } else {
        // Night (7:30 PM - 4:30 AM)
        sunColor = 0x0f0f23; // Dark blue
        ambientColor = 0x0a0a1a; // Very dark blue/black
        skyColor = 0x050510; // Almost black
        sunIntensity = 0.0; // No sun
        ambientIntensity = 0.1; // Moonlight equivalent
        
        // Moon position (opposite to sun)
        sun.position.set(-100, 200, -100);
    }
    
    // Apply colors and intensities
    sun.color.setHex(sunColor);
    sun.intensity = sunIntensity;
    ambientLight.color.setHex(ambientColor);
    ambientLight.intensity = ambientIntensity;
    
    // Update sky color (fog)
    if (gameContext.scene.fog) {
        gameContext.scene.fog.color.setHex(skyColor);
    }
    
    // Explicitly set alpha to 1 to ensure opaque background, preventing HTML leak-through
    gameContext.renderer.setClearColor(skyColor, 1);
}
