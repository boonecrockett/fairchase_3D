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
    console.log('🎨 UI: initUI() function started');

    // Populate UI Elements in Context
    gameContext.timeValueElement = document.getElementById('clock-value');
    gameContext.scoreValueElement = document.getElementById('score-value');
    gameContext.compassElement = document.getElementById('compass-value');
    gameContext.interactionPromptElement = document.getElementById('interaction-prompt');
    gameContext.messageElement = document.getElementById('message-container');
    gameContext.sleepOverlay = document.getElementById('sleep-overlay');
    gameContext.mainMenu = document.getElementById('main-menu-container');
    gameContext.worldSelect = document.getElementById('world-select');
    gameContext.scopeOverlayElement = document.getElementById('scope-overlay');
    gameContext.crosshairElement = document.getElementById('crosshair');
    gameContext.reportModalBackdrop = document.getElementById('report-modal-backdrop');
    gameContext.reportModal = document.getElementById('report-modal');
    gameContext.reportTitle = document.getElementById('report-title');
    gameContext.reportContent = document.getElementById('report-content');
    gameContext.closeReportButton = document.getElementById('close-report-button');
    gameContext.mapButton = document.getElementById('map-button');
    gameContext.mapModalBackdrop = document.getElementById('map-modal-backdrop');
    gameContext.mapModal = document.getElementById('map-modal');
    gameContext.closeMapButton = document.getElementById('close-map-button');
    gameContext.endOfDayModalBackdrop = document.getElementById('end-of-day-modal-backdrop');
    gameContext.endOfDayModal = document.getElementById('end-of-day-modal');
    gameContext.endOfDayTitle = document.getElementById('end-of-day-title');
    gameContext.endOfDayContent = document.getElementById('end-of-day-content');
    gameContext.continueToNextDayButton = document.getElementById('continue-to-next-day-button');
    gameContext.mapCanvas = document.getElementById('map-canvas');

    // UI elements for game controls and indicators
    gameContext.interactionPromptElement = document.getElementById('interaction-prompt');
    gameContext.scopeElement = document.getElementById('scope');
    gameContext.crosshairElement = document.getElementById('crosshair');
    gameContext.windDirectionElement = document.getElementById('wind-direction');
    gameContext.windSpeedElement = document.getElementById('wind-speed');
    gameContext.messageElement = document.getElementById('message');
    gameContext.scoreElement = document.getElementById('score');
    gameContext.scoreValueElement = document.getElementById('score-value');
    gameContext.dayElement = document.getElementById('day');
    gameContext.dayValueElement = document.getElementById('day-value');
    gameContext.timeElement = document.getElementById('time');
    gameContext.timeValueElement = document.getElementById('time-value');
    gameContext.weatherElement = document.getElementById('weather');
    gameContext.weatherValueElement = document.getElementById('weather-value');

    // Show main menu container on page load (since it's hidden by default in CSS)
    if (gameContext.mainMenu) {
        gameContext.mainMenu.style.display = 'flex';
    }
    
    const instructionsHeader = document.getElementById('instructions-header');
    const instructionsBody = document.getElementById('instructions-body');

    const scoringGuideContainer = document.getElementById('scoring-guide-container');
    const scoringGuideBody = document.getElementById('scoring-guide-body');


    const instructionsContainer = document.getElementById('instructions-container');
    if (instructionsContainer && instructionsBody) {
        instructionsContainer.addEventListener('mouseover', () => {
            instructionsBody.classList.remove('collapsed');
        });

        instructionsContainer.addEventListener('mouseout', () => {
            instructionsBody.classList.add('collapsed');
        });
    }

    if (scoringGuideContainer && scoringGuideBody) {
        scoringGuideContainer.addEventListener('mouseover', () => {
            scoringGuideBody.classList.remove('collapsed');
        });

        scoringGuideContainer.addEventListener('mouseout', () => {
            scoringGuideBody.classList.add('collapsed');
        });
    }

    if (gameContext.reportModalBackdrop && gameContext.closeReportButton) {
        gameContext.closeReportButton.addEventListener('click', () => { gameContext.reportModalBackdrop.style.display = 'none'; });
    }

    const scoreReportButton = document.getElementById('score-report-button');
    if (scoreReportButton) {
        scoreReportButton.addEventListener('click', () => showReport());
    }

    if (gameContext.mapButton && gameContext.mapModalBackdrop && gameContext.closeMapButton) {
        gameContext.mapButton.addEventListener('click', () => showMap());
        gameContext.closeMapButton.addEventListener('click', () => { gameContext.mapModalBackdrop.style.display = 'none'; });
    }



    populateWorldSelector();

    // Handle loading and mode selection visibility
    const loadingContainer = document.getElementById('loading-container');
    const modeSelection = document.getElementById('mode-selection');
    
    if (loadingContainer && modeSelection) {
        // Start the loading animation and wait for it to finish
        await animateLoadingBar();
        
        // Hide loading ring and show mode selection
        loadingContainer.style.display = 'none';
        modeSelection.style.display = 'block';
    }

    // Set up mode selection button listeners
    const practiceModeButton = document.getElementById('practice-mode-button');
    const huntSimulatorButton = document.getElementById('hunt-simulator-button');
    
    if (practiceModeButton) {
        practiceModeButton.addEventListener('click', async () => {
            await startGameWithMode('practice');
        });
    }
    
    if (huntSimulatorButton) {
        huntSimulatorButton.addEventListener('click', async () => {
            await startGameWithMode('simulator');
        });
    }
    
    initMap();
    // startTitleMusic();
}

