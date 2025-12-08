// --- ANIMATION CALIBRATION TOOL ---
// Debug utility for calibrating deer animation speed vs movement speed
// Access via: window.animationCalibrator.show() or press F9

import * as THREE from 'three';
import { gameContext } from './context.js';

class AnimationCalibrator {
    constructor() {
        this.panel = null;
        this.isVisible = false;
        this.overrideEnabled = false;
        
        // Override values - animation
        this.walkTimeScale = 1.0;
        this.runTimeScale = 1.0;
        this.woundedRunTimeScale = 0.7;
        
        // Override values - movement speed
        this.movementSpeedMultiplier = 1.0;
        
        // Presets for different wound types
        this.presets = {
            heart: { speedMult: 1.8, baseSpeed: 10.0 },
            doubleLung: { speedMult: 1.5, baseSpeed: 10.0 },
            singleLung: { speedMult: 0.9, baseSpeed: 10.0 },
            liver: { speedMult: 0.5, baseSpeed: 10.0 },
            gut: { speedMult: 0.4, baseSpeed: 10.0 },
            muscle: { speedMult: 1.3, baseSpeed: 10.0 },
            shoulder: { speedMult: 0.6, baseSpeed: 10.0 },
        };
        
        // Add keyboard listener for toggle (F9 key)
        this.keydownHandler = (e) => {
            if (e.key === 'F9') {
                e.preventDefault();
                e.stopPropagation();
                console.log('F9 pressed, isVisible:', this.isVisible);
                if (this.isVisible) {
                    this.hide();
                } else {
                    this.show();
                }
            }
        };
        document.addEventListener('keydown', this.keydownHandler, true); // Use capture phase
    }

