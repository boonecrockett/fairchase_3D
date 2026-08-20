// GPU-based grass shader with wind animation
import * as THREE from 'three';

/**
 * Creates efficient shader-based grass material with wind animation
 * All animation happens on GPU - zero CPU overhead
 */
export function createGrassShaderMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            {
                time: { value: 0 },
                windStrength: { value: 0.07 },
                windFrequency: { value: 0.85 },
                grassColor: { value: new THREE.Color(0x4a7c23) }, // Darker, truer grass green
                grassColorTip: { value: new THREE.Color(0x6b9b3a) }, // Slightly lighter tip
                lightLevel: { value: 1.0 },
            },
        ]),
        vertexShader: `
            uniform float time;
            uniform float windStrength;
            uniform float windFrequency;
            
            varying vec2 vUv;
            varying float vHeight;
            #include <fog_pars_vertex>
            
            void main() {
                vUv = uv;
                vec3 pos = position;
                vec3 instanceOffset = vec3(instanceMatrix[3]);
                
                // Light breeze at the tip only. Keep the base planted.
                float windEffect = pos.y * pos.y * windStrength;
                float windWave = sin(
                    time * windFrequency
                    + instanceOffset.x * 0.18
                    + instanceOffset.z * 0.14
                ) * windEffect;
                float windWave2 = sin(
                    time * windFrequency * 0.55
                    + instanceOffset.x * 0.09
                    + instanceOffset.z * 0.16
                ) * windEffect * 0.35;

                pos.x += windWave + windWave2;
                pos.z += windWave * 0.35;

                vHeight = pos.y;
                
                vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
            }
        `,
        fragmentShader: `
            uniform vec3 grassColor;
            uniform vec3 grassColorTip;
            uniform float lightLevel;
            
            varying vec2 vUv;
            varying float vHeight;
            #include <fog_pars_fragment>
            
            void main() {
                // Gradient from base to tip
                vec3 color = mix(grassColor, grassColorTip, vUv.y) * lightLevel;
                
                // Simple alpha cutoff for grass blade shape
                float alpha = 1.0 - smoothstep(0.4, 0.5, abs(vUv.x - 0.5));
                
                if (alpha < 0.1) discard;
                
                gl_FragColor = vec4(color, alpha);
                #include <fog_fragment>
            }
        `,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: true,
        fog: true,
    });
}

/**
 * Creates procedural grass blade geometry (no model needed)
 */
export function createGrassBladeGeometry() {
    const positions = [];
    const uvs = [];
    const indices = [];

    const bladeHeight = 0.28;
    const bladeWidth = 0.028;
    // Two thin strips a few degrees apart. A 60-degree star reads as a pine.
    const yaws = [-0.16, 0.16];

    for (let blade = 0; blade < yaws.length; blade++) {
        const cos = Math.cos(yaws[blade]);
        const sin = Math.sin(yaws[blade]);
        const vertexOffset = blade * 6;
        const points = [
            [-bladeWidth, 0, 0],
            [bladeWidth, 0, 0],
            [-bladeWidth * 0.85, bladeHeight * 0.5, 0],
            [bladeWidth * 0.85, bladeHeight * 0.5, 0],
            [-bladeWidth * 0.45, bladeHeight, 0],
            [bladeWidth * 0.45, bladeHeight, 0],
        ];
        const pointUvs = [
            [0, 0],
            [1, 0],
            [0.1, 0.5],
            [0.9, 0.5],
            [0.25, 1],
            [0.75, 1],
        ];

        for (let i = 0; i < points.length; i++) {
            const x = points[i][0];
            const y = points[i][1];
            const z = points[i][2];
            positions.push(x * cos, y, x * sin);
            uvs.push(pointUvs[i][0], pointUvs[i][1]);
        }

        indices.push(
            vertexOffset, vertexOffset + 1, vertexOffset + 2,
            vertexOffset + 1, vertexOffset + 3, vertexOffset + 2,
            vertexOffset + 2, vertexOffset + 3, vertexOffset + 4,
            vertexOffset + 3, vertexOffset + 5, vertexOffset + 4,
        );
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * Updates grass shader time uniform for wind animation
 * Call this in your animation loop
 */
export function updateGrassWind(grassMesh, deltaTime, lightLevel = 1.0) {
    if (grassMesh && grassMesh.material && grassMesh.material.uniforms) {
        grassMesh.material.uniforms.time.value += deltaTime;
        grassMesh.material.uniforms.lightLevel.value = lightLevel;
    }
}
