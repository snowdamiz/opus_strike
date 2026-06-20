import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import { BLAZE_COLORS, SHARED_GEOMETRIES } from './effectResources';

const VIEWMODEL_BURN_FADE_OUT_MS = 500;
const VIEWMODEL_BURN_OPACITY_SCALE = 0.5;
const VIEWMODEL_BURN_FLAME_SCALE = 0.72;
const VIEWMODEL_BURN_EMBER_SCALE = 0.58;
const VIEWMODEL_BURN_ANCHORS = [
  { x: -0.34, y: -0.31, z: -0.5, radius: 0.054, phase: 0.08 },
  { x: 0.34, y: -0.31, z: -0.5, radius: 0.054, phase: 0.31 },
  { x: -0.31, y: -0.24, z: -0.69, radius: 0.046, phase: 0.54 },
  { x: 0.31, y: -0.24, z: -0.69, radius: 0.046, phase: 0.77 },
  { x: 0.06, y: -0.22, z: -0.6, radius: 0.05, phase: 0.95 },
] as const;
const VIEWMODEL_BURN_EMBERS = [
  { x: -0.37, y: -0.27, z: -0.62, phase: 0.12 },
  { x: -0.25, y: -0.21, z: -0.76, phase: 0.3 },
  { x: 0.27, y: -0.21, z: -0.76, phase: 0.48 },
  { x: 0.38, y: -0.27, z: -0.62, phase: 0.66 },
  { x: 0.03, y: -0.19, z: -0.62, phase: 0.84 },
  { x: 0.11, y: -0.18, z: -0.53, phase: 0.98 },
] as const;

function createViewmodelBurnMaterial(
  color: number,
  opacity: number
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

export function ViewmodelBurnOverlay() {
  const groupRef = useRef<THREE.Group>(null);
  const flameRefs = useRef<(THREE.Mesh | null)[]>([]);
  const emberRefs = useRef<(THREE.Mesh | null)[]>([]);
  const flameMaterial = useMemo(() => createViewmodelBurnMaterial(BLAZE_COLORS.fireOrange, 0), []);
  const innerFlameMaterial = useMemo(() => createViewmodelBurnMaterial(BLAZE_COLORS.fireYellow, 0), []);
  const emberMaterial = useMemo(() => createViewmodelBurnMaterial(BLAZE_COLORS.fireWhite, 0), []);
  const glowMaterial = useMemo(() => createViewmodelBurnMaterial(BLAZE_COLORS.fireRed, 0), []);

  useEffect(() => () => {
    flameMaterial.dispose();
    innerFlameMaterial.dispose();
    emberMaterial.dispose();
    glowMaterial.dispose();
  }, [emberMaterial, flameMaterial, glowMaterial, innerFlameMaterial]);

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;

    const player = useGameStore.getState().localPlayer;
    const now = Date.now();
    const remainingMs = Math.max(0, (player?.onFireUntil ?? 0) - now);
    const active = Boolean(player && player.state === 'alive' && remainingMs > 0);
    if (!active) {
      group.visible = false;
      flameMaterial.opacity = 0;
      innerFlameMaterial.opacity = 0;
      emberMaterial.opacity = 0;
      glowMaterial.opacity = 0;
      return;
    }

    const fade = THREE.MathUtils.smoothstep(Math.min(remainingMs, VIEWMODEL_BURN_FADE_OUT_MS), 0, VIEWMODEL_BURN_FADE_OUT_MS);
    const t = state.clock.elapsedTime;
    const flicker = 0.82 + Math.sin(t * 17.2) * 0.08 + Math.sin(t * 37.5) * 0.04;
    const intensity = fade * flicker;

    group.visible = intensity > 0.01;
    flameMaterial.opacity = intensity * 0.18 * VIEWMODEL_BURN_OPACITY_SCALE;
    innerFlameMaterial.opacity = intensity * 0.12 * VIEWMODEL_BURN_OPACITY_SCALE;
    emberMaterial.opacity = intensity * 0.34 * VIEWMODEL_BURN_OPACITY_SCALE;
    glowMaterial.opacity = intensity * 0.055 * VIEWMODEL_BURN_OPACITY_SCALE;

    for (let index = 0; index < VIEWMODEL_BURN_ANCHORS.length; index++) {
      const anchor = VIEWMODEL_BURN_ANCHORS[index];
      const mesh = flameRefs.current[index];
      if (!mesh) continue;

      const pulse = Math.sin(t * 8.6 + anchor.phase * Math.PI * 2);
      const sway = Math.sin(t * 5.4 + anchor.phase * Math.PI * 2) * 0.018;
      const scale = anchor.radius * intensity * VIEWMODEL_BURN_FLAME_SCALE * (0.82 + Math.max(0, pulse) * 0.24);
      mesh.visible = intensity > 0.02;
      mesh.position.set(anchor.x + sway, anchor.y + Math.max(0, pulse) * 0.016, anchor.z);
      mesh.rotation.set(-0.26 + pulse * 0.08, anchor.phase * Math.PI * 2 + t * 0.22, pulse * 0.16);
      mesh.scale.set(scale * 0.68, scale * 1.62, scale * 0.68);
    }

    for (let index = 0; index < VIEWMODEL_BURN_EMBERS.length; index++) {
      const ember = VIEWMODEL_BURN_EMBERS[index];
      const mesh = emberRefs.current[index];
      if (!mesh) continue;

      const cycle = (t * 0.9 + ember.phase) % 1;
      const drift = Math.sin(t * 3.2 + ember.phase * 8) * 0.016;
      const scale = (0.012 + cycle * 0.008) * intensity * VIEWMODEL_BURN_EMBER_SCALE;
      mesh.visible = intensity > 0.02;
      mesh.position.set(
        ember.x + drift,
        ember.y + cycle * 0.105,
        ember.z + Math.cos(t * 2.6 + ember.phase * 6) * 0.012
      );
      mesh.scale.setScalar(scale);
    }
  });

  return (
    <group ref={groupRef} visible={false} renderOrder={24}>
      <mesh geometry={SHARED_GEOMETRIES.sphere12} material={glowMaterial} position={[0, -0.27, -0.62]} scale={[0.56, 0.18, 0.34]} frustumCulled={false} />
      {VIEWMODEL_BURN_ANCHORS.map((anchor, index) => (
        <mesh
          key={`viewmodel-burn-flame-${index}`}
          ref={(node) => { flameRefs.current[index] = node; }}
          geometry={SHARED_GEOMETRIES.cone6}
          material={index % 2 === 0 ? flameMaterial : innerFlameMaterial}
          position={[anchor.x, anchor.y, anchor.z]}
          frustumCulled={false}
        />
      ))}
      {VIEWMODEL_BURN_EMBERS.map((ember, index) => (
        <mesh
          key={`viewmodel-burn-ember-${index}`}
          ref={(node) => { emberRefs.current[index] = node; }}
          geometry={SHARED_GEOMETRIES.sphere6}
          material={emberMaterial}
          position={[ember.x, ember.y, ember.z]}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}
