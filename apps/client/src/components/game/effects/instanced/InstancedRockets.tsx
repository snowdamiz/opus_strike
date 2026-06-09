/**
 * INSTANCED ROCKETS RENDERER
 * =========================
 * Renders Blaze primary fireballs using InstancedMesh for single-draw-call performance.
 * Each projectile = 6 instances (3 flame spheres, 3 trail lobes)
 *
 * PERFORMANCE BENEFITS:
 * - 30 projectiles render in ~6 draw calls (one per fireball layer) instead of 180+
 * - Position/rotation updates at 60fps without React re-renders
 * - Uses Instance scale prop (1 = visible, 0 = hidden) for lifecycle
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Instance, Instances } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore } from '../../../../store/gameStore';
import { getFrameClock } from '../../../../utils/frameClock';
import { SHARED_GEOMETRIES } from '../../effectResources';
import {
  getFireballCoreMaterial,
  getFireballInnerMaterial,
  getFireballOuterMaterial,
  getFireballTrailCoreMaterial,
  getFireballTrailInnerMaterial,
  getFireballTrailOuterMaterial,
} from '../../blaze/materials';

const MAX_ROCKETS = 50;
const ROCKET_LIFETIME = 5000;

// Pre-allocated vectors for position calculations (zero-allocation pattern)
const _rocketPos = new THREE.Vector3();
const _rocketDir = new THREE.Vector3();
const _rocketForward = new THREE.Vector3(0, 0, -1);
const _rocketQuat = new THREE.Quaternion();
const _partQuat = new THREE.Quaternion();
const _partEuler = new THREE.Euler();
const _partOffset = new THREE.Vector3();

// Instance data cache for updating refs
interface InstanceData {
  trailOuter: THREE.Object3D | null;
  trailInner: THREE.Object3D | null;
  trailCore: THREE.Object3D | null;
  outer: THREE.Object3D | null;
  inner: THREE.Object3D | null;
  core: THREE.Object3D | null;
}

/**
 * InstancedRockets - Renders Blaze fireballs in single draw calls using InstancedMesh
 *
 * Uses Drei's Instances API for declarative instancing. Each projectile is composed
 * of 6 separate instances (3 fireball layers and 3 flame-trail lobes), so 30 active projectiles
 * render in 6 total draw calls instead of 180+ individual mesh calls.
 *
 * The component renders MAX_ROCKETS instances for each part (total 6 * 50 = 300 instances).
 * Instance visibility is controlled via scale updates in useFrame (scale=1 = visible, scale=0 = hidden).
 * Position/rotation data comes from gameStore.rockets (non-reactive access).
 */
