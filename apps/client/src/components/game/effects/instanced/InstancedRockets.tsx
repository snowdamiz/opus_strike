/**
 * INSTANCED ROCKETS RENDERER
 * =========================
 * Renders all active rockets using InstancedMesh for single-draw-call performance.
 * Each rocket = 6 instances (body, nose, fireCore, fireInner, fireOuter, smoke)
 *
 * PERFORMANCE BENEFITS:
 * - 30 rockets render in ~6 draw calls (one per rocket part) instead of 180+
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
  getRocketBodyMaterial,
  getRocketNoseMaterial,
  getRocketFireCoreMaterial,
  getRocketFireInnerMaterial,
  getRocketFireOuterMaterial,
  getRocketSmokeMaterial,
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
  body: THREE.Object3D | null;
  nose: THREE.Object3D | null;
  fireCore: THREE.Object3D | null;
  fireInner: THREE.Object3D | null;
  fireOuter: THREE.Object3D | null;
  smoke: THREE.Object3D | null;
}

/**
 * InstancedRockets - Renders all rockets in single draw calls using InstancedMesh
 *
 * Uses Drei's Instances API for declarative instancing. Each rocket is composed
 * of 6 separate instances (body, nose, 3 fire parts, smoke), so 30 active rockets
 * render in 6 total draw calls instead of 180+ individual mesh calls.
 *
 * The component renders MAX_ROCKETS instances for each part (total 6 * 50 = 300 instances).
 * Instance visibility is controlled via scale updates in useFrame (scale=1 = visible, scale=0 = hidden).
 * Position/rotation data comes from gameStore.rockets (non-reactive access).
 */
