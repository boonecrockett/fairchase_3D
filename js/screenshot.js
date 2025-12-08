/**
 * Screenshot functionality for capturing game moments
 * Captures the current canvas view and downloads as an image with branding
 */

import { gameContext } from './context.js';
import { showMessage } from './ui.js';

// Screenshot counter for unique filenames
let screenshotCounter = 0;

// Preload logo for branding
let logoImage = null;
const logoSrc = 'assets/BCC_Logo_blk.png';

function preloadLogo() {
    if (!logoImage) {
        logoImage = new Image();
        logoImage.src = logoSrc;
    }
}

/**
 * Captures a screenshot of the current game view
 * Downloads the image as a PNG file with timestamp and branding
 */
export function takeScreenshot() {
    if (!gameContext.renderer) {
        console.error('📷 Screenshot failed: Renderer not available');
        return;
    }
    
    try {
        // Force a render to ensure we capture the current frame
        if (gameContext.scene && gameContext.camera) {
            gameContext.renderer.render(gameContext.scene, gameContext.camera);
        }
        
        // Get the game canvas
        const gameCanvas = gameContext.renderer.domElement;
        
        // Check if scope is active
        const scopeOverlay = document.getElementById('scope-overlay');
        const isScoped = scopeOverlay && scopeOverlay.style.display !== 'none' && getComputedStyle(scopeOverlay).display !== 'none';
        
        // Use full resolution - get actual pixel dimensions
        const pixelRatio = gameContext.renderer.getPixelRatio();
        const canvasWidth = gameCanvas.width;
        const canvasHeight = gameCanvas.height;
        
        // Calculate center crop - 50% of the smaller dimension for square output
        const sourceSize = Math.min(canvasWidth, canvasHeight) * 0.50;
        const sourceX = (canvasWidth - sourceSize) / 2;
        const sourceY = (canvasHeight - sourceSize) / 2;
        
        // Output at full resolution (at least 1024px for quality)
        const outputSize = Math.max(Math.round(sourceSize), 1024);
        
        // Create a new canvas for the branded screenshot
        const brandedCanvas = document.createElement('canvas');
        brandedCanvas.width = outputSize;
        brandedCanvas.height = outputSize;
        const ctx = brandedCanvas.getContext('2d', { alpha: false });
        
        // Enable high quality image scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Draw the center-cropped game screenshot
        ctx.drawImage(
            gameCanvas,
            sourceX, sourceY, sourceSize, sourceSize,  // Source crop
            0, 0, outputSize, outputSize               // Destination
        );
        
        // Draw scope overlay if scoped - matches the CSS scope overlay
        if (isScoped) {
            drawScopeOverlay(ctx, outputSize);
        }
        
        // Add branding overlay
        addBranding(ctx, brandedCanvas.width, brandedCanvas.height);
        
        // Get the branded image as PNG
        const dataURL = brandedCanvas.toDataURL('image/png');
        
        // Create timestamp for filename
        const now = new Date();
        const timestamp = now.toISOString()
            .replace(/[:.]/g, '-')
            .replace('T', '_')
            .slice(0, 19);
        
        // Increment counter for unique names
        screenshotCounter++;
        
        // Create download link
        const link = document.createElement('a');
        link.download = `EthicalPursuit_${timestamp}_${screenshotCounter}.png`;
        link.href = dataURL;
        
        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Show confirmation message
        showMessage('📷 Screenshot saved!', 1500);
        
        // Play camera shutter sound effect (optional visual flash)
        flashScreen();
        
        console.log(`📷 Screenshot captured: ${link.download}`);
        
    } catch (error) {
        console.error('📷 Screenshot failed:', error);
        showMessage('Screenshot failed', 2000);
    }
}

/**
 * Draws the scope overlay on the screenshot
 * Replicates the CSS scope-overlay styling:
 * radial-gradient(circle, transparent 40%, rgba(0,0,0,0.8) 42%, black 55%)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} size - Canvas size (square)
 */
function drawScopeOverlay(ctx, size) {
    const centerX = size / 2;
    const centerY = size / 2;
    
    // The CSS uses percentage of the element size for the gradient
    // Since we crop to 50% of screen, and the scope is 40% radius of full screen,
    // the scope circle should be at 80% radius of our cropped image (40/50 = 0.8)
    const gradientRadius = size / 2; // Radius from center to edge
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, gradientRadius);
    
    // Match CSS: transparent 40%, rgba(0,0,0,0.8) 42%, black 55%
    // But scaled for our 50% crop: 40/50=0.8, 42/50=0.84, 55/50=1.1 (capped at 1.0)
    gradient.addColorStop(0.0, 'rgba(0, 0, 0, 0)');       // Clear center
    gradient.addColorStop(0.78, 'rgba(0, 0, 0, 0)');      // Clear until scope edge
    gradient.addColorStop(0.82, 'rgba(0, 0, 0, 0.8)');    // Quick transition
    gradient.addColorStop(0.92, 'rgba(0, 0, 0, 1)');      // Fully black
    gradient.addColorStop(1.0, 'rgba(0, 0, 0, 1)');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    
    // Draw crosshair lines (dark, thin) - only in the visible scope area
    ctx.strokeStyle = 'rgba(20, 20, 20, 0.7)';
    ctx.lineWidth = 1;
    
    // Vertical line
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, size);
    ctx.stroke();
    
    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(size, centerY);
    ctx.stroke();
    
    // Draw center red dot
    ctx.fillStyle = 'rgba(200, 0, 0, 0.9)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 2, 0, Math.PI * 2);
    ctx.fill();
}

