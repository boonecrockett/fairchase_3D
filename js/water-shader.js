// water-shader.js - Lightweight animated water shader
import * as THREE from 'three';

/**
 * Creates an animated water shader material with a smooth organic shoreline.
 * The pond shape is clipped in the fragment shader so the bank is not a polygon.
 */
export function createWaterMaterial(options = {}) {
    const {
        color = 0x1E3A8A,
        opacity = 0.75,
        speed = 0.5,
        rippleScale = 0.15,
        center = new THREE.Vector2(0, 0),
        baseRadius = 50,
        seed = 2.7,
        shoreWidth = 3.5,
        useMask = true,
    } = options;

    const baseColor = new THREE.Color(color);

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Vector3(baseColor.r, baseColor.g, baseColor.b) },
            uOpacity: { value: opacity },
            uRippleScale: { value: rippleScale },
            uSpeed: { value: speed },
            uCenter: { value: center.clone() },
            uBaseRadius: { value: baseRadius },
            uSeed: { value: seed },
            uShoreWidth: { value: shoreWidth },
            uUseMask: { value: useMask ? 1 : 0 },
        },
        vertexShader: `
            varying vec3 vWorldPosition;
            varying vec3 vNormal;

            void main() {
                vNormal = normalize(normalMatrix * normal);
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
            uniform float uSpeed;
            uniform vec2 uCenter;
            uniform float uBaseRadius;
            uniform float uSeed;
            uniform float uShoreWidth;
            uniform float uUseMask;

            varying vec3 vWorldPosition;
            varying vec3 vNormal;

            float organicRadius(float angle, float baseR, float seed) {
                float n1 = sin(angle * 2.0 + seed) * 0.13;
                float n2 = sin(angle * 3.0 - seed * 1.7) * 0.08;
                float n3 = sin(angle * 5.0 + seed * 0.45) * 0.045;
                float n4 = sin(angle * 9.0 - seed * 0.8) * 0.02;
                float ellipse = 1.0 + 0.18 * cos(2.0 * angle + seed * 0.9);
                return baseR * ellipse * (1.0 + n1 + n2 + n3 + n4);
            }

            void main() {
                vec2 offset = vWorldPosition.xz - uCenter;
                float dist = length(offset);
                float angle = atan(offset.y, offset.x);
                float shoreNoise =
                    sin(offset.x * 0.16 + uSeed) * sin(offset.y * 0.14 - uSeed * 1.1) * 2.4 +
                    sin(offset.x * 0.31 - offset.y * 0.22 + uSeed * 2.0) * 1.1;
                float radius = organicRadius(angle, uBaseRadius, uSeed) + shoreNoise;
                float inside = radius - dist;
                float edgeFade = uUseMask > 0.5
                    ? smoothstep(-0.4, uShoreWidth, inside)
                    : 1.0;
                if (edgeFade < 0.01) discard;

                vec2 pos = vWorldPosition.xz * 0.02;
                float t = uTime * uSpeed;
                float ripple =
                    sin(pos.x * 3.0 + t) * sin(pos.y * 3.0 + t * 0.8) * uRippleScale +
                    sin(pos.x * 7.0 - t * 1.3) * sin(pos.y * 5.0 + t * 0.6) * uRippleScale * 0.45;

                float fresnel = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 1.0, 0.0))), 2.0);
                vec3 highlight = vec3(0.15, 0.25, 0.35) * fresnel;
                vec3 finalColor = uColor + vec3(ripple) + highlight;

                gl_FragColor = vec4(finalColor, uOpacity * edgeFade);
            }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
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
