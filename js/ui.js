// js/ui.js
import { gameContext } from './context.js';
import { initMap, showMap } from './map.js';
import { worldPresets } from './world-presets.js';
import { deer } from './deer.js';
import { stopTitleMusic } from './audio.js';
import { generateCurrentReport, updateReportModal } from './report-logger.js';
import { DEBUG_MODE } from './constants.js';
import { startPreloading } from './preloader.js';

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
 * This is purely cosmetic
 */
function animateLoadingBar() {
    // Preloading disabled - was causing stutters
    // startPreloading();
    
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
            
            // Pure time-based progress - don't wait for preload
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
    if (!gameContext.timeValueElement) {
        // Aggressive fallback - retry after a short delay in case DOM isn't fully loaded
        setTimeout(() => {
            gameContext.timeValueElement = document.getElementById('clock-value');
        }, 1000);
    }
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

    // Hide debug/testing panel if DEBUG_MODE is disabled
    const testingOptionsPanel = document.getElementById('testing-options-panel');
    if (testingOptionsPanel && !DEBUG_MODE) {
        testingOptionsPanel.style.display = 'none';
    }

    // Handle splash screen and main menu display
    const splashScreen = document.getElementById('splash-screen');
    if (splashScreen && gameContext.mainMenu) {
        // After 5 seconds, fade out splash and show main menu
        setTimeout(() => {
            splashScreen.classList.add('fade-out');
            gameContext.mainMenu.style.display = 'flex';
            
            // Remove splash screen from DOM after fade animation
            setTimeout(() => {
                splashScreen.classList.add('hidden');
            }, 800);
        }, 5000);
    } else if (gameContext.mainMenu) {
        // Fallback if no splash screen
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

    // HUD Toggle functionality
    const hudToggleButton = document.getElementById('hud-toggle-button');
    const hudPanel = document.getElementById('hud-panel');
    const hudContainer = document.querySelector('.hud-container.top-left');
    
    if (hudToggleButton && hudPanel && hudContainer) {
        hudToggleButton.addEventListener('click', () => {
            toggleHUD();
        });
    }
    
    // H key to toggle HUD
    document.addEventListener('keydown', (e) => {
        if (e.code === 'KeyH' && gameContext.gameStartedAndReady) {
            // Don't toggle if typing in an input
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
                return;
            }
            toggleHUD();
        }
    });

    if (gameContext.reportModalBackdrop && gameContext.closeReportButton) {
        gameContext.closeReportButton.addEventListener('click', () => { gameContext.reportModalBackdrop.style.display = 'none'; });
        
        // Close report modal when clicking on backdrop
        gameContext.reportModalBackdrop.addEventListener('click', (e) => {
            if (e.target === gameContext.reportModalBackdrop) {
                gameContext.reportModalBackdrop.style.display = 'none';
            }
        });
    }
    
    // Screenshot report button
    const screenshotReportButton = document.getElementById('screenshot-report-button');
    if (screenshotReportButton) {
        screenshotReportButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const reportModal = document.getElementById('report-modal');
            if (!reportModal || !window.html2canvas) return;
            
            try {
                // Temporarily hide the button group for cleaner screenshot
                const buttonGroup = reportModal.querySelector('.button-group');
                if (buttonGroup) buttonGroup.style.visibility = 'hidden';
                
                const canvas = await window.html2canvas(reportModal, {
                    backgroundColor: '#1a1c18',
                    scale: 3, // Higher scale for better logo quality
                    useCORS: true,
                    allowTaint: true
                });
                
                // Restore button group
                if (buttonGroup) buttonGroup.style.visibility = 'visible';
                
                // Create download link
                const link = document.createElement('a');
                const timestamp = new Date().toISOString().slice(0, 10);
                link.download = `ethical-pursuit-report-${timestamp}.png`;
                link.href = canvas.toDataURL('image/png');
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } catch (error) {
                console.error('Screenshot failed:', error);
            }
        });
    }

    const scoreReportButton = document.getElementById('score-report-button');
    if (scoreReportButton) {
        scoreReportButton.addEventListener('click', () => showReport());
    }
    
    // R key to open report
    document.addEventListener('keydown', (e) => {
        if (e.code === 'KeyR' && gameContext.gameStartedAndReady) {
            // Don't open report if a modal is already open
            if (gameContext.reportModalBackdrop?.style.display === 'flex') {
                gameContext.reportModalBackdrop.style.display = 'none';
            } else {
                showReport();
            }
        }
    });

    if (gameContext.mapModalBackdrop && gameContext.closeMapButton) {
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
            // Start AudioContext immediately on user gesture
            if (window.Tone && Tone.context.state !== 'running') {
                await Tone.start();
                console.log('🔊 AudioContext started on user gesture');
            }
            await startGameWithMode('practice');
        });
    }
    
    if (huntSimulatorButton) {
        huntSimulatorButton.addEventListener('click', async () => {
            // Start AudioContext immediately on user gesture
            if (window.Tone && Tone.context.state !== 'running') {
                await Tone.start();
                console.log('🔊 AudioContext started on user gesture');
            }
            await startGameWithMode('simulator');
        });
    }
    
    // Instructions button (main menu)
    const instructionsButton = document.getElementById('instructions-button');
    const instructionsModal = document.getElementById('instructions-modal-backdrop');
    const closeInstructionsButton = document.getElementById('close-instructions-button');
    
    if (instructionsButton && instructionsModal) {
        instructionsButton.addEventListener('click', () => {
            instructionsModal.style.display = 'flex';
        });
    }
    
    // HUD instructions button (in-game)
    const hudInstructionsButton = document.getElementById('hud-instructions-button');
    if (hudInstructionsButton && instructionsModal) {
        hudInstructionsButton.addEventListener('click', () => {
            // Exit pointer lock when opening instructions
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
            instructionsModal.style.display = 'flex';
        });
    }
    
    if (closeInstructionsButton && instructionsModal) {
        closeInstructionsButton.addEventListener('click', () => {
            instructionsModal.style.display = 'none';
        });
    }
    
    // Close instructions on backdrop click
    if (instructionsModal) {
        instructionsModal.addEventListener('click', (e) => {
            if (e.target === instructionsModal) {
                instructionsModal.style.display = 'none';
            }
        });
        
        // Close instructions on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && instructionsModal.style.display === 'flex') {
                instructionsModal.style.display = 'none';
            }
        });
    }
    
    // Restart buttons (main menu and HUD)
    const restartButton = document.getElementById('restart-button');
    const hudRestartButton = document.getElementById('hud-restart-button');
    
    if (restartButton) {
        restartButton.addEventListener('click', () => {
            location.reload();
        });
    }
    
    if (hudRestartButton) {
        hudRestartButton.addEventListener('click', () => {
            location.reload();
        });
    }
    
    // Next Day button
    const nextDayButton = document.getElementById('next-day-button');
    if (nextDayButton) {
        nextDayButton.addEventListener('click', () => {
            advanceToNextDay();
        });
    }
    
    // Hitbox visibility toggle (debug mode)
    const showHitboxesCheckbox = document.getElementById('show-hitboxes');
    if (showHitboxesCheckbox) {
        showHitboxesCheckbox.addEventListener('change', (e) => {
            if (gameContext.collisionSystem) {
                // Set debugMode directly based on checkbox state
                gameContext.collisionSystem.debugMode = e.target.checked;
                gameContext.collisionSystem.updateHitboxVisibility();
            }
        });
    }
    
    initMap();
    // startTitleMusic();
}