// New function to handle game start with selected mode
async function startGameWithMode(mode) {
    console.log(`🎮 Starting game in ${mode} mode`);
    
    // Store the selected game mode in context
    gameContext.gameMode = mode;

    // Switch crosshair based on game mode
    const defaultCrosshair = document.getElementById('crosshair');
    const elegantCrosshair = document.getElementById('elegant-crosshair');

    if (mode === 'practice') {
        defaultCrosshair.style.display = 'none';
        elegantCrosshair.classList.remove('initially-hidden');
        elegantCrosshair.style.display = 'block';
    } else { // simulator mode
        defaultCrosshair.style.display = 'none';
        elegantCrosshair.style.display = 'none';
    }
    
    // Stop title screen music when game starts
    stopTitleMusic();
    
    // Read deer behavior debugging option
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
    // Exclude kneeling indicator, which is controlled separately by player state
    const gameUiElements = document.querySelectorAll('.initially-hidden:not(#kneeling-indicator)');
    gameUiElements.forEach(el => {
        el.classList.remove('initially-hidden');
    });
    
    // Apply mode-specific configurations
    applyModeConfiguration(mode);
    
    // Initialize the game with the selected world and start the animation loop
    console.log('🎮 START GAME: Button clicked, checking gameContext.init:', !!gameContext.init, 'animate:', !!gameContext.animate);
    if (gameContext.init && gameContext.animate) {
        console.log('🎮 START GAME: About to call gameContext.init with worldConfig:', worldConfig?.name || 'unknown');
        await gameContext.init(worldConfig);
        console.log('🎮 START GAME: gameContext.init completed, starting animation');
        gameContext.animate();
    } else {
        console.error('🎮 START GAME: gameContext.init or gameContext.animate not available!', {
            init: !!gameContext.init,
            animate: !!gameContext.animate,
            gameContext: Object.keys(gameContext)
        });
    }
}

// Apply mode-specific configurations
function applyModeConfiguration(mode) {
    console.log(`🎮 Applying ${mode} mode configuration`);
    
    if (mode === 'practice') {
        // Practice Mode: More forgiving settings
        gameContext.practiceMode = true;
        
        // Enable hitbox visibility for learning
        if (gameContext.collisionSystem) {
            gameContext.collisionSystem.debugMode = true;
            gameContext.collisionSystem.updateHitboxVisibility();
        }
        
        // Show helpful messages
        console.log('🎯 Practice Mode: Hitboxes visible, forgiving mechanics enabled');
        
    } else if (mode === 'simulator') {
        // Hunt Simulator: Realistic settings
        gameContext.practiceMode = false;
        
        // Keep hitboxes hidden for realism
        if (gameContext.collisionSystem) {
            gameContext.collisionSystem.debugMode = false;
            gameContext.collisionSystem.updateHitboxVisibility();
        }
        
        console.log('🦌 Hunt Simulator: Realistic mechanics, no visual aids');
    }
}

/**
 * Displays a message to the user for a specified duration.
 * @param {string} text - The message text to display.
 * @param {number} [duration=MESSAGE_FADE_DURATION_MS] - How long the message stays visible in milliseconds.
 */