export function InstancedRockets() {
  // Pre-cached materials (created once, reused)
  const materials = useMemo(() => ({
    trailOuter: getFireballTrailOuterMaterial(),
    trailInner: getFireballTrailInnerMaterial(),
    trailCore: getFireballTrailCoreMaterial(),
    outer: getFireballOuterMaterial(),
    inner: getFireballInnerMaterial(),
    core: getFireballCoreMaterial(),
  }), []);

  // Store instance refs for per-frame updates
  const instanceRefs = useRef<InstanceData[]>([]);

  useFrame(() => {
    const rockets = useGameStore.getState().rockets;
    const now = getFrameClock().nowMs;

    // Initialize instance refs array if needed
    while (instanceRefs.current.length < MAX_ROCKETS) {
      instanceRefs.current.push({
        trailOuter: null,
        trailInner: null,
        trailCore: null,
        outer: null,
        inner: null,
        core: null,
      });
    }

    // Update each rocket's instances
    rockets.forEach((rocket, index) => {
      if (index >= MAX_ROCKETS) return;

      const elapsed = (now - rocket.startTime) / 1000;
      const alive = elapsed < ROCKET_LIFETIME / 1000;

      const instances = instanceRefs.current[index];
      if (!instances) return;

      // Calculate position using the same straight-line path as the legacy rocket effect.
      _rocketPos.set(
        rocket.position.x + rocket.velocity.x * elapsed,
        rocket.position.y + rocket.velocity.y * elapsed,
        rocket.position.z + rocket.velocity.z * elapsed
      );

      // Calculate rotation to face velocity direction
      _rocketDir.set(
        rocket.velocity.x,
        rocket.velocity.y,
        rocket.velocity.z
      ).normalize();
      _rocketQuat.setFromUnitVectors(_rocketForward, _rocketDir);

      // Update all instances for this fireball
      updateInstance(instances.trailOuter, _rocketPos, _rocketQuat, [0.22, 0.88, 0.22], alive, [Math.PI / 2, 0, 0], [0, 0, 0.72]);
      updateInstance(instances.trailInner, _rocketPos, _rocketQuat, [0.14, 0.66, 0.14], alive, [Math.PI / 2, 0, 0], [0, 0, 0.48]);
      updateInstance(instances.trailCore, _rocketPos, _rocketQuat, [0.08, 0.48, 0.08], alive, [Math.PI / 2, 0, 0], [0, 0, 0.25]);
      updateInstance(instances.outer, _rocketPos, _rocketQuat, [0.32, 0.32, 0.32], alive, [0, 0, 0]);
      updateInstance(instances.inner, _rocketPos, _rocketQuat, [0.23, 0.23, 0.23], alive, [0, 0, 0], [0, 0, -0.02]);
      updateInstance(instances.core, _rocketPos, _rocketQuat, [0.14, 0.14, 0.14], alive, [0, 0, 0], [0, 0, -0.04]);
    });

    // Hide unused instances (beyond current rocket count)
    for (let i = rockets.length; i < MAX_ROCKETS; i++) {
      const instances = instanceRefs.current[i];
      if (!instances) continue;

      // Hide all parts for unused slots
      if (instances.trailOuter) instances.trailOuter.scale.setScalar(0);
      if (instances.trailInner) instances.trailInner.scale.setScalar(0);
      if (instances.trailCore) instances.trailCore.scale.setScalar(0);
      if (instances.outer) instances.outer.scale.setScalar(0);
      if (instances.inner) instances.inner.scale.setScalar(0);
      if (instances.core) instances.core.scale.setScalar(0);
    }
  });

  // Render MAX_ROCKETS instances for each part
  // Instances are hidden/shown via scale updates in useFrame
  const instanceSlots = Array.from({ length: MAX_ROCKETS }, (_, i) => i);

  return (
    <group>
      {/* Outer flame trail */}
      <Instances limit={MAX_ROCKETS}>
        <primitive object={SHARED_GEOMETRIES.cone8} />
        <primitive object={materials.trailOuter} />
        {instanceSlots.map((index) => (
          <Instance
            key={`trailOuter-${index}`}
            ref={(el) => {
              if (!instanceRefs.current[index]) {
                instanceRefs.current[index] = {
                  trailOuter: null,
                  trailInner: null,
                  trailCore: null,
                  outer: null,
                  inner: null,
                  core: null,
                };
              }
              instanceRefs.current[index].trailOuter = el as THREE.Object3D | null;
            }}
          />
        ))}
      </Instances>

      {/* Mid flame trail */}
      <Instances limit={MAX_ROCKETS}>
        <primitive object={SHARED_GEOMETRIES.cone8} />
        <primitive object={materials.trailInner} />
        {instanceSlots.map((index) => (
          <Instance
            key={`trailInner-${index}`}
            ref={(el) => {
              if (instanceRefs.current[index]) {
                instanceRefs.current[index].trailInner = el as THREE.Object3D | null;
              }
            }}
          />
        ))}
      </Instances>

      {/* Inner flame trail */}
      <Instances limit={MAX_ROCKETS}>
        <primitive object={SHARED_GEOMETRIES.cone8} />
        <primitive object={materials.trailCore} />
        {instanceSlots.map((index) => (
          <Instance
            key={`trailCore-${index}`}
            ref={(el) => {
              if (instanceRefs.current[index]) {
                instanceRefs.current[index].trailCore = el as THREE.Object3D | null;
              }
            }}
          />
        ))}
      </Instances>

      {/* Outer fireball glow */}
      <Instances limit={MAX_ROCKETS}>
        <primitive object={SHARED_GEOMETRIES.sphere12} />
        <primitive object={materials.outer} />
        {instanceSlots.map((index) => (
          <Instance
            key={`outer-${index}`}
            ref={(el) => {
              if (instanceRefs.current[index]) {
                instanceRefs.current[index].outer = el as THREE.Object3D | null;
              }
            }}
          />
        ))}
      </Instances>

      {/* Inner fireball */}
      <Instances limit={MAX_ROCKETS}>
        <primitive object={SHARED_GEOMETRIES.sphere8} />
        <primitive object={materials.inner} />
        {instanceSlots.map((index) => (
          <Instance
            key={`inner-${index}`}
            ref={(el) => {
              if (instanceRefs.current[index]) {
                instanceRefs.current[index].inner = el as THREE.Object3D | null;
              }
            }}
          />
        ))}
      </Instances>

      {/* Bright core */}
      <Instances limit={MAX_ROCKETS}>
        <primitive object={SHARED_GEOMETRIES.sphere6} />
        <primitive object={materials.core} />
        {instanceSlots.map((index) => (
          <Instance
            key={`core-${index}`}
            ref={(el) => {
              if (instanceRefs.current[index]) {
                instanceRefs.current[index].core = el as THREE.Object3D | null;
              }
            }}
          />
        ))}
      </Instances>
    </group>
  );
}

/**
 * Update instance position, rotation, and scale
 * Hides dead projectiles by setting scale to 0
 */
function updateInstance(
  instance: THREE.Object3D | null,
  position: THREE.Vector3,
  rocketQuaternion: THREE.Quaternion,
  scale: [number, number, number],
  alive: boolean,
  rotation: [number, number, number],
  offset?: [number, number, number]
) {
  if (!instance) return;

  if (!alive) {
    instance.scale.setScalar(0);
    return;
  }

  instance.position.copy(position);
  if (offset) {
    _partOffset.set(offset[0], offset[1], offset[2]).applyQuaternion(rocketQuaternion);
    instance.position.add(_partOffset);
  }

  instance.scale.set(scale[0], scale[1], scale[2]);

  _partEuler.set(rotation[0], rotation[1], rotation[2]);
  _partQuat.setFromEuler(_partEuler);
  instance.quaternion.copy(rocketQuaternion).multiply(_partQuat);

  // Update matrix
  instance.updateMatrix();
}