/**
 * Advances the game to the next day.
 * Resets player position to starting point, resets time to 4:30 AM.
 * Keeps score, wounded deer state, and other stats intact.
 */
function advanceToNextDay() {
    // Exit pointer lock if active
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
    
    // Reset player position to starting point
    const INITIAL_PLAYER_X = 60;
    const INITIAL_PLAYER_Z = 60;
    const initialY = gameContext.getHeightAt(INITIAL_PLAYER_X, INITIAL_PLAYER_Z);
    gameContext.player.position.set(INITIAL_PLAYER_X, initialY, INITIAL_PLAYER_Z);
    gameContext.lastPlayerPosition.copy(gameContext.player.position);
    
    // Reset time to 4:30 AM
    gameContext.gameTime = 4.5;
    
    // Reset ambiance crossfade triggers for new day
    gameContext.eveningCrossfadeTriggered = false;
    gameContext.morningCrossfadeTriggered = false;
    
    // Reset map battery for new day
    gameContext.mapUsageCount = 0;
    gameContext.batteryLevel = 100;
    
    // Increment day counter (add if not exists)
    if (!gameContext.currentDay) {
        gameContext.currentDay = 1;
    }
    gameContext.currentDay++;
    
    // Update clock display
    if (gameContext.clockValueElement) {
        gameContext.clockValueElement.textContent = '04:30';
    }
    
    // Show message
    showMessage(`Day ${gameContext.currentDay} - New dawn breaks`, 3000);
    
    console.log(`🌅 Advanced to Day ${gameContext.currentDay}`);
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
    // Exclude indicators controlled separately by game state
    const gameUiElements = document.querySelectorAll('.initially-hidden:not(#kneeling-indicator):not(#mouse-look-indicator)');
    gameUiElements.forEach(el => {
        el.classList.remove('initially-hidden');
    });
    
    // Apply mode-specific configurations
    applyModeConfiguration(mode);
    
    // Add class to body to hide title screen background
    document.body.classList.add('game-active');
    
    // Show restart button now that game has started
    const restartButton = document.getElementById('restart-button');
    if (restartButton) {
        restartButton.style.display = 'inline-block';
    }
    
    // Initialize the game with the selected world and start the animation loop
    console.log('🎮 START GAME: Button clicked, checking gameContext.init:', !!gameContext.init, 'animate:', !!gameContext.animate);
    if (gameContext.init && gameContext.animate) {
        console.log('🎮 START GAME: About to call gameContext.init with world ID:', selectedWorld);
        try {
            await gameContext.init(selectedWorld);
            console.log('🎮 START GAME: gameContext.init completed, starting animation');
            gameContext.animate();
            
            // Set flag after a short delay to allow player to see the game before mouse control
            setTimeout(() => {
                gameContext.gameStartedAndReady = true;
            }, 500);
        } catch (error) {
            console.error('🛑 FATAL ERROR in gameContext.init:', error);
            showMessage('Error starting game: ' + error.message, 5000);
            // Restore main menu so user isn't stuck
            if (mainMenuContainer) mainMenuContainer.style.display = 'flex';
        }
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
    if (gameContext.deer.state === 'KILLED' && gameContext.deer.fallen && !gameContext.deer.tagged) {
        // Calculate distance on the XZ plane only, ignoring height differences
        const dx = gameContext.player.position.x - gameContext.deer.model.position.x;
        const dz = gameContext.player.position.z - gameContext.deer.model.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance <= TAG_INTERACTION_DISTANCE) {
            gameContext.interactionPromptElement.style.display = 'block';
            gameContext.interactionPromptElement.textContent = INTERACTION_PROMPT_TAG_DEER;
            gameContext.canTag = true;
            // Show manual tag button for testing
            showManualTagButton();
        } else {
            gameContext.interactionPromptElement.style.display = 'none';
            gameContext.canTag = false;
            // Hide manual tag button if too far
            hideManualTagButton();
        }
    } else {
        gameContext.interactionPromptElement.style.display = 'none';
        gameContext.canTag = false;
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
            if (gameContext.canTag && gameContext.tagDeer) {
                gameContext.tagDeer();
            }
        });
        document.body.appendChild(tagButton);
    }
    tagButton.style.display = 'block';
}

