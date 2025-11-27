import { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';

const LINE_COUNT = 60;  // More lines for full coverage
const LINE_LENGTH = 2.5;
const SPAWN_RADIUS_MIN = 1.2;  // Start halfway to edge
const SPAWN_RADIUS_MAX = 2.0;  // Spawn range
const LINE_SPEED = 120;  // Fast streaks
const DISTANCE_FROM_CAMERA = 2.0;  // How far in front of camera

interface SpeedLine {
  startRadius: number;
  angle: number;
  offset: number;
  speed: number;
  thickness: number;
  opacity: number;
}

export function SlideSpeedLines() {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const linesRef = useRef<THREE.Mesh[]>([]);
  const lineProgressRef = useRef<number[]>([]);
  
  const slideIntensity = useGameStore(state => state.slideIntensity);
  
  // Generate line configurations - evenly distributed around full 360 degrees
  const lineConfigs = useMemo<SpeedLine[]>(() => {
    return Array.from({ length: LINE_COUNT }, (_, i) => {
      // Evenly distribute with small random offset
      const baseAngle = (i / LINE_COUNT) * Math.PI * 2;
      const angle = baseAngle + (Math.random() - 0.5) * 0.08;
      
      return {
        startRadius: SPAWN_RADIUS_MIN + Math.random() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN),
        angle,
        offset: Math.random(),  // Random start phase so lines don't all appear at once
        speed: LINE_SPEED * (0.7 + Math.random() * 0.6),
        thickness: 0.0005 + Math.random() * 0.0005,  // Ultra thin lines
        opacity: 0.2 + Math.random() * 0.7,  // Fainter
      };
    });
  }, []);

  // Create line geometries
  const lineMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, []);

  // Initialize line progress
  useMemo(() => {
    lineProgressRef.current = lineConfigs.map(config => config.offset);
  }, [lineConfigs]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    
    // Hide when not sliding
    if (slideIntensity < 0.01) {
      groupRef.current.visible = false;
      return;
    }
    
    groupRef.current.visible = true;
    
    // Position the group directly at camera position - lines will be in camera's local space
    groupRef.current.position.copy(camera.position);
    groupRef.current.quaternion.copy(camera.quaternion);
    
    // Update each line
    linesRef.current.forEach((mesh, i) => {
      if (!mesh) return;
      
      const config = lineConfigs[i];
      
      // Update progress (loop from 0 to 1)
      lineProgressRef.current[i] += delta * config.speed * 0.1 * slideIntensity;
      if (lineProgressRef.current[i] > 1) {
        lineProgressRef.current[i] -= 1;
      }
      
      const progress = lineProgressRef.current[i];
      
      // Calculate position - lines move outward from center toward edges
      const currentRadius = config.startRadius + progress * 2.5;
      const x = Math.cos(config.angle) * currentRadius;
      const y = Math.sin(config.angle) * currentRadius;
      
      // Position in camera local space (x=right, y=up, -z=forward)
      mesh.position.set(x, y, -DISTANCE_FROM_CAMERA);
      
      // Rotate line to point outward from center (radial direction)
      mesh.rotation.set(0, 0, config.angle + Math.PI / 2);
      
      // Scale: very thin width, variable length based on progress
      const lengthScale = 0.4 + progress * 0.6;
      const width = config.thickness * 5;  // Very thin lines
      const length = lengthScale * LINE_LENGTH * 0.25;
      mesh.scale.set(width, length, 1);
      
      // Fade based on progress and slide intensity
      const fadeIn = Math.min(1, progress * 5);
      const fadeOut = 1 - Math.pow(progress, 2);
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = config.opacity * fadeIn * fadeOut * slideIntensity;
    });
  });

  return (
    <group ref={groupRef}>
      {lineConfigs.map((config, i) => (
        <mesh
          key={i}
          ref={(el) => { if (el) linesRef.current[i] = el; }}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            color={0xffffff}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