/**
 * Adds branding overlay to the screenshot
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 */
function addBranding(ctx, width, height) {
    // Scale UI elements based on output size (base design at 1024px)
    const scaleFactor = width / 1024;
    const padding = Math.round(25 * scaleFactor);
    const logoDisplaySize = Math.round(100 * scaleFactor); // Scale logo with output
    
    // Semi-transparent background bar at bottom
    const barHeight = Math.round(115 * scaleFactor);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, height - barHeight, width, barHeight);
    
    // Draw logo if loaded (invert black logo to white)
    const logoX = padding;
    const logoY = height - barHeight + (barHeight - logoDisplaySize) / 2;
    
    if (logoImage && logoImage.complete && logoImage.naturalWidth > 0) {
        // Use the full source resolution for maximum quality
        const sourceWidth = logoImage.naturalWidth;
        const sourceHeight = logoImage.naturalHeight;
        
        // Create temporary canvas at source resolution for crisp logo
        const logoCanvas = document.createElement('canvas');
        logoCanvas.width = sourceWidth;
        logoCanvas.height = sourceHeight;
        const logoCtx = logoCanvas.getContext('2d');
        
        // Disable smoothing when drawing at native resolution
        logoCtx.imageSmoothingEnabled = false;
        
        // Draw original logo at native resolution
        logoCtx.drawImage(logoImage, 0, 0, sourceWidth, sourceHeight);
        
        // Invert colors (black becomes white)
        logoCtx.globalCompositeOperation = 'source-in';
        logoCtx.fillStyle = '#ffffff';
        logoCtx.fillRect(0, 0, sourceWidth, sourceHeight);
        
        // Draw high-res logo scaled down to display size with high quality interpolation
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(logoCanvas, logoX, logoY, logoDisplaySize, logoDisplaySize);
    }
    
    // "Ethical Pursuit" title text (scaled)
    const titleFontSize = Math.round(28 * scaleFactor);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${titleFontSize}px "Segoe UI", Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    const titleX = logoX + logoDisplaySize + Math.round(18 * scaleFactor);
    const titleY = height - barHeight / 2 - Math.round(8 * scaleFactor);
    ctx.fillText('Ethical Pursuit', titleX, titleY);
    
    // Web address below title (scaled)
    const urlFontSize = Math.round(16 * scaleFactor);
    ctx.fillStyle = '#cccccc';
    ctx.font = `${urlFontSize}px "Segoe UI", Arial, sans-serif`;
    const urlY = height - barHeight / 2 + Math.round(18 * scaleFactor);
    ctx.fillText('boone-crockett.org', titleX, urlY);
    
    // Timestamp on the right side (scaled)
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    });
    const timeStr = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    const timestampFontSize = Math.round(12 * scaleFactor);
    ctx.fillStyle = '#999999';
    ctx.font = `${timestampFontSize}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(`${dateStr} • ${timeStr}`, width - padding, height - barHeight / 2);
    ctx.textAlign = 'left'; // Reset
}

/**
 * Creates a brief white flash effect to simulate camera shutter
 */
function flashScreen() {
    const flash = document.createElement('div');
    flash.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: white;
        opacity: 0.3;
        pointer-events: none;
        z-index: 99999;
        transition: opacity 0.15s ease-out;
    `;
    
    document.body.appendChild(flash);
    
    // Fade out and remove
    requestAnimationFrame(() => {
        flash.style.opacity = '0';
        setTimeout(() => {
            if (flash.parentNode) {
                flash.parentNode.removeChild(flash);
            }
        }, 150);
    });
}

/**
 * Initialize screenshot keyboard listener
 * Uses 'P' key for "Photo"
 */
export function initScreenshotListener() {
    // Preload logo for branding
    preloadLogo();
    
    document.addEventListener('keydown', (event) => {
        // P key for Photo/Screenshot
        if (event.code === 'KeyP' && !event.repeat) {
            // Don't capture if typing in an input field
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                return;
            }
            
            event.preventDefault();
            takeScreenshot();
        }
    });
    
    console.log('📷 Screenshot system initialized (Press P to capture)');
}