function hideManualTagButton() {
    const tagButton = document.getElementById('manual-tag-button');
    if (tagButton) {
        tagButton.style.display = 'none';
    }
}

// New function for status indicator
export function updateStatusIndicator(isKneeling) {
    const indicator = document.getElementById('status-indicator');
    if (indicator) {
        indicator.textContent = 'Kneeling';
        indicator.style.display = isKneeling ? 'block' : 'none';
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

// Cache last compass direction to avoid unnecessary DOM updates
let _lastCompassIndex = -1;

/**
 * Updates the compass display based on the player's current rotation.
 * Only updates DOM when direction actually changes.
 */
export function updateCompass() {
    let angle = -gameContext.player.rotation.y * (180 / Math.PI) + 180; // Convert radians to degrees, invert, and offset
    angle = (angle % 360 + 360) % 360; // Normalize angle to 0-359
    const index = Math.round(angle / 45) % COMPASS_DIRECTIONS.length;
    
    // Only update DOM if direction changed
    if (index !== _lastCompassIndex) {
        _lastCompassIndex = index;
        gameContext.compassElement.textContent = COMPASS_DIRECTIONS[index];
    }
}

/**
 * Shows the season complete modal with options to view report or start new season.
 */
export function showSeasonCompleteModal() {
    const modalBackdrop = document.getElementById('season-complete-modal-backdrop');
    const viewReportButton = document.getElementById('view-report-button');
    const startNewSeasonButton = document.getElementById('start-new-season-button');
    
    if (!modalBackdrop) {
        console.error('Season complete modal not found');
        return;
    }
    
    // Show the modal
    modalBackdrop.style.display = 'flex';
    
    // Exit pointer lock so user can interact with buttons
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
    
    // View Report button - shows the hunter's report
    if (viewReportButton) {
        viewReportButton.onclick = () => {
            // Hide season complete modal
            modalBackdrop.style.display = 'none';
            // Show the report modal
            gameContext.reportModalBackdrop.style.display = 'flex';
            gameContext.reportTitle.textContent = "Season Report";
            
            // Generate and display the report
            const currentReportHTML = generateCurrentReport();
            let fullReportHTML = currentReportHTML;
            
            if (gameContext.reportEntries.length > 0) {
                fullReportHTML += `<hr><h3>Previous Days</h3>`;
                fullReportHTML += gameContext.reportEntries.map(entry => `<h4>${entry.title}</h4><p>${entry.content}</p>`).join('<hr>');
            }
            
            gameContext.reportContent.innerHTML = fullReportHTML;
            
            // Modify close button to show season complete modal again
            const closeButton = document.getElementById('close-report-button');
            if (closeButton) {
                closeButton.onclick = () => {
                    gameContext.reportModalBackdrop.style.display = 'none';
                    modalBackdrop.style.display = 'flex';
                };
            }
        };
    }
    
    // Start New Season button - reloads the page
    if (startNewSeasonButton) {
        startNewSeasonButton.onclick = () => {
            location.reload();
        };
    }
}

/**
 * Toggles the HUD panel visibility
 */
export function toggleHUD() {
    const hudContainer = document.querySelector('.hud-container.top-left');
    const hudToggleButton = document.getElementById('hud-toggle-button');
    
    if (!hudContainer || !hudToggleButton) return;
    
    const isCollapsed = hudContainer.classList.toggle('hud-collapsed');
    
    // Update toggle button icon
    hudToggleButton.textContent = isCollapsed ? '▶' : '◀';
    hudToggleButton.title = isCollapsed ? 'Show HUD (H)' : 'Hide HUD (H)';
}
