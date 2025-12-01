// water-shader.js - Lightweight animated water shader
import * as THREE from 'three';

/**
 * Creates an animated water shader material with subtle ripple effects.
 * Designed for low performance overhead while still looking like water.
 */
export function createWaterMaterial(options = {}) {
    const {
        color = 0x1E3A8A,      // Deep blue
        opacity = 0.75,
        speed = 0.5,           // Animation speed
        rippleScale = 0.15,    // How pronounced the ripples are
    } = options;

    // Convert hex color to RGB
    const baseColor = new THREE.Color(color);

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Vector3(baseColor.r, baseColor.g, baseColor.b) },
            uOpacity: { value: opacity },
            uRippleScale: { value: rippleScale },
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vWorldPosition;
            
            void main() {
                vUv = uv;
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPos.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uRippleScale;
            
            varying vec2 vUv;
            varying vec3 vWorldPosition;
            
            void main() {
                // Static subtle variation based on position (no animation)
                vec2 pos = vWorldPosition.xz * 0.02;
                float pattern = sin(pos.x * 3.0) * sin(pos.y * 3.0) * 0.05;
                
                vec3 finalColor = uColor + vec3(pattern);
                
                // Edge fade for circular ponds
                float distFromCenter = length(vUv - 0.5) * 2.0;
                float edgeFade = smoothstep(0.98, 0.8, distFromCenter);
                
                gl_FragColor = vec4(finalColor, uOpacity * edgeFade);
            }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false, // Prevent z-fighting with terrain
    });

    return material;
}

/**
 * Updates all water materials with the current time.
 * Call this from the game loop.
 * @param {number} delta - Time since last frame
 */
export function updateWaterShader(delta) {
    // This is handled by updateWater in world.js which updates uTime
}