export function showMessage(text, duration = MESSAGE_FADE_DURATION_MS) {
    try {
        if (!gameContext.messageElement) {
            console.error('📢 MESSAGE ERROR: Message container not found in DOM');
            // Fallback: Try to find any element with ID 'message' as a last resort
            const fallbackElement = document.getElementById('message');
            if (fallbackElement) {
                fallbackElement.textContent = text;
                fallbackElement.style.opacity = 1;
                setTimeout(() => { fallbackElement.style.opacity = 0; }, duration);
                console.log('📢 MESSAGE FALLBACK: Used fallback element for message display');
                return;
            }
            return;
        }

        gameContext.messageElement.textContent = text;
        gameContext.messageElement.style.opacity = 1;
        setTimeout(() => { gameContext.messageElement.style.opacity = 0; }, duration);
    } catch (error) {
        console.error('📢 MESSAGE ERROR: Failed to show message:', error);
        // Fallback: Log to console as a last resort
        console.log('📢 MESSAGE FALLBACK: ' + text);
    }
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
    // Debug logging to track tagging conditions
    console.log('DEBUG: Checking tagging conditions - state:', gameContext.deer.state, 'fallen:', gameContext.deer.fallen, 'tagged:', gameContext.deer.tagged);
    
    if (gameContext.deer.state === 'KILLED' && gameContext.deer.fallen && !gameContext.deer.tagged) {
        // Calculate distance on the XZ plane only, ignoring height differences
        const dx = gameContext.player.position.x - gameContext.deer.model.position.x;
        const dz = gameContext.player.position.z - gameContext.deer.model.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        console.log('DEBUG: Deer is taggable, distance:', distance, 'required:', TAG_INTERACTION_DISTANCE);
        
        if (distance <= TAG_INTERACTION_DISTANCE) {
            gameContext.interactionPromptElement.textContent = 'Press [E] to Tag Deer (or click Tag button) - Auto-tagging in 5 seconds';
            gameContext.interactionPromptElement.style.display = 'block';
            gameContext.canTag = true;
            console.log('DEBUG: Tag prompt shown, canTag set to true');
            // Show manual tag button for testing
            showManualTagButton();
            // Automatically trigger tagging after a short delay for testing
            console.log('🔄 AUTO TAG DEBUG: Scheduling automatic tagging in 5 seconds for testing');
            setTimeout(() => {
                if (gameContext.canTag && gameContext.deer.state === 'KILLED' && gameContext.deer.fallen && !gameContext.deer.tagged) {
                    console.log('🔄 AUTO TAG DEBUG: Automatic tagging triggered');
                    gameContext.tagDeer();
                } else {
                    console.log('🔄 AUTO TAG DEBUG: Automatic tagging skipped - conditions no longer met');
                }
            }, 5000); // 5 second delay for auto-tagging
        } else {
            gameContext.interactionPromptElement.style.display = 'none';
            gameContext.canTag = false;
            console.log('DEBUG: Too far from deer for tagging, distance:', distance);
            // Hide manual tag button if too far
            hideManualTagButton();
        }
    } else {
        gameContext.interactionPromptElement.style.display = 'none';
        gameContext.canTag = false;
        console.log('DEBUG: Deer not taggable - conditions not met. State:', gameContext.deer.state, 'Fallen:', gameContext.deer.fallen, 'Tagged:', gameContext.deer.tagged);
        // Hide manual tag button if conditions not met
        hideManualTagButton();
    }
}

// Functions to show and hide manual tag button for testing
function showManualTagButton() {
    let tagButton = document.getElementById('manual-tag-button');
    if (!tagButton) {
        tagButton = document.createElement('button');
        tagButton.id = 'manual-tag-button';
        tagButton.textContent = 'Tag Deer';
        tagButton.style.position = 'absolute';
        tagButton.style.bottom = '20px';
        tagButton.style.right = '20px';
        tagButton.style.padding = '10px 20px';
        tagButton.style.backgroundColor = '#4CAF50';
        tagButton.style.color = 'white';
        tagButton.style.border = 'none';
        tagButton.style.borderRadius = '5px';
        tagButton.style.cursor = 'pointer';
        tagButton.style.zIndex = '1000';
        tagButton.addEventListener('click', function() {
            console.log('🔘 BUTTON DEBUG: Manual tag button clicked, canTag:', gameContext.canTag);
            if (gameContext.canTag) {
                console.log('🔘 BUTTON DEBUG: Manual tag button triggering gameContext.tagDeer()');
                gameContext.tagDeer();
            } else {
                console.log('🔘 BUTTON DEBUG: Cannot tag - canTag is false');
            }
        });
        document.body.appendChild(tagButton);
        console.log('🔘 BUTTON DEBUG: Manual tag button created and added to DOM');
    }
    tagButton.style.display = 'block';
    console.log('🔘 BUTTON DEBUG: Manual tag button shown');
}

function hideManualTagButton() {
    const tagButton = document.getElementById('manual-tag-button');
    if (tagButton) {
        tagButton.style.display = 'none';
        console.log('🔘 BUTTON DEBUG: Manual tag button hidden');
    }
}

// New function for status indicator
export function updateStatusIndicator(isKneeling) {
    try {
        let indicator = document.getElementById('status-indicator');
        if (indicator) {
            indicator.textContent = 'Kneeling';
            indicator.style.display = isKneeling ? 'block' : 'none';
            console.log('🧎 STATUS INDICATOR: Updated to ' + (isKneeling ? 'visible (Kneeling)' : 'hidden'));
        } else {
            console.error('🧎 STATUS INDICATOR ERROR: Element not found');
        }
    } catch (error) {
        console.error('🧎 STATUS INDICATOR ERROR: Failed to update indicator:', error);
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
