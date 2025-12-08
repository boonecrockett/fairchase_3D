// GPU-based grass shader with wind animation
import * as THREE from 'three';

/**
 * Creates efficient shader-based grass material with wind animation
 * All animation happens on GPU - zero CPU overhead
 */
export function createGrassShaderMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            windStrength: { value: 0.3 },
            windFrequency: { value: 1.5 },
            grassColor: { value: new THREE.Color(0x4a7c23) }, // Darker, truer grass green
            grassColorTip: { value: new THREE.Color(0x6b9b3a) }, // Slightly lighter tip
        },
        vertexShader: `
            uniform float time;
            uniform float windStrength;
            uniform float windFrequency;
            
            varying vec2 vUv;
            varying float vHeight;
            
            void main() {
                vUv = uv;
                vec3 pos = position;
                
                // Wind effect - stronger at top of grass blade
                float windEffect = pos.y * windStrength;
                float windWave = sin(time * windFrequency + pos.x * 0.5 + pos.z * 0.3) * windEffect;
                float windWave2 = sin(time * windFrequency * 0.7 + pos.x * 0.3 + pos.z * 0.5) * windEffect * 0.5;
                
                pos.x += windWave + windWave2;
                pos.z += windWave * 0.5;
                
                vHeight = pos.y;
                
                vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 grassColor;
            uniform vec3 grassColorTip;
            
            varying vec2 vUv;
            varying float vHeight;
            
            void main() {
                // Gradient from base to tip
                vec3 color = mix(grassColor, grassColorTip, vHeight * 0.5);
                
                // Simple alpha cutoff for grass blade shape
                float alpha = 1.0 - smoothstep(0.4, 0.5, abs(vUv.x - 0.5));
                
                if (alpha < 0.1) discard;
                
                gl_FragColor = vec4(color, alpha);
            }
        `,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: true,
    });
}

/**
 * Creates procedural grass blade geometry (no model needed)
 */
export function createGrassBladeGeometry() {
    const geometry = new THREE.BufferGeometry();
    
    // Simple grass blade - triangle strip
    const vertices = new Float32Array([
        -0.05, 0, 0,      // bottom left
         0.05, 0, 0,      // bottom right
        -0.03, 0.5, 0,    // middle left
         0.03, 0.5, 0,    // middle right
         0, 1.0, 0,       // top
    ]);
    
    const indices = new Uint16Array([
        0, 1, 2,
        1, 3, 2,
        2, 3, 4,
    ]);
    
    const uvs = new Float32Array([
        0, 0,
        1, 0,
        0.2, 0.5,
        0.8, 0.5,
        0.5, 1,
    ]);
    
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    
    return geometry;
}

/**
 * Updates grass shader time uniform for wind animation
 * Call this in your animation loop
 */
export function updateGrassWind(grassMesh, deltaTime) {
    if (grassMesh && grassMesh.material && grassMesh.material.uniforms) {
        grassMesh.material.uniforms.time.value += deltaTime;
    }
}
