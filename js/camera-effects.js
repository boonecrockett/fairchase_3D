import { gameContext } from './context.js';

// Rifle recoil effect - kicks camera upward and slightly backward
export function applyRifleRecoil() {
    if (!gameContext.camera) {
        return;
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
    const recoilDuration = 100; // Hold duration (ms)
    const recoveryDuration = 400; // Recovery back to original position (ms)
    
    // Calculate realistic recoil with increased random variation
    const upwardRecoil = baseRecoilStrength + (Math.random() - 0.5) * 0.012; // Increased variation in upward kick
    const horizontalRecoil = (Math.random() - 0.5) * horizontalVariation * (0.8 + Math.random() * 0.4); // Variable horizontal intensity
    const rollRecoil = (Math.random() - 0.5) * rollVariation * (0.7 + Math.random() * 0.6); // Variable roll intensity
    
    // Add slight directional bias variation (not perfectly centered)
    const directionalBiasX = (Math.random() - 0.5) * 0.003; // Slight up/down bias
    const directionalBiasY = (Math.random() - 0.5) * 0.004; // Slight left/right bias
    
    // Temporarily disable controls if they exist
    const controlsEnabled = gameContext.controls ? gameContext.controls.enabled : null;
    if (gameContext.controls) {
        gameContext.controls.enabled = false;
    }
    
    // Apply multi-axis recoil kick
    gameContext.camera.rotation.x += upwardRecoil + directionalBiasX; // Primary upward kick with slight bias
    gameContext.camera.rotation.y += horizontalRecoil + directionalBiasY; // Random horizontal movement with slight bias
    gameContext.camera.rotation.z += rollRecoil; // Slight roll/twist
    
    // Calculate varied recovery endpoint (not exact return to origin)
    const recoveryOffsetX = (Math.random() - 0.5) * 0.05; // Dramatically increased vertical offset variation
    const recoveryOffsetY = (Math.random() - 0.5) * 0.06; // Dramatically increased horizontal offset variation
    const recoveryOffsetZ = (Math.random() - 0.5) * 0.025; // Dramatically increased roll offset variation
    
    // Calculate final recovery target position
    const recoveryTargetX = originalRotation.x + recoveryOffsetX;
    const recoveryTargetY = originalRotation.y + recoveryOffsetY;
    const recoveryTargetZ = originalRotation.z + recoveryOffsetZ;
    
    // Smooth recovery animation - gradually reduce recoil effect
    const startTime = Date.now();
    
    function animateRecoilRecovery() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / recoveryDuration, 1);
        
        // Use easeOut curve for smooth recovery
        const easeOut = 1 - Math.pow(1 - progress, 3);
        
        // Add unpredictable variation throughout the recovery path
        const recoveryVariationX = Math.sin(progress * Math.PI * 3 + Math.random()) * 0.003; // Unpredictable vertical path
        const recoveryVariationY = Math.cos(progress * Math.PI * 2.5 + Math.random()) * 0.002; // Unpredictable horizontal path
        const recoveryVariationZ = Math.sin(progress * Math.PI * 4 + Math.random()) * 0.001; // Unpredictable roll path
        
        // Gradually return to varied recovery target (not exact origin)
        gameContext.camera.rotation.x = recoveryTargetX + upwardRecoil * (1 - easeOut) + recoveryVariationX + directionalBiasX * (1 - easeOut);
        gameContext.camera.rotation.y = recoveryTargetY + horizontalRecoil * (1 - easeOut) + recoveryVariationY + directionalBiasY * (1 - easeOut);
        gameContext.camera.rotation.z = recoveryTargetZ + rollRecoil * (1 - easeOut) + recoveryVariationZ;
        
        if (progress < 1) {
            requestAnimationFrame(animateRecoilRecovery);
        } else {
            // Settle at the varied recovery target position (not exact origin)
            gameContext.camera.rotation.x = recoveryTargetX;
            gameContext.camera.rotation.y = recoveryTargetY;
            gameContext.camera.rotation.z = recoveryTargetZ;
            
            // Re-enable controls to resume natural weapon sway
            if (gameContext.controls && controlsEnabled !== null) {
                gameContext.controls.enabled = controlsEnabled;
            }
        }
    }
    requestAnimationFrame(animateRecoilRecovery);
}