export function InstancedRockets() {
  // Pre-cached materials (created once, reused)
  const materials = useMemo(() => ({
    body: getRocketBodyMaterial(),
    nose: getRocketNoseMaterial(),
    fireCore: getRocketFireCoreMaterial(),
    fireInner: getRocketFireInnerMaterial(),
    fireOuter: getRocketFireOuterMaterial(),
    smoke: getRocketSmokeMaterial(),
  }), []);

  // Store instance refs for per-frame updates
  const instanceRefs = useRef<InstanceData[]>([]);

  useFrame(() => {
    const rockets = useGameStore.getState().rockets;
    const now = getFrameClock().nowMs;

    // Initialize instance refs array if needed
    while (instanceRefs.current.length < MAX_ROCKETS) {
      instanceRefs.current.push({
        body: null,
        nose: null,
        fireCore: null,
        fireInner: null,
        fireOuter: null,
        smoke: null,
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

      // Update all instances for this rocket
      updateInstance(instances.body, _rocketPos, _rocketQuat, [0.08, 0.35, 0.08], alive, [Math.PI / 2, 0, 0]);
      updateInstance(instances.nose, _rocketPos, _rocketQuat, [0.04, 0.08, 0.04], alive, [Math.PI / 2, 0, 0], [0, 0, -0.2]);
      updateInstance(instances.fireCore, _rocketPos, _rocketQuat, [0.05, 0.35, 0.05], alive, [Math.PI / 2, 0, 0], [0, 0, 0.22]);
      updateInstance(instances.fireInner, _rocketPos, _rocketQuat, [0.08, 0.45, 0.08], alive, [Math.PI / 2, 0, 0], [0, 0, 0.32]);
      updateInstance(instances.fireOuter, _rocketPos, _rocketQuat, [0.12, 0.5, 0.12], alive, [Math.PI / 2, 0, 0], [0, 0, 0.4]);
      updateInstance(instances.smoke, _rocketPos, _rocketQuat, [0.15, 0.4, 0.15], alive, [Math.PI / 2, 0, 0], [0, 0, 0.55]);
    });

    // Hide unused instances (beyond current rocket count)
    for (let i = rockets.length; i < MAX_ROCKETS; i++) {
      const instances = instanceRefs.current[i];
      if (!instances) continue;

      // Hide all parts for unused slots
      if (instances.body) instances.body.scale.setScalar(0);
      if (instances.nose) instances.nose.scale.setScalar(0);
      if (instances.fireCore) instances.fireCore.scale.setScalar(0);
      if (instances.fireInner) instances.fireInner.scale.setScalar(0);
      if (instances.fireOuter) instances.fireOuter.scale.setScalar(0);
      if (instances.smoke) instances.smoke.scale.setScalar(0);
    }
  });

  // Render MAX_ROCKETS instances for each part
  // Instances are hidden/shown via scale updates in useFrame
  const instanceSlots = Array.from({ length: MAX_ROCKETS }, (_, i) => i);

  return (
    <group>
      {/* Rocket bodies - dark metallic */}
      <Instances limit={MAX_ROCKETS} castShadow receiveShadow>
        <primitive object={SHARED_GEOMETRIES.cone8} />
        <primitive object={materials.body} />
        {instanceSlots.map((index) => (
          <Instance
            key={`body-${index}`}
            ref={(el) => {
              if (!instanceRefs.current[index]) {
                instanceRefs.current[index] = {
                  body: null,
                  nose: null,
                  fireCore: null,
                  fireInner: null,
                  fireOuter: null,
                  smoke: null,
                };
              }
              instanceRefs.current[index].body = el as THREE.Object3D | null;
            }}
          />
        ))}
      </Instances>

      {/* Rocket noses - glowing orange */}
      <Instances limit={MAX_ROCKETS} castShadow>
        <primitive object={SHARED_GEOMETRIES.cone6} />
        <primitive object={materials.nose} />
        {instanceSlots.map((index) => (
          <Instance
            key={`nose-${index}`}
            ref={(el) => {
              if (instanceRefs.current[index]) {
                instanceRefs.current[index].nose = el as THREE.Object3D | null;
              }
            }}
          />
        ))}
      </Instances>

      {/* Fire core - bright white/yellow */}
      <Instances limit={MAX_ROCKETS}>
        <primitive object={SHARED_GEOMETRIES.cone8} />
        <primitive object={materials.fireCore} />
        {instanceSlots.map((index) => (
          <Instance
            key={`fireCore-${index}`}
            ref={(el) => {
              if (instanceRefs.current[index]) {
                instanceRefs.current[index].fireCore = el as THREE.Object3D | null;
              }
            }}
          />
        ))}
      </Instances>

      {/* Fire inner - bright orange */}
      <Instances limit={MAX_ROCKETS}>
        <primitive object={SHARED_GEOMETRIES.cone8} />
        <primitive object={materials.fireInner} />
        {instanceSlots.map((index) => (
          <Instance
            key={`fireInner-${index}`}
            ref={(el) => {
              if (instanceRefs.current[index]) {
                instanceRefs.current[index].fireInner = el as THREE.Object3D | null;
              }
            }}
          />
        ))}
      </Instances>

      {/* Fire outer - red/orange */}
      <Instances limit={MAX_ROCKETS}>
        <primitive object={SHARED_GEOMETRIES.cone8} />
        <primitive object={materials.fireOuter} />
        {instanceSlots.map((index) => (
          <Instance
            key={`fireOuter-${index}`}
            ref={(el) => {
              if (instanceRefs.current[index]) {
                instanceRefs.current[index].fireOuter = el as THREE.Object3D | null;
              }
            }}
          />
        ))}
      </Instances>

      {/* Smoke trail */}
      <Instances limit={MAX_ROCKETS}>
        <primitive object={SHARED_GEOMETRIES.cone6} />
        <primitive object={materials.smoke} />
        {instanceSlots.map((index) => (
          <Instance
            key={`smoke-${index}`}
            ref={(el) => {
              if (instanceRefs.current[index]) {
                instanceRefs.current[index].smoke = el as THREE.Object3D | null;
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
 * Hides dead rockets by setting scale to 0
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
