import * as THREE from 'three';

// ============================================================================
// PHANTOM SHADER MATERIALS
// ============================================================================

// Shared shader materials for blink effect
let sharedRiftMaterial: THREE.ShaderMaterial | null = null;
let sharedTrailMaterial: THREE.ShaderMaterial | null = null;
let sharedShadowArrivalMaterial: THREE.ShaderMaterial | null = null;

export function getRiftMaterial(): THREE.ShaderMaterial {
  if (!sharedRiftMaterial) {
    sharedRiftMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        progress: { value: 0 },
        color1: { value: new THREE.Color(0x0a0015) }, // Deep void
        color2: { value: new THREE.Color(0x7c3aed) }, // Violet
        color3: { value: new THREE.Color(0xc084fc) }, // Light purple
        color4: { value: new THREE.Color(0x00ffff) }, // Cyan accent
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPosition;
        varying vec3 vNormal;
        uniform float time;
        uniform float progress;
        
        void main() {
          vUv = uv;
          vPosition = position;
          vNormal = normalize(normalMatrix * normal);
          
          // Warp effect - vertices spiral inward
          vec3 pos = position;
          float warp = sin(position.y * 8.0 + time * 15.0) * 0.1 * (1.0 - progress);
          pos.x += warp * cos(position.y * 3.0);
          pos.z += warp * sin(position.y * 3.0);
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float progress;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec3 color4;
        varying vec2 vUv;
        varying vec3 vPosition;
        varying vec3 vNormal;
        
        // Noise function for chaotic energy
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }
        
        void main() {
          vec2 center = vec2(0.5);
          vec2 uv = vUv - center;
          float dist = length(uv);
          float angle = atan(uv.y, uv.x);
          
          // Spiraling void energy
          float spiral1 = sin(angle * 5.0 + time * 12.0 - dist * 20.0) * 0.5 + 0.5;
          float spiral2 = sin(angle * 7.0 - time * 8.0 + dist * 15.0) * 0.5 + 0.5;
          float spiral3 = sin(angle * 3.0 + time * 20.0 - dist * 30.0) * 0.5 + 0.5;
          
          // Fractal noise for energy crackling
          float n = noise(vUv * 10.0 + time * 3.0);
          n += noise(vUv * 20.0 - time * 5.0) * 0.5;
          n += noise(vUv * 40.0 + time * 8.0) * 0.25;
          
          // Create void center with glowing edges
          float voidCore = smoothstep(0.2, 0.0, dist);
          float voidRing = smoothstep(0.4, 0.25, dist) * smoothstep(0.1, 0.25, dist);
          float outerGlow = smoothstep(0.5, 0.3, dist);
          
          // Color mixing with energy
          vec3 color = color1;
          color = mix(color, color2, spiral1 * outerGlow);
          color = mix(color, color3, spiral2 * voidRing * n);
          color = mix(color, color4, spiral3 * 0.3 * (1.0 - dist) * n);
          
          // Bright edge with electrical crackling
          float edge = smoothstep(0.48, 0.45, dist) * smoothstep(0.35, 0.45, dist);
          float crackle = step(0.7, noise(vUv * 50.0 + time * 10.0));
          color += color3 * edge * 2.0;
          color += color4 * crackle * edge * 3.0;
          
          // Pulsing core
          float pulse = sin(time * 20.0) * 0.2 + 0.8;
          color += color3 * voidCore * pulse * 2.0;
          
          // Alpha with fade based on progress
          float alpha = outerGlow * (1.0 - progress * progress);
          alpha *= pulse;
          alpha += voidRing * 0.5;
          
          // Final bloom
          color *= 1.2;
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  return sharedRiftMaterial;
}

export function getTrailMaterial(): THREE.ShaderMaterial {
  if (!sharedTrailMaterial) {
    sharedTrailMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        progress: { value: 0 },
      },
      vertexShader: `
        varying vec3 vPosition;
        varying float vProgress;
        attribute float lineProgress;
        uniform float progress;
        
        void main() {
          vPosition = position;
          vProgress = lineProgress;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float progress;
        varying vec3 vPosition;
        varying float vProgress;
        
        void main() {
          // Trail fades from start to end
          float fade = smoothstep(0.0, 0.3, vProgress) * smoothstep(1.0, 0.7, vProgress);
          
          // Energy pulse along trail
          float pulse = sin(vProgress * 20.0 - time * 30.0) * 0.5 + 0.5;
          
          // Purple/cyan gradient
          vec3 color = mix(
            vec3(0.486, 0.227, 0.929), // Purple
            vec3(0.0, 1.0, 1.0),        // Cyan
            pulse
          );
          
          float alpha = fade * (1.0 - progress) * pulse;
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  return sharedTrailMaterial;
}

export function getShadowArrivalMaterial(): THREE.ShaderMaterial {
  if (!sharedShadowArrivalMaterial) {
    sharedShadowArrivalMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        progress: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPosition;
        uniform float time;
        
        void main() {
          vUv = uv;
          vPosition = position;
          
          // Shadow tendrils wave effect
          vec3 pos = position;
          float wave = sin(position.y * 5.0 + time * 10.0) * 0.1;
          pos.x += wave * (1.0 - uv.y);
          pos.z += wave * 0.5 * (1.0 - uv.y);
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float progress;
        varying vec2 vUv;
        varying vec3 vPosition;
        
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        
        void main() {
          // Rising shadow effect
          float rise = smoothstep(0.0, progress, vUv.y);
          
          // Shadow tendrils
          float tendril = sin(vUv.x * 20.0 + time * 5.0) * 0.5 + 0.5;
          tendril *= sin(vUv.x * 15.0 - time * 8.0) * 0.5 + 0.5;
          
          // Dark core with purple edge
          vec3 shadowColor = vec3(0.05, 0.0, 0.1);
          vec3 edgeColor = vec3(0.486, 0.227, 0.929);
          vec3 glowColor = vec3(0.752, 0.518, 0.988);
          
          // Noise for organic feeling
          float n = hash(vUv * 50.0 + time);
          
          // Color mixing
          vec3 color = shadowColor;
          float edgeFade = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
          color = mix(color, edgeColor, tendril * edgeFade * 0.7);
          color += glowColor * rise * (1.0 - vUv.y) * 0.3;
          
          // Particles/sparks
          float spark = step(0.97, hash(vUv * 100.0 + time * 10.0));
          color += glowColor * spark * 2.0;
          
          // Alpha - fade at edges
          float alpha = rise * (1.0 - abs(vUv.x - 0.5) * 2.0);
          alpha *= smoothstep(1.0, 0.8, progress); // Fade out at end
          alpha *= 0.8 + tendril * 0.2;
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
  }
  return sharedShadowArrivalMaterial;
}

// ============================================================================
// EFFECT DURATIONS
// ============================================================================

export const BLINK_EFFECT_DURATION = 600; // ms
export const SHADOW_ARRIVAL_DURATION = 800; // ms