    createPanel() {
        if (this.panel) return;

        this.panel = document.createElement('div');
        this.panel.id = 'animation-calibrator';
        this.panel.innerHTML = `
            <style>
                #animation-calibrator {
                    position: fixed;
                    top: 10px;
                    left: 10px;
                    width: 320px;
                    background: rgba(20, 20, 20, 0.95);
                    border: 2px solid #9eb529;
                    border-radius: 8px;
                    padding: 15px;
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 12px;
                    color: #beb5a3;
                    z-index: 10000;
                    cursor: move;
                }
                #animation-calibrator h3 {
                    margin: 0 0 10px 0;
                    color: #9eb529;
                    font-size: 14px;
                    border-bottom: 1px solid #5f4d4d;
                    padding-bottom: 8px;
                }
                #animation-calibrator .section {
                    margin-bottom: 12px;
                    padding: 8px;
                    background: rgba(0,0,0,0.3);
                    border-radius: 4px;
                }
                #animation-calibrator .section-title {
                    color: #2a6496;
                    font-weight: bold;
                    margin-bottom: 6px;
                }
                #animation-calibrator .row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin: 4px 0;
                }
                #animation-calibrator .label {
                    flex: 1;
                }
                #animation-calibrator .value {
                    width: 60px;
                    text-align: right;
                    color: #9eb529;
                    font-weight: bold;
                }
                #animation-calibrator input[type="range"] {
                    width: 120px;
                    margin: 0 8px;
                }
                #animation-calibrator input[type="checkbox"] {
                    margin-right: 8px;
                }
                #animation-calibrator button {
                    background: #5f4d4d;
                    border: 1px solid #9eb529;
                    color: #beb5a3;
                    padding: 6px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    margin: 2px;
                    font-size: 11px;
                }
                #animation-calibrator button:hover {
                    background: #9eb529;
                    color: #2a2b2f;
                }
                #animation-calibrator .preset-btn {
                    padding: 4px 8px;
                    font-size: 10px;
                }
                #animation-calibrator .close-btn {
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    background: #a63d2a;
                    border: none;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    cursor: pointer;
                    color: white;
                    font-size: 12px;
                    line-height: 1;
                }
                #animation-calibrator .live-stats {
                    background: rgba(42, 100, 150, 0.2);
                    padding: 8px;
                    border-radius: 4px;
                    margin-top: 8px;
                }
                #animation-calibrator .stat-row {
                    display: flex;
                    justify-content: space-between;
                    margin: 2px 0;
                }
                #animation-calibrator .stat-label {
                    color: #888;
                }
                #animation-calibrator .stat-value {
                    color: #9eb529;
                    font-weight: bold;
                }
            </style>
            <button class="close-btn" onclick="window.animationCalibrator.hide()">×</button>
            <h3>🦌 Animation Calibrator</h3>
            
            <div class="section">
                <div class="row">
                    <input type="checkbox" id="cal-override-enabled">
                    <label for="cal-override-enabled">Enable Manual Override</label>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">Animation Time Scales</div>
                <div class="row">
                    <span class="label">Walk:</span>
                    <input type="range" id="cal-walk" min="0.1" max="3.0" step="0.05" value="1.0">
                    <span class="value" id="cal-walk-val">1.00</span>
                </div>
                <div class="row">
                    <span class="label">Run (Normal):</span>
                    <input type="range" id="cal-run" min="0.1" max="2.0" step="0.05" value="1.0">
                    <span class="value" id="cal-run-val">1.00</span>
                </div>
                <div class="row">
                    <span class="label">Run (Wounded):</span>
                    <input type="range" id="cal-wounded" min="0.1" max="2.0" step="0.05" value="0.7">
                    <span class="value" id="cal-wounded-val">0.70</span>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">Movement Speed</div>
                <div class="row">
                    <span class="label">Speed Mult:</span>
                    <input type="range" id="cal-move-speed" min="0.1" max="3.0" step="0.05" value="1.0">
                    <span class="value" id="cal-move-speed-val">1.00</span>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">Deer Control</div>
                <div class="row">
                    <button onclick="window.animationCalibrator.teleportDeerToPlayer()">📍 Bring Deer Here</button>
                    <button onclick="window.animationCalibrator.reviveDeer()">💚 Revive Deer</button>
                </div>
                <div class="section-title" style="margin-top: 8px;">Force State</div>
                <div class="row">
                    <button onclick="window.animationCalibrator.forceDeerState('WANDERING')">Wander</button>
                    <button onclick="window.animationCalibrator.forceDeerState('FLEEING')">Flee</button>
                    <button onclick="window.animationCalibrator.forceDeerState('WOUNDED')">Wound</button>
                </div>
                <div class="section-title" style="margin-top: 8px;">Wound Type Presets</div>
                <div class="row" style="flex-wrap: wrap;">
                    <button class="preset-btn" onclick="window.animationCalibrator.applyWoundPreset('heart')">Heart</button>
                    <button class="preset-btn" onclick="window.animationCalibrator.applyWoundPreset('doubleLung')">Dbl Lung</button>
                    <button class="preset-btn" onclick="window.animationCalibrator.applyWoundPreset('singleLung')">Sgl Lung</button>
                    <button class="preset-btn" onclick="window.animationCalibrator.applyWoundPreset('liver')">Liver</button>
                    <button class="preset-btn" onclick="window.animationCalibrator.applyWoundPreset('gut')">Gut</button>
                    <button class="preset-btn" onclick="window.animationCalibrator.applyWoundPreset('muscle')">Muscle</button>
                    <button class="preset-btn" onclick="window.animationCalibrator.applyWoundPreset('shoulder')">Shoulder</button>
                </div>
            </div>
            
            <div class="live-stats">
                <div class="section-title">Live Stats</div>
                <div class="stat-row">
                    <span class="stat-label">State:</span>
                    <span class="stat-value" id="cal-stat-state">-</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Animation:</span>
                    <span class="stat-value" id="cal-stat-anim">-</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Move Speed:</span>
                    <span class="stat-value" id="cal-stat-speed">-</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Anim TimeScale:</span>
                    <span class="stat-value" id="cal-stat-timescale">-</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Wound Type:</span>
                    <span class="stat-value" id="cal-stat-wound">-</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Speed Mult:</span>
                    <span class="stat-value" id="cal-stat-mult">-</span>
                </div>
            </div>
            
            <div class="section" style="margin-top: 10px;">
                <button onclick="window.animationCalibrator.copyConfig()">📋 Copy Config</button>
                <button onclick="window.animationCalibrator.resetToDefaults()">🔄 Reset</button>
            </div>
        `;

        document.body.appendChild(this.panel);
        
        // Prevent clicks on the panel from triggering pointer lock
        // Use bubbling phase (false) so button onclick handlers fire first
        this.panel.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        }, false);
        
        this.setupEventListeners();
        this.makeDraggable();
        this.startLiveUpdate();
    }

    setupEventListeners() {
        // Override checkbox
        document.getElementById('cal-override-enabled').addEventListener('change', (e) => {
            this.overrideEnabled = e.target.checked;
        });

        // Sliders
        const sliders = [
            { id: 'cal-walk', prop: 'walkTimeScale', valId: 'cal-walk-val' },
            { id: 'cal-run', prop: 'runTimeScale', valId: 'cal-run-val' },
            { id: 'cal-wounded', prop: 'woundedRunTimeScale', valId: 'cal-wounded-val' },
            { id: 'cal-move-speed', prop: 'movementSpeedMultiplier', valId: 'cal-move-speed-val' },
        ];

        sliders.forEach(({ id, prop, valId }) => {
            const slider = document.getElementById(id);
            const valDisplay = document.getElementById(valId);
            
            slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this[prop] = val;
                valDisplay.textContent = val.toFixed(2);
            });
        });
    }

    makeDraggable() {
        let isDragging = false;
        let offsetX, offsetY;

        this.panel.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
            isDragging = true;
            offsetX = e.clientX - this.panel.offsetLeft;
            offsetY = e.clientY - this.panel.offsetTop;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            this.panel.style.left = (e.clientX - offsetX) + 'px';
            this.panel.style.top = (e.clientY - offsetY) + 'px';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    startLiveUpdate() {
        setInterval(() => {
            if (!this.isVisible) return;
            this.updateLiveStats();
        }, 100);
    }

    updateLiveStats() {
        const deer = gameContext.deer;
        if (!deer) return;

        document.getElementById('cal-stat-state').textContent = deer.state || '-';
        document.getElementById('cal-stat-anim').textContent = deer.animation?.currentAnimation || '-';
        document.getElementById('cal-stat-speed').textContent = (deer.currentSpeed || 0).toFixed(2);
        document.getElementById('cal-stat-timescale').textContent = 
            deer.activeAction?.timeScale?.toFixed(3) || '-';
        
        const woundType = deer.woundState?.woundType?.name || '-';
        document.getElementById('cal-stat-wound').textContent = woundType;
        
        const speedMult = deer.woundState?.getSpeedMultiplier?.() || '-';
        document.getElementById('cal-stat-mult').textContent = 
            typeof speedMult === 'number' ? speedMult.toFixed(2) : speedMult;
    }

    reviveDeer() {
        const deer = gameContext.deer;
        if (!deer) {
            console.warn('No deer found in gameContext');
            return;
        }
        
        // Reset wound state
        if (deer.woundState) {
            deer.woundState.reset();
        }
        
        // Reset animation state
        if (deer.animation) {
            deer.animation.reset();
        }
        
        // Reset deer state to wandering
        deer.setState('WANDERING');
        deer.stateTimer = 0;
        
        // Reset any death-related flags
        deer.isDead = false;
        deer.isTagged = false;
        
        // Make sure deer is visible and standing
        if (deer.model) {
            deer.model.visible = true;
            deer.model.rotation.x = 0;
            deer.model.rotation.z = 0;
        }
        
        // Generate a new wander target
        if (deer.movement) {
            deer.movement.generateNewWanderTarget();
        }
        
        console.log('Deer revived and set to WANDERING state');
    }

    teleportDeerToPlayer() {
        const deer = gameContext.deer;
        if (!deer || !deer.model) {
            console.warn('No deer found in gameContext');
            return;
        }
        
        const player = gameContext.player;
        const camera = gameContext.camera;
        if (!player || !camera) {
            console.warn('No player/camera found');
            return;
        }
        
        // Get camera forward direction (ignore Y to keep deer on ground)
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(camera.quaternion);
        forward.y = 0;
        forward.normalize();
        
        // Place deer 20 units in front of player
        const newPos = player.position.clone();
        newPos.add(forward.multiplyScalar(20));
        
        // Set deer position
        deer.model.position.x = newPos.x;
        deer.model.position.z = newPos.z;
        
        // Update height to terrain
        if (gameContext.getHeightAt) {
            deer.model.position.y = gameContext.getHeightAt(newPos.x, newPos.z) + (deer.config?.heightOffset || 0);
        }
        
        // Make deer face the player
        const toPlayer = new THREE.Vector3();
        toPlayer.subVectors(player.position, deer.model.position);
        toPlayer.y = 0;
        const angle = Math.atan2(toPlayer.x, toPlayer.z);
        deer.model.rotation.y = angle;
        
        // Update wander target to current position so it doesn't immediately run off
        if (deer.movement) {
            deer.movement.wanderTarget.copy(deer.model.position);
        }
        
        console.log('Deer teleported in front of player');
    }

    forceDeerState(state) {
        const deer = gameContext.deer;
        if (!deer) {
            console.warn('No deer found in gameContext');
            return;
        }

        if (state === 'WOUNDED') {
            // Import wound system and apply a default wound
            import('./wound-system.js').then(({ WOUND_TYPES }) => {
                deer.woundState.applyWound(WOUND_TYPES.DOUBLE_LUNG, deer.model.position);
                deer.setState('WOUNDED');
                console.log('Applied DOUBLE_LUNG wound');
            });
        } else {
            deer.setState(state);
            if (state === 'WANDERING') {
                deer.movement.generateNewWanderTarget();
            }
        }
    }

    applyWoundPreset(presetName) {
        const deer = gameContext.deer;
        if (!deer) return;

        import('./wound-system.js').then(({ WOUND_TYPES }) => {
            const woundTypeMap = {
                heart: WOUND_TYPES.HEART,
                doubleLung: WOUND_TYPES.DOUBLE_LUNG,
                singleLung: WOUND_TYPES.SINGLE_LUNG,
                liver: WOUND_TYPES.LIVER,
                gut: WOUND_TYPES.GUT,
                muscle: WOUND_TYPES.MUSCLE,
                shoulder: WOUND_TYPES.SHOULDER,
            };

            const woundType = woundTypeMap[presetName];
            if (woundType) {
                deer.woundState.applyWound(woundType, deer.model.position);
                deer.setState('WOUNDED');
                console.log(`Applied ${presetName} wound (speed mult: ${woundType.speedMultiplier})`);
            }
        });
    }

    copyConfig() {
        const config = {
            walkTimeScale: this.walkTimeScale,
            runTimeScale: this.runTimeScale,
            woundedRunTimeScale: this.woundedRunTimeScale,
            movementSpeedMultiplier: this.movementSpeedMultiplier,
        };
        
        const configStr = JSON.stringify(config, null, 2);
        navigator.clipboard.writeText(configStr).then(() => {
            console.log('Config copied to clipboard:', config);
            alert('Config copied to clipboard!');
        });
    }

    resetToDefaults() {
        this.walkTimeScale = 1.0;
        this.runTimeScale = 1.0;
        this.woundedRunTimeScale = 0.7;
        this.movementSpeedMultiplier = 1.0;
        
        document.getElementById('cal-walk').value = 1.0;
        document.getElementById('cal-walk-val').textContent = '1.00';
        document.getElementById('cal-run').value = 1.0;
        document.getElementById('cal-run-val').textContent = '1.00';
        document.getElementById('cal-wounded').value = 0.7;
        document.getElementById('cal-wounded-val').textContent = '0.70';
        document.getElementById('cal-move-speed').value = 1.0;
        document.getElementById('cal-move-speed-val').textContent = '1.00';
    }

    // Called from deer-animation.js to get override values
    getOverrideTimeScale(animationType, deerState) {
        if (!this.overrideEnabled) return null;

        if (animationType === 'Walk') {
            return this.walkTimeScale;
        } else if (animationType === 'Run') {
            if (deerState === 'WOUNDED') {
                return this.woundedRunTimeScale;
            }
            return this.runTimeScale;
        }
        return null;
    }
    
    // Called from deer-ai.js to get movement speed multiplier
    getMovementSpeedMultiplier() {
        if (!this.overrideEnabled) return null;
        return this.movementSpeedMultiplier;
    }

    show() {
        if (!this.panel) {
            this.createPanel();
        }
        this.panel.style.display = 'block';
        this.isVisible = true;
        
        // Exit pointer lock so user can interact with the panel
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
        
        console.log('Animation Calibrator opened. Press F9 to toggle. Use sliders to adjust animation speeds.');
    }

    hide() {
        if (this.panel) {
            this.panel.style.display = 'none';
        }
        this.isVisible = false;
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }
}

// Create global instance
const animationCalibrator = new AnimationCalibrator();
window.animationCalibrator = animationCalibrator;

export { animationCalibrator };
