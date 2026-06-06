import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../../store/gameStore';
import { checkGroundWithNormal, isPhysicsReady, validateTeleportDestination } from '../../../hooks/usePhysics';

const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.48;

// Maximum teleport range
const MAX_RANGE = 25;
const MIN_RANGE = 2;

// Shared shader materials for better performance
let sharedVortexMaterial: THREE.ShaderMaterial | null = null;
let sharedPillarMaterial: THREE.ShaderMaterial | null = null;
let sharedGhostMaterial: THREE.ShaderMaterial | null = null;

function getVortexMaterial(): THREE.ShaderMaterial {
  if (!sharedVortexMaterial) {
    sharedVortexMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        isValid: { value: 1.0 },
        color1: { value: new THREE.Color(0x0a0015) },
        color2: { value: new THREE.Color(0x7c3aed) },
        color3: { value: new THREE.Color(0xc084fc) },
        invalidColor: { value: new THREE.Color(0xef4444) },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPosition;
        uniform float time;
        
        void main() {
          vUv = uv;
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float isValid;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec3 invalidColor;
        varying vec2 vUv;
        varying vec3 vPosition;
        
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        
        void main() {
          vec2 center = vec2(0.5);
          vec2 uv = vUv - center;
          float dist = length(uv);
          float angle = atan(uv.y, uv.x);
          
          // Spiraling void pattern
          float spiral1 = sin(angle * 6.0 + time * 8.0 - dist * 15.0) * 0.5 + 0.5;
          float spiral2 = sin(angle * 4.0 - time * 6.0 + dist * 12.0) * 0.5 + 0.5;
          float spiral3 = sin(angle * 8.0 + time * 12.0 - dist * 20.0) * 0.5 + 0.5;
          
          // Dark center pulling effect
          float voidPull = smoothstep(0.4, 0.0, dist);
          float outerRing = smoothstep(0.5, 0.35, dist) * smoothstep(0.2, 0.35, dist);
          float edge = smoothstep(0.48, 0.45, dist) * smoothstep(0.38, 0.45, dist);
          
          // Get valid color (purple) or invalid (red)
          vec3 validColor2 = color2;
          vec3 validColor3 = color3;
          vec3 activeColor2 = mix(invalidColor, validColor2, isValid);
          vec3 activeColor3 = mix(invalidColor * 1.3, validColor3, isValid);
          
          // Build color
          vec3 color = color1;
          color = mix(color, activeColor2, spiral1 * outerRing * 0.8);
          color = mix(color, activeColor3, spiral2 * spiral3 * (1.0 - dist) * 0.6);
          
          // Bright edge
          color += activeColor3 * edge * 2.0;
          
          // Electric arcs at edge
          float arc = step(0.8, hash(vec2(angle * 10.0, time * 20.0)));
          color += activeColor3 * arc * edge * 3.0;
          
          // Pulsing glow
          float pulse = sin(time * 5.0) * 0.2 + 0.8;
          color *= pulse;
          
          // Alpha
          float alpha = smoothstep(0.5, 0.2, dist) * 0.9;
          alpha += edge * 0.5;
          alpha *= pulse;
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  return sharedVortexMaterial;
}

function getPillarMaterial(): THREE.ShaderMaterial {
  if (!sharedPillarMaterial) {
    sharedPillarMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        isValid: { value: 1.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPosition;
        uniform float time;
        
        void main() {
          vUv = uv;
          vPosition = position;
          
          // Wave distortion
          vec3 pos = position;
          float wave = sin(position.y * 5.0 + time * 8.0) * 0.05;
          pos.x += wave;
          pos.z += wave * 0.5;
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float isValid;
        varying vec2 vUv;
        varying vec3 vPosition;
        
        void main() {
          // Rising energy strands
          float strand1 = sin(vUv.x * 30.0 + time * 10.0 - vUv.y * 20.0) * 0.5 + 0.5;
          float strand2 = sin(vUv.x * 25.0 - time * 8.0 + vUv.y * 15.0) * 0.5 + 0.5;
          
          // Fade at top and bottom
          float fade = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
          
          // Color
          vec3 validColor = vec3(0.486, 0.227, 0.929);
          vec3 invalidColor = vec3(0.937, 0.267, 0.267);
          vec3 color = mix(invalidColor, validColor, isValid);
          
          // Energy pattern
          float energy = strand1 * strand2;
          color *= 0.5 + energy * 0.5;
          
          // Pulse
          float pulse = sin(time * 6.0) * 0.15 + 0.85;
          
          float alpha = fade * 0.4 * pulse;
          alpha += energy * fade * 0.3;
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  return sharedPillarMaterial;
}

function getGhostMaterial(): THREE.ShaderMaterial {
  if (!sharedGhostMaterial) {
    sharedGhostMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        isValid: { value: 1.0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec2 vUv;
        uniform float time;
        
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;
          vUv = uv;
          
          // Ghostly floating motion
          vec3 pos = position;
          pos.y += sin(time * 3.0) * 0.05;
          pos.x += sin(time * 2.0 + position.y) * 0.02;
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float isValid;
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec2 vUv;
        
        void main() {
          // Fresnel for ghost edge glow
          vec3 viewDir = normalize(cameraPosition - vPosition);
          float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 3.0);
          
          // Ghost color
          vec3 validColor = vec3(0.486, 0.227, 0.929);
          vec3 invalidColor = vec3(0.937, 0.267, 0.267);
          vec3 glowColor = vec3(0.752, 0.518, 0.988);
          
          vec3 baseColor = mix(invalidColor, validColor, isValid);
          vec3 glow = mix(invalidColor * 1.3, glowColor, isValid);
          
          // Dissolve pattern
          float noise = sin(vPosition.x * 20.0 + time * 5.0) * 
                       cos(vPosition.y * 15.0 - time * 4.0) * 
                       sin(vPosition.z * 18.0 + time * 3.0);
          noise = noise * 0.5 + 0.5;
          
          vec3 color = baseColor * 0.3;
          color += glow * fresnel * 2.0;
          
          // Flickering effect
          float flicker = sin(time * 20.0) * 0.1 + 0.9;
          
          float alpha = 0.2 + fresnel * 0.6;
          alpha *= flicker;
          alpha *= smoothstep(0.2, 0.4, noise);
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  return sharedGhostMaterial;
}

// Pre-compile shaders
if (typeof window !== 'undefined') {
  requestAnimationFrame(() => {
    getVortexMaterial();
    getPillarMaterial();
    getGhostMaterial();
  });
}

interface ShadowStepIndicatorProps {
  isActive: boolean;
  onTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

export function ShadowStepIndicator({ isActive, onTargetUpdate }: ShadowStepIndicatorProps) {
  const { camera } = useThree();
  const { localPlayer } = useGameStore();
  
  const indicatorRef = useRef<THREE.Group>(null);
  const vortexRef = useRef<THREE.Mesh>(null);
  const pillarRef = useRef<THREE.Mesh>(null);
  const ghostRef = useRef<THREE.Mesh>(null);
  const innerRingsRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const targetPositionRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const isValidRef = useRef(false);

  // Get shared materials
  const vortexMaterial = useMemo(() => getVortexMaterial().clone(), []);
  const pillarMaterial = useMemo(() => getPillarMaterial().clone(), []);
  const ghostMaterial = useMemo(() => getGhostMaterial().clone(), []);

  // Particle system for floating wisps
  const particleGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const count = 40;
    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.5 + Math.random() * 1.0;
      const height = Math.random() * 2.5;
      
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = height;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      randoms[i] = Math.random();
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('random', new THREE.BufferAttribute(randoms, 1));
    
    return geometry;
  }, []);

  const particleMaterial = useMemo(() => new THREE.PointsMaterial({
    color: 0xa855f7,
    size: 0.08,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }), []);

  useFrame((state) => {
    if (!isActive || !localPlayer || !indicatorRef.current) {
      if (indicatorRef.current) {
        indicatorRef.current.visible = false;
      }
      return;
    }

    indicatorRef.current.visible = true;

    // Get camera position and look direction
    const cameraPos = camera.position.clone();
    const lookDir = new THREE.Vector3(0, 0, -1);
    lookDir.applyQuaternion(camera.quaternion);

    // Player feet position (for range calculation)
    const playerFeetY = localPlayer.position.y - 0.9;

    // Use raycasting approach - find where the look ray hits a ground plane
    let targetX = cameraPos.x;
    let targetZ = cameraPos.z;
    let targetY = playerFeetY;
    let isValid = false;
    let foundGround = false;

    if (isPhysicsReady()) {
      const horizontalDir = new THREE.Vector3(lookDir.x, 0, lookDir.z);
      const horizontalLength = horizontalDir.length();
      
      if (horizontalLength > 0.01) {
        horizontalDir.normalize();
        
        const pitch = Math.asin(Math.max(-1, Math.min(1, -lookDir.y)));
        
        if (pitch > 0.1) {
          const groundY = playerFeetY;
          if (lookDir.y < -0.01) {
            const t = (groundY - cameraPos.y) / lookDir.y;
            if (t > 0 && t < 100) {
              targetX = cameraPos.x + lookDir.x * t;
              targetZ = cameraPos.z + lookDir.z * t;
              
              const groundCheck = checkGroundWithNormal(targetX, groundY + 10, targetZ, 20);
              if (groundCheck && groundCheck.isWalkable) {
                targetY = groundCheck.groundY + 0.05;
                foundGround = true;
              }
            }
          }
        }
        
        if (!foundGround) {
          const distanceFactor = Math.max(0.2, Math.cos(pitch));
          const projectionDist = MIN_RANGE + (MAX_RANGE - MIN_RANGE) * distanceFactor;
          
          targetX = localPlayer.position.x + horizontalDir.x * projectionDist;
          targetZ = localPlayer.position.z + horizontalDir.z * projectionDist;
          
          const groundCheck = checkGroundWithNormal(targetX, localPlayer.position.y + 20, targetZ, 50);
          if (groundCheck && groundCheck.isWalkable) {
            targetY = groundCheck.groundY + 0.05;
            foundGround = true;
          }
        }
        
        if (foundGround) {
          const dx = targetX - localPlayer.position.x;
          const dz = targetZ - localPlayer.position.z;
          const horizontalDist = Math.sqrt(dx * dx + dz * dz);
          const heightDiff = Math.abs(targetY - playerFeetY);
          
          if (horizontalDist > MAX_RANGE) {
            const scale = MAX_RANGE / horizontalDist;
            targetX = localPlayer.position.x + dx * scale;
            targetZ = localPlayer.position.z + dz * scale;
            
            const groundCheck = checkGroundWithNormal(targetX, localPlayer.position.y + 20, targetZ, 50);
            if (groundCheck && groundCheck.isWalkable) {
              targetY = groundCheck.groundY + 0.05;
            } else {
              foundGround = false;
            }
          }
          
          if (foundGround && horizontalDist >= MIN_RANGE && heightDiff < 30) {
            const teleportY = targetY + PLAYER_HEIGHT / 2 + 0.1;
            const validation = validateTeleportDestination(targetX, teleportY, targetZ, PLAYER_HEIGHT, PLAYER_RADIUS);
            
            if (validation.valid) {
              isValid = true;
              if (validation.adjustedPosition) {
                targetY = validation.adjustedPosition.y - PLAYER_HEIGHT / 2;
              }
            } else {
              const groundRecheck = checkGroundWithNormal(targetX, teleportY + 5, targetZ, 10);
              if (groundRecheck && groundRecheck.isWalkable) {
                isValid = true;
                targetY = groundRecheck.groundY + 0.05;
              }
            }
          }
        }
      }
    }

    // Update indicator position
    targetPositionRef.current.set(targetX, targetY, targetZ);
    isValidRef.current = isValid;
    
    indicatorRef.current.position.set(targetX, targetY, targetZ);

    const time = state.clock.elapsedTime;

    // Update shader uniforms
    if (vortexMaterial.uniforms) {
      vortexMaterial.uniforms.time.value = time;
      vortexMaterial.uniforms.isValid.value = isValid ? 1.0 : 0.0;
    }
    if (pillarMaterial.uniforms) {
      pillarMaterial.uniforms.time.value = time;
      pillarMaterial.uniforms.isValid.value = isValid ? 1.0 : 0.0;
    }
    if (ghostMaterial.uniforms) {
      ghostMaterial.uniforms.time.value = time;
      ghostMaterial.uniforms.isValid.value = isValid ? 1.0 : 0.0;
    }

    // Animate vortex
    if (vortexRef.current) {
      vortexRef.current.scale.setScalar(1 + Math.sin(time * 3) * 0.1);
    }

    // Animate inner rings - counter-rotating
    if (innerRingsRef.current) {
      innerRingsRef.current.children.forEach((ring, i) => {
        ring.rotation.z = time * (i % 2 === 0 ? 2 : -3);
        const scale = 1 + Math.sin(time * 4 + i) * 0.15;
        ring.scale.setScalar(scale);
      });
    }

    // Animate pillar
    if (pillarRef.current) {
      pillarRef.current.scale.y = 1 + Math.sin(time * 5) * 0.15;
    }

    // Animate ghost - subtle float
    if (ghostRef.current) {
      ghostRef.current.position.y = 1.0 + Math.sin(time * 2) * 0.1;
      ghostRef.current.rotation.y = time * 0.5;
    }

    // Animate particles - spiral upward
    if (particlesRef.current) {
      const positions = particlesRef.current.geometry.attributes.position;
      const randoms = particlesRef.current.geometry.attributes.random;
      
      for (let i = 0; i < positions.count; i++) {
        const r = (randoms as THREE.BufferAttribute).getX(i);
        const angle = r * Math.PI * 2 + time * (1 + r);
        const radius = 0.5 + r * 0.8 + Math.sin(time * 2 + r * 10) * 0.1;
        let height = (positions.getY(i) + 0.02) % 2.5;
        
        positions.setX(i, Math.cos(angle) * radius);
        positions.setY(i, height);
        positions.setZ(i, Math.sin(angle) * radius);
      }
      positions.needsUpdate = true;
      
      // Update particle color based on validity
      particleMaterial.color.setHex(isValid ? 0xa855f7 : 0xef4444);
    }

    // Report target to parent
    onTargetUpdate(targetPositionRef.current.clone(), isValid);
  });

  if (!isActive) return null;

  return (
    <group ref={indicatorRef}>
      {/* Ground vortex portal */}
      <mesh ref={vortexRef} rotation-x={-Math.PI / 2} position-y={0.05}>
        <circleGeometry args={[1.5, 64]} />
        <primitive object={vortexMaterial} />
      </mesh>

      {/* Inner rotating rings */}
      <group ref={innerRingsRef}>
        <mesh rotation-x={-Math.PI / 2} position-y={0.08}>
          <ringGeometry args={[0.4, 0.6, 32]} />
          <meshBasicMaterial 
            color={0x7c3aed}
            transparent
            opacity={0.7}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.1}>
          <ringGeometry args={[0.7, 0.85, 32]} />
          <meshBasicMaterial 
            color={0xc084fc}
            transparent
            opacity={0.5}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.12}>
          <ringGeometry args={[1.1, 1.25, 32]} />
          <meshBasicMaterial 
            color={0x9333ea}
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>

      {/* Vertical energy pillar */}
      <mesh ref={pillarRef} position-y={1.2}>
        <cylinderGeometry args={[0.3, 0.6, 2.4, 16, 4, true]} />
        <primitive object={pillarMaterial} />
      </mesh>

      {/* Ghost silhouette preview */}
      <mesh ref={ghostRef} position-y={1.0}>
        <capsuleGeometry args={[0.35, 1, 8, 16]} />
        <primitive object={ghostMaterial} />
      </mesh>

      {/* Rising particles */}
      <points ref={particlesRef} geometry={particleGeometry}>
        <primitive object={particleMaterial} />
      </points>

      {/* Top marker - floating diamond */}
      <mesh position-y={2.5} rotation-y={Math.PI / 4}>
        <octahedronGeometry args={[0.2]} />
        <meshBasicMaterial 
          color={0xc084fc}
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Dark center void */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <circleGeometry args={[0.3, 32]} />
        <meshBasicMaterial 
          color={0x0a0015}
          transparent
          opacity={0.9}
        />
      </mesh>
    </group>
  );
}
