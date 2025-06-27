/**
 * Pond Management Utilities
 * Easy way to add/remove the center pond without editing world presets directly
 */

/**
 * Removes all ponds from the scene (for easy cleanup)
 */
export function removePonds() {
    if (!gameContext.waterBodies) return;
    
    // Find and remove pond meshes from scene
    const pondsToRemove = gameContext.waterBodies.filter(water => water.userData.isPond);
    pondsToRemove.forEach(pond => {
        gameContext.scene.remove(pond);
        pond.geometry.dispose();
        pond.material.dispose();
    });
    
    // Remove ponds from waterBodies array
    gameContext.waterBodies = gameContext.waterBodies.filter(water => !water.userData.isPond);
    
    console.log(`Removed ${pondsToRemove.length} pond(s) from the scene`);
}

/**
 * Check if center pond exists
 */
export function hasCenterPond() {
    if (!gameContext.waterBodies) return false;
    return gameContext.waterBodies.some(water => 
        water.userData.isPond && 
        Math.abs(water.position.x) < 10 && 
        Math.abs(water.position.z) < 10
    );
}

/**
 * Get pond information for debugging
 */
export function getPondInfo() {
    if (!gameContext.waterBodies) return "No water bodies found";
    
    const ponds = gameContext.waterBodies.filter(water => water.userData.isPond);
    return ponds.map(pond => ({
        position: { x: pond.position.x, y: pond.position.y, z: pond.position.z },
        size: pond.userData.config.size,
        opacity: pond.userData.config.opacity
    }));
}

// Make functions available globally for easy console access
if (typeof window !== 'undefined') {
    window.removePonds = removePonds;
    window.hasCenterPond = hasCenterPond;
    window.getPondInfo = getPondInfo;
}
