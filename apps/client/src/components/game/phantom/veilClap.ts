import * as THREE from 'three';

export function createPhantomVeilSplitMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      progress: { value: 0 },
      intensity: { value: 0 },
      contact: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float time;
      uniform float progress;
      uniform float intensity;
      uniform float contact;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec2 p = vUv - 0.5;
        float absX = abs(p.x);
        float absY = abs(p.y);
        float reveal = smoothstep(absY, absY + 0.08, progress * 0.64 + contact * 0.36);
        float coreWidth = mix(0.005, 0.014, contact);
        float core = (1.0 - smoothstep(coreWidth, coreWidth + 0.018, absX)) * reveal;

        float edgeDistance = abs(absX - progress * 0.48);
        float edge = (1.0 - smoothstep(0.004, 0.035, edgeDistance)) * reveal * (1.0 - progress * 0.34);
        float crossNoise = hash(floor((p + vec2(time * 0.018, -time * 0.025)) * 54.0));
        float brokenHair = step(0.82, crossNoise) * (1.0 - smoothstep(0.015, 0.12, absX)) * reveal;
        float yGlint = 1.0 - smoothstep(0.003, 0.026, abs(sin((p.y + time * 0.12) * 38.0)) * absX);

        float alpha = (core * 0.92 + edge * 0.28 + brokenHair * 0.16 + core * yGlint * 0.18) * intensity;
        if (alpha <= 0.01) discard;

        vec3 silver = vec3(0.82, 0.86, 0.9);
        vec3 white = vec3(1.0);
        vec3 color = mix(silver, white, core + contact * 0.45);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

export function updatePhantomVeilSplitMaterial(
  material: THREE.ShaderMaterial,
  progress: number,
  intensity: number,
  contact: number,
  deltaSeconds: number
): void {
  material.uniforms.time.value += deltaSeconds;
  material.uniforms.progress.value = THREE.MathUtils.clamp(progress, 0, 1);
  material.uniforms.intensity.value = THREE.MathUtils.clamp(intensity, 0, 1);
  material.uniforms.contact.value = THREE.MathUtils.clamp(contact, 0, 1);
}
