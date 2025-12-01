// --- LOADING MANAGER ---
// Tracks asset loading progress and shows loading modal during game initialization

import { gameContext } from './context.js';

// Loading state
const loadingState = {
    isLoading: false,
    totalTasks: 0,
    completedTasks: 0,
    currentTask: '',
    tasks: new Map()
};

// DOM elements (cached on init)
let modalBackdrop = null;
let progressBar = null;
let statusText = null;
let detailsText = null;

/**
 * Initialize the loading manager and cache DOM elements
 */
export function initLoadingManager() {
    modalBackdrop = document.getElementById('loading-modal-backdrop');
    progressBar = document.getElementById('loading-progress-bar');
    statusText = document.getElementById('loading-status');
    detailsText = document.getElementById('loading-details');
}

/**
 * Show the loading modal and reset progress
 */
export function showLoadingModal() {
    if (!modalBackdrop) initLoadingManager();
    
    loadingState.isLoading = true;
    loadingState.totalTasks = 0;
    loadingState.completedTasks = 0;
    loadingState.currentTask = '';
    loadingState.tasks.clear();
    
    if (modalBackdrop) {
        modalBackdrop.style.display = 'flex';
    }
    updateProgress();
}

/**
 * Hide the loading modal
 */
export function hideLoadingModal() {
    loadingState.isLoading = false;
    
    if (modalBackdrop) {
        modalBackdrop.style.display = 'none';
    }
}

/**
 * Register a loading task
 * @param {string} taskId - Unique identifier for the task
 * @param {string} description - Human-readable description
 */
export function registerTask(taskId, description) {
    if (!loadingState.tasks.has(taskId)) {
        loadingState.tasks.set(taskId, { description, completed: false });
        loadingState.totalTasks++;
        updateProgress();
    }
}

/**
 * Mark a task as complete
 * @param {string} taskId - The task to mark complete
 */
export function completeTask(taskId) {
    const task = loadingState.tasks.get(taskId);
    if (task && !task.completed) {
        task.completed = true;
        loadingState.completedTasks++;
        console.log(`✅ Loaded: ${task.description}`);
        updateProgress();
        
        // Check if all tasks are complete
        if (loadingState.completedTasks >= loadingState.totalTasks) {
            onAllTasksComplete();
        }
    }
}

/**
 * Update the current loading status text
 * @param {string} status - Status message to display
 * @param {string} details - Optional detail text
 */
export function updateLoadingStatus(status, details = '') {
    loadingState.currentTask = status;
    if (statusText) statusText.textContent = status;
    if (detailsText) detailsText.textContent = details;
}

/**
 * Update the progress bar and status display
 */
function updateProgress() {
    const progress = loadingState.totalTasks > 0 
        ? (loadingState.completedTasks / loadingState.totalTasks) * 100 
        : 0;
    
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }
    
    // Update status with current incomplete task
    for (const [taskId, task] of loadingState.tasks) {
        if (!task.completed) {
            updateLoadingStatus(`Loading ${task.description}...`);
            break;
        }
    }
}

/**
 * Called when all loading tasks are complete
 */
function onAllTasksComplete() {
    updateLoadingStatus('Ready!', 'All assets loaded');
    
    // Brief delay to show "Ready!" before hiding
    setTimeout(() => {
        hideLoadingModal();
        
        // Dispatch event that game is ready
        window.dispatchEvent(new CustomEvent('gameAssetsLoaded'));
    }, 500);
}

/**
 * Check if all registered tasks are complete
 * @returns {boolean}
 */
export function isLoadingComplete() {
    return loadingState.completedTasks >= loadingState.totalTasks && loadingState.totalTasks > 0;
}

/**
 * Get current loading progress (0-100)
 * @returns {number}
 */
export function getLoadingProgress() {
    return loadingState.totalTasks > 0 
        ? (loadingState.completedTasks / loadingState.totalTasks) * 100 
        : 0;
}
