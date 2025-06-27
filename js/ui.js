// js/ui.js
import { gameContext } from './context.js';
import { initMap, showMap } from './map.js';
import { worldPresets } from './world-presets.js';
import { deer } from './deer.js';
import { stopTitleMusic } from './audio.js';
import { generateCurrentReport, updateReportModal } from './report-logger.js';

// --- UI MODULE CONSTANTS ---

// Durations
const MESSAGE_FADE_DURATION_MS = 2000;
const LOADING_DURATION_MS = 3000; // Duration for the loading bar animation

// Interaction
const TAG_INTERACTION_DISTANCE = 4; // Max distance to player for 'Tag Deer' prompt

// Compass
const COMPASS_DIRECTIONS = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];

// UI Elements
const TOGGLE_EXPAND_ICON = '[-]';
const TOGGLE_COLLAPSE_ICON = '[+]';
const EMPTY_REPORT_MESSAGE = "Your report is empty. A successful hunt will add an entry at the end of the day.";
const INTERACTION_PROMPT_TAG_DEER = 'Press [E] to Tag Deer';

/**
 * Initializes UI elements and sets up event listeners for collapsible panels, modals, and buttons.
 */
/**
 * Animates the loading bar from 0% to 100%
 */
function animateLoadingBar() {
    return new Promise(resolve => {
        const progressRingFill = document.getElementById('progress-ring-fill');
        if (!progressRingFill) {
            resolve();
            return;
        }

        const radius = progressRingFill.r.baseVal.value;
        const circumference = 2 * Math.PI * radius;

        progressRingFill.style.strokeDasharray = `${circumference} ${circumference}`;
        progressRingFill.style.strokeDashoffset = circumference;

        const startTime = performance.now();

        function updateLoadingBar(currentTime) {
            const elapsedTime = currentTime - startTime;
            const progress = Math.min(elapsedTime / LOADING_DURATION_MS, 1);
            
            const offset = circumference - progress * circumference;
            progressRingFill.style.strokeDashoffset = offset;

            if (progress < 1) {
                requestAnimationFrame(updateLoadingBar);
            } else {
                resolve();
            }
        }

        requestAnimationFrame(updateLoadingBar);
    });
}

export async function initUI() {
    // Show main menu container on page load (since it's hidden by default in CSS)
    const mainMenuContainer = document.getElementById('main-menu-container');
    if (mainMenuContainer) {
        mainMenuContainer.style.display = 'flex';
    }
    
    const instructionsHeader = document.getElementById('instructions-header');
    const instructionsBody = document.getElementById('instructions-body');
    const instructionsToggle = document.getElementById('instructions-toggle');
    const scoringGuideHeader = document.getElementById('scoring-guide-header');
    const scoringGuideBody = document.getElementById('scoring-guide-body');
    const scoringGuideToggle = document.getElementById('scoring-guide-toggle');

    if (instructionsHeader) {
        instructionsHeader.addEventListener('click', (event) => {
            event.stopPropagation();
            instructionsBody.classList.toggle('collapsed');
            instructionsToggle.innerHTML = instructionsBody.classList.contains('collapsed') ? TOGGLE_COLLAPSE_ICON : TOGGLE_EXPAND_ICON;
        });
    }

    if (scoringGuideHeader) {
        scoringGuideHeader.addEventListener('click', (event) => {
            event.stopPropagation();
            scoringGuideBody.classList.toggle('collapsed');
            scoringGuideToggle.innerHTML = scoringGuideBody.classList.contains('collapsed') ? TOGGLE_COLLAPSE_ICON : TOGGLE_EXPAND_ICON;
        });
    }

    if (gameContext.reportModalBackdrop && gameContext.closeReportButton) {
        gameContext.closeReportButton.addEventListener('click', () => { gameContext.reportModalBackdrop.style.display = 'none'; });
    }

    gameContext.reportButton = document.getElementById('report-button');
    if (gameContext.reportButton) {
        gameContext.reportButton.addEventListener('click', () => showReport());
    }

    if (gameContext.mapButton && gameContext.mapModalBackdrop && gameContext.closeMapButton) {
        gameContext.mapButton.addEventListener('click', () => showMap());
        gameContext.closeMapButton.addEventListener('click', () => { gameContext.mapModalBackdrop.style.display = 'none'; });
    }

    populateWorldSelector();

    // Handle loading and start button visibility
    const loadingContainer = document.getElementById('loading-container');
    
    if (loadingContainer && gameContext.startGameButton) {
        // Start the loading animation and wait for it to finish
        await animateLoadingBar();
        
        // Hide loading ring and show start button
        loadingContainer.style.display = 'none';
        gameContext.startGameButton.style.display = 'block';
    }

    // Set up the main menu 'Start Game' button listener
    if (gameContext.startGameButton) {
        gameContext.startGameButton.addEventListener('click', async () => {
            // Disable the start button to prevent multiple clicks
            gameContext.startGameButton.disabled = true;
            gameContext.startGameButton.textContent = 'Starting...';
            
            // Stop title screen music when game starts
            stopTitleMusic();
            
            // Read deer behavior debugging option
            // Read deer behavior debugging option and store it in the game context
            gameContext.deerSpawnMode = document.querySelector('input[name="deer-spawn-mode"]:checked').value;
            gameContext.deerBehaviorMode = document.querySelector('input[name="deer-behavior-mode"]:checked').value;

            // Get the selected world configuration
            const selectedWorld = gameContext.worldSelect.value;
            const worldConfig = worldPresets[selectedWorld];
            
            // Hide the main menu
            const mainMenuContainer = document.getElementById('main-menu-container');
            if (mainMenuContainer) {
                mainMenuContainer.style.display = 'none';
            }
            
            // Hide the testing options panel
            const testingOptionsPanel = document.getElementById('testing-options-panel');
            if (testingOptionsPanel) {
                testingOptionsPanel.style.display = 'none';
            }
            
            // Show the in-game UI by removing the helper class
            const gameUiElements = document.querySelectorAll('.initially-hidden');
            gameUiElements.forEach(el => {
                el.classList.remove('initially-hidden');
            });
            
            // Initialize the game with the selected world and start the animation loop
            if (gameContext.init && gameContext.animate) {
                await gameContext.init(worldConfig);
                gameContext.animate();
            }
        });
    }

    initMap();
    // startTitleMusic();
}

