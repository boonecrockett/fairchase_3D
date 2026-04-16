import { gameContext } from './context.js';

// Track the in-flight recoil animation so rapid follow-up shots cancel the
// previous recovery loop instead of stacking (which would otherwise mean
// multiple RAF callbacks fighting over camera.rotation and only the last one
// restoring controls correctly).
let _recoilAnimationId = null;
// The control-enabled state captured when the currently active recoil began.
let _recoilOriginalControlsEnabled = null;

export function applyRifleRecoil() {
    if (!gameContext.camera) {
        return;
    }

    // Cancel any in-flight recoil animation before starting a new one. This
    // guarantees only one recovery loop is active at a time.
    if (_recoilAnimationId !== null) {
        cancelAnimationFrame(_recoilAnimationId);
        _recoilAnimationId = null;
    }

    // Store original camera rotation for restoration
    const originalRotation = {
        x: gameContext.camera.rotation.x,
        y: gameContext.camera.rotation.y,
        z: gameContext.camera.rotation.z
    };
    
    // Recoil parameters with realistic variation
    const baseRecoilStrength = 0.01875; // Reduced by another 50% for very subtle recoil
    const horizontalVariation = 0.0075; // Reduced horizontal variation proportionally
    const rollVariation = 0.004; // Reduced roll variation proportionally
    const recoveryDuration = 400; // Recovery back to original position (ms)
    
    // Calculate realistic recoil with increased random variation
    const upwardRecoil = baseRecoilStrength + (Math.random() - 0.5) * 0.012; // Increased variation in upward kick
    const horizontalRecoil = (Math.random() - 0.5) * horizontalVariation * (0.8 + Math.random() * 0.4); // Variable horizontal intensity
    const rollRecoil = (Math.random() - 0.5) * rollVariation * (0.7 + Math.random() * 0.6); // Variable roll intensity
    
    // Add slight directional bias variation (not perfectly centered)
    const directionalBiasX = (Math.random() - 0.5) * 0.003; // Slight up/down bias
    const directionalBiasY = (Math.random() - 0.5) * 0.004; // Slight left/right bias

    // Temporarily disable controls if they exist. Only capture the "original"
    // enabled state on the first shot in a sequence (when no prior recoil is
    // in-flight); otherwise we'd capture our own disabled state and never
    // restore user controls.
    if (gameContext.controls) {
        if (_recoilOriginalControlsEnabled === null) {
            _recoilOriginalControlsEnabled = gameContext.controls.enabled;
        }
        gameContext.controls.enabled = false;
    }
    
    // Apply multi-axis recoil kick
    gameContext.camera.rotation.x += upwardRecoil + directionalBiasX; // Primary upward kick with slight bias
    gameContext.camera.rotation.y += horizontalRecoil + directionalBiasY; // Random horizontal movement with slight bias
    gameContext.camera.rotation.z += rollRecoil; // Slight roll/twist
    
    // Recovery target is the original rotation (prevents cumulative drift across shots)
    const recoveryTargetX = originalRotation.x;
    const recoveryTargetY = originalRotation.y;
    const recoveryTargetZ = originalRotation.z;

    // Pre-sample the random phase offsets once so the recovery curve isn't
    // re-randomized on every RAF tick (which caused non-deterministic per-
    // frame work and visual jitter in the previous implementation).
    const phaseX = Math.random();
    const phaseY = Math.random();
    const phaseZ = Math.random();

    const startTime = Date.now();

    function animateRecoilRecovery() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / recoveryDuration, 1);
        
        // Use easeOut curve for smooth recovery
        const easeOut = 1 - Math.pow(1 - progress, 3);
        
        // Add unpredictable variation throughout the recovery path (using the
        // phase offsets captured when the animation started).
        const recoveryVariationX = Math.sin(progress * Math.PI * 3 + phaseX) * 0.003;
        const recoveryVariationY = Math.cos(progress * Math.PI * 2.5 + phaseY) * 0.002;
        const recoveryVariationZ = Math.sin(progress * Math.PI * 4 + phaseZ) * 0.001;
        
        // Gradually return to varied recovery target (not exact origin)
        gameContext.camera.rotation.x = recoveryTargetX + upwardRecoil * (1 - easeOut) + recoveryVariationX + directionalBiasX * (1 - easeOut);
        gameContext.camera.rotation.y = recoveryTargetY + horizontalRecoil * (1 - easeOut) + recoveryVariationY + directionalBiasY * (1 - easeOut);
        gameContext.camera.rotation.z = recoveryTargetZ + rollRecoil * (1 - easeOut) + recoveryVariationZ;
        
        if (progress < 1) {
            _recoilAnimationId = requestAnimationFrame(animateRecoilRecovery);
        } else {
            // Settle at the varied recovery target position (not exact origin)
            gameContext.camera.rotation.x = recoveryTargetX;
            gameContext.camera.rotation.y = recoveryTargetY;
            gameContext.camera.rotation.z = recoveryTargetZ;

            _recoilAnimationId = null;

            // Re-enable controls to resume natural weapon sway
            if (gameContext.controls && _recoilOriginalControlsEnabled !== null) {
                gameContext.controls.enabled = _recoilOriginalControlsEnabled;
                _recoilOriginalControlsEnabled = null;
            }
        }
    }
    _recoilAnimationId = requestAnimationFrame(animateRecoilRecovery);
}
