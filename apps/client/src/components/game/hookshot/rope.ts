import * as THREE from 'three';
import { HOOKSHOT_COLORS, TEMP_VECTORS } from '../effectResources';

export const PLIABLE_ROPE_SEGMENT_COUNT = 9;

export const HOOK_MAIN_ROPE_MATERIAL = new THREE.MeshBasicMaterial({
  color: HOOKSHOT_COLORS.energy,
  transparent: false,
  opacity: 1,
  depthWrite: true,
});

export const HEAVY_HOOK_MAIN_ROPE_MATERIAL = new THREE.MeshBasicMaterial({
  color: HOOKSHOT_COLORS.energy,
  transparent: false,
  opacity: 1,
  depthWrite: true,
});

export function createRopePoints() {
  return Array.from({ length: PLIABLE_ROPE_SEGMENT_COUNT + 1 }, () => new THREE.Vector3());
}

export function updateRopeSegment(mesh: THREE.Mesh | null, start: THREE.Vector3, end: THREE.Vector3, radius: number) {
  if (!mesh) return;

  const length = start.distanceTo(end);
  if (length < 0.01) {
    mesh.visible = false;
    return;
  }

  mesh.visible = true;
  TEMP_VECTORS.v3.copy(start).add(end).multiplyScalar(0.5);
  mesh.position.copy(TEMP_VECTORS.v3);
  mesh.scale.set(radius, length, radius);
  mesh.lookAt(end);
  mesh.rotateX(Math.PI / 2);
}

function setCubicBezierPoint(
  out: THREE.Vector3,
  start: THREE.Vector3,
  controlA: THREE.Vector3,
  controlB: THREE.Vector3,
  end: THREE.Vector3,
  t: number
) {
  const invT = 1 - t;
  const startWeight = invT * invT * invT;
  const controlAWeight = 3 * invT * invT * t;
  const controlBWeight = 3 * invT * t * t;
  const endWeight = t * t * t;

  out.set(
    start.x * startWeight + controlA.x * controlAWeight + controlB.x * controlBWeight + end.x * endWeight,
    start.y * startWeight + controlA.y * controlAWeight + controlB.y * controlBWeight + end.y * endWeight,
    start.z * startWeight + controlA.z * controlAWeight + controlB.z * controlBWeight + end.z * endWeight
  );
}

export function updatePliableRopePoints(
  ropePoints: THREE.Vector3[],
  controlA: THREE.Vector3,
  controlB: THREE.Vector3,
  ropeStart: THREE.Vector3,
  ropeEnd: THREE.Vector3,
  ropeLag: THREE.Vector3,
  ropeLength: number,
  maxSag = 0.18
) {
  const segmentCount = ropePoints.length - 1;

  controlA.copy(ropeStart).lerp(ropeEnd, 0.28).addScaledVector(ropeLag, 0.72);
  controlB.copy(ropeStart).lerp(ropeEnd, 0.64).addScaledVector(ropeLag, 0.28);

  const sag = Math.min(ropeLength * 0.025, maxSag);
  controlA.y -= sag * 0.35;
  controlB.y -= sag;

  for (let i = 1; i < segmentCount; i++) {
    setCubicBezierPoint(ropePoints[i], ropeStart, controlA, controlB, ropeEnd, i / segmentCount);
  }
}