/**
 * Displays a message to the user for a specified duration.
 * @param {string} text - The message text to display.
 * @param {number} [duration=MESSAGE_FADE_DURATION_MS] - How long the message stays visible in milliseconds.
 */
export function showMessage(text, duration = MESSAGE_FADE_DURATION_MS) {
    gameContext.messageElement.textContent = text;
    gameContext.messageElement.style.opacity = 1;
    setTimeout(() => { gameContext.messageElement.style.opacity = 0; }, duration);
}

/**
 * Displays the hunter's report modal with all recorded entries.
 */
function showReport() {
    gameContext.reportModalBackdrop.style.display = 'flex';
    gameContext.reportTitle.textContent = "Hunter's Report";
    
    // Show real-time current day report
    const currentReportHTML = generateCurrentReport();
    
    // Add historical reports if any exist
    let fullReportHTML = currentReportHTML;
    
    if (gameContext.reportEntries.length > 0) {
        fullReportHTML += `<hr><h3>Previous Days</h3>`;
        fullReportHTML += gameContext.reportEntries.map(entry => `<h4>${entry.title}</h4><p>${entry.content}</p>`).join('<hr>');
    }
    
    gameContext.reportContent.innerHTML = fullReportHTML;
}

/**
 * Updates the interaction prompt based on player proximity to a killed deer.
 */
export function updateInteraction() {
    if (gameContext.deer.state === 'KILLED' && gameContext.deer.fallen && !gameContext.deer.tagged) {
        const distance = gameContext.player.position.distanceTo(gameContext.deer.model.position);
        
        if (distance <= TAG_INTERACTION_DISTANCE) {
            gameContext.interactionPromptElement.textContent = 'Press [E] to Tag Deer';
            gameContext.interactionPromptElement.style.display = 'block';
            gameContext.canTag = true;
        } else {
            gameContext.interactionPromptElement.style.display = 'none';
            gameContext.canTag = false;
        }
    } else {
        gameContext.interactionPromptElement.style.display = 'none';
        gameContext.canTag = false;
    }
}

/**
 * Ensures the main menu container stays hidden during gameplay.
 * This prevents the title screen from reappearing after modals or game events.
 */
export function ensureMainMenuHidden() {
    const mainMenuContainer = document.getElementById('main-menu-container');
    const testingOptionsPanel = document.getElementById('testing-options-panel');
    
    if (mainMenuContainer && mainMenuContainer.style.display !== 'none') {
        mainMenuContainer.style.display = 'none';
        console.log('Main menu container was visible during gameplay - hiding it');
    }
    
    if (testingOptionsPanel && testingOptionsPanel.style.display !== 'none') {
        testingOptionsPanel.style.display = 'none';
    }
}

/**
 * Populates the world selection dropdown menu from the available presets.
 */
function populateWorldSelector() {
    let worldSelectElement = gameContext.worldSelect;
    if (!worldSelectElement) {
        worldSelectElement = document.getElementById('world-select');
        if (worldSelectElement) {
            gameContext.worldSelect = worldSelectElement;
        }
    }
    
    if (worldSelectElement && worldPresets) {
        worldSelectElement.innerHTML = '';
        
        let optionCount = 0;
        for (const [key, preset] of Object.entries(worldPresets)) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key; // Use the key as the display name
            worldSelectElement.appendChild(option);
            optionCount++;
        }
        
        // Set default selection to "Hardwood Forest" (with spaces)
        if (worldSelectElement.querySelector('option[value="Hardwood Forest"]')) {
            worldSelectElement.value = 'Hardwood Forest';
        }
    }
}

/**
 * Updates the compass display based on the player's current rotation.
 */
export function updateCompass() {
    let angle = -gameContext.player.rotation.y * (180 / Math.PI) + 180; // Convert radians to degrees, invert, and offset
    angle = (angle % 360 + 360) % 360; // Normalize angle to 0-359
    const index = Math.round(angle / 45) % COMPASS_DIRECTIONS.length;
    gameContext.compassElement.textContent = COMPASS_DIRECTIONS[index];
}
