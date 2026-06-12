import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { visualStore } from '../../store/visualStore';
import type { EffectQualityConfig } from './visualQuality';

const DEFAULT_LINE_COUNT = 36;
const LINE_LENGTH = 1.25;
const SPAWN_RADIUS_MIN = 0.95;
const SPAWN_RADIUS_MAX = 1.85;
const BASE_LINE_SPEED = 4.1;
const DISTANCE_FROM_CAMERA = 2.15;
const speedLineMatrixDummy = new THREE.Object3D();

interface SpeedLine {
  startRadius: number;
  angle: number;
  offset: number;
  speed: number;
  thickness: number;
  opacity: number;
  length: number;
  radiusTravel: number;
  zDrift: number;
  color: string;
}

export function SlideSpeedLines({ config }: { config: EffectQualityConfig }) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const lineProgressRef = useRef<number[]>([]);
  const lineCount = Math.min(DEFAULT_LINE_COUNT, Math.max(0, config.slideSpeedLineCount));
  
  const lineConfigs = useMemo<SpeedLine[]>(() => {
    return Array.from({ length: lineCount }, (_, i) => {
      const baseAngle = (i / Math.max(1, lineCount)) * Math.PI * 2;
      const angle = baseAngle + (Math.random() - 0.5) * 0.18;
      const sideBias = Math.abs(Math.cos(angle));
      
      return {
        startRadius: SPAWN_RADIUS_MIN + Math.random() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN),
        angle,
        offset: Math.random(),
        speed: BASE_LINE_SPEED * (0.68 + Math.random() * 0.65 + sideBias * 0.24),
        thickness: 0.005 + Math.random() * 0.009,
        opacity: 0.12 + Math.random() * 0.24 + sideBias * 0.12,
        length: LINE_LENGTH * (0.58 + Math.random() * 0.7 + sideBias * 0.18),
        radiusTravel: 1.7 + Math.random() * 0.95,
        zDrift: Math.random() * 0.22,
        color: Math.random() > 0.58 ? '#b9fbff' : '#ffffff',
      };
    });
  }, [lineCount]);

  const lineGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const streakTexture = useMemo(() => {
    if (typeof document === 'undefined') return null;

    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 160;

    const context = canvas.getContext('2d');
    if (!context) return null;

    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    gradient.addColorStop(0.18, 'rgba(255, 255, 255, 0.18)');
    gradient.addColorStop(0.55, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.84, 'rgba(255, 255, 255, 0.32)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }, []);

  useEffect(() => {
    lineProgressRef.current = lineConfigs.map(config => config.offset);
  }, [lineConfigs]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < lineConfigs.length; i++) {
      mesh.setColorAt(i, new THREE.Color(lineConfigs[i].color));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [lineConfigs]);

  useEffect(() => {
    return () => {
      lineGeometry.dispose();
      streakTexture?.dispose();
    };
  }, [lineGeometry, streakTexture]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    const slideIntensity = Math.min(1, Math.max(0, visualStore.getState().slideIntensity));
    
    if (slideIntensity < 0.01) {
      groupRef.current.visible = false;
      return;
    }
    
    groupRef.current.visible = true;
    
    groupRef.current.position.copy(camera.position);
    groupRef.current.quaternion.copy(camera.quaternion);
    const mesh = meshRef.current;
    if (!mesh) return;

    const material = mesh.material as THREE.MeshBasicMaterial;
    material.opacity = Math.min(0.82, Math.pow(slideIntensity, 0.9));
    mesh.visible = material.opacity > 0.006;
    
    lineConfigs.forEach((config, i) => {
      if (!config) return;
      
      const currentProgress = lineProgressRef.current[i] ?? config.offset;
      lineProgressRef.current[i] = (currentProgress + delta * config.speed * (0.38 + slideIntensity * 0.62)) % 1;
      
      const progress = lineProgressRef.current[i];
      
      const currentRadius = config.startRadius + progress * config.radiusTravel;
      const x = Math.cos(config.angle) * currentRadius;
      const y = Math.sin(config.angle) * currentRadius;
      
      speedLineMatrixDummy.position.set(x, y, -DISTANCE_FROM_CAMERA - config.zDrift * progress);
      speedLineMatrixDummy.rotation.set(0, 0, config.angle - Math.PI / 2);
      
      const lengthScale = 0.42 + progress * 0.88;
      const width = config.thickness * (0.72 + progress * 0.46);
      const length = config.length * lengthScale;
      mesh.scale.set(width, length, 1);
      
      const fadeIn = THREE.MathUtils.smoothstep(progress, 0, 0.2);
      const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, 0.68, 1);
      const material = mesh.material as THREE.MeshBasicMaterial;
      const opacity = config.opacity * fadeIn * fadeOut;
      speedLineMatrixDummy.scale.set(opacity > 0.006 ? width : 0.0001, opacity > 0.006 ? length : 0.0001, 1);
      speedLineMatrixDummy.updateMatrix();
      mesh.setMatrixAt(i, speedLineMatrixDummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  });

  if (lineCount <= 0) return null;

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[lineGeometry, undefined, lineCount]}>
        <meshBasicMaterial
          map={streakTexture ?? undefined}
          vertexColors
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>
    </group>
  );
}
