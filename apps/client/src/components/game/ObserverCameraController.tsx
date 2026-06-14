import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { VoxelMapManifest } from '@voxel-strike/shared';
import { useInput } from '../../hooks/useInput';
import { useCamera } from '../../hooks/player/useCamera';
import { setAudioListenerTransform } from '../../hooks/useAudio';
import { OBSERVER_FLY_SPEED_PRESETS, useGameStore } from '../../store/gameStore';
import { isGameConsoleOpen } from '../../store/gameConsoleState';
import { getPreparedVoxelMap, prepareVoxelMapCpu } from '../../utils/mapWarmup/mapPrepCache';

interface ObserverCameraControllerProps {
  enabled: boolean;
}

const FALLBACK_START_POSITION = new THREE.Vector3(0, 42, 36);
const FALLBACK_LOOK_TARGET = new THREE.Vector3(0, 8, 0);
const MIN_ELEVATION = 1.5;
const MAX_ELEVATION = 140;
const START_HEIGHT_ABOVE_SURFACE = 18;
const START_HEIGHT_ABOVE_SPAWNS = 12;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const forwardScratch = new THREE.Vector3();
const rightScratch = new THREE.Vector3();
const movementScratch = new THREE.Vector3();
const audioForwardScratch = new THREE.Vector3();
const audioUpScratch = new THREE.Vector3();

interface ObserverCameraStart {
  key: string;
  position: THREE.Vector3;
  target: THREE.Vector3;
}

function getHeightfieldSurfaceY(manifest: VoxelMapManifest, x: number, z: number): number | null {
  const heightfield = manifest.heightfield;
  const gridX = Math.floor((x - heightfield.origin.x) / heightfield.voxelSize.x);
  const gridZ = Math.floor((z - heightfield.origin.z) / heightfield.voxelSize.z);

  if (gridX < 0 || gridX >= heightfield.size.x || gridZ < 0 || gridZ >= heightfield.size.z) {
    return null;
  }

  const topRow = heightfield.topSolidRows[gridX + gridZ * heightfield.size.x];
  if (typeof topRow !== 'number' || topRow === 0) return null;

  return heightfield.origin.y + topRow * heightfield.voxelSize.y;
}

function averagePoints(points: Array<{ x: number; y: number; z: number }>): THREE.Vector3 | null {
  if (points.length === 0) return null;

  const total = points.reduce(
    (sum, point) => {
      sum.x += point.x;
      sum.y += point.y;
      sum.z += point.z;
      return sum;
    },
    { x: 0, y: 0, z: 0 }
  );

  return new THREE.Vector3(
    total.x / points.length,
    total.y / points.length,
    total.z / points.length
  );
}

function createObserverCameraStart(manifest: VoxelMapManifest, key: string): ObserverCameraStart {
  const gameplaySpawns = manifest.gameplay?.spawns;
  const spawnPoints = [
    ...(gameplaySpawns?.red?.points ?? manifest.spawnPoints.red),
    ...(gameplaySpawns?.blue?.points ?? manifest.spawnPoints.blue),
  ];
  const spawnCenter = averagePoints(spawnPoints);
  const previewPosition = manifest.preview?.camera?.position;
  const previewTarget = manifest.preview?.camera?.target;
  const target = previewTarget
    ? new THREE.Vector3(previewTarget.x, previewTarget.y, previewTarget.z)
    : spawnCenter ?? FALLBACK_LOOK_TARGET.clone();
  const position = previewPosition
    ? new THREE.Vector3(previewPosition.x, previewPosition.y, previewPosition.z)
    : spawnCenter
      ? new THREE.Vector3(spawnCenter.x, spawnCenter.y + START_HEIGHT_ABOVE_SURFACE, spawnCenter.z + 28)
      : FALLBACK_START_POSITION.clone();
  const surfaceY = getHeightfieldSurfaceY(manifest, position.x, position.z);
  const highestSpawnY = spawnPoints.reduce((max, point) => Math.max(max, point.y), -Infinity);
  const minimumSafeY = Math.max(
    surfaceY === null ? -Infinity : surfaceY + START_HEIGHT_ABOVE_SURFACE,
    Number.isFinite(highestSpawnY) ? highestSpawnY + START_HEIGHT_ABOVE_SPAWNS : -Infinity,
    MIN_ELEVATION + START_HEIGHT_ABOVE_SURFACE
  );

  position.y = THREE.MathUtils.clamp(Math.max(position.y, minimumSafeY), MIN_ELEVATION, MAX_ELEVATION);
  return { key, position, target };
}

export function ObserverCameraController({ enabled }: ObserverCameraControllerProps) {
  const { camera, gl } = useThree();
  const { inputState, isPointerLocked, requestPointerLock, exitPointerLock } = useInput();
  const cameraControl = useCamera({ isPointerLocked });
  const mapSeed = useGameStore((state) => state.mapSeed);
  const mapThemeId = useGameStore((state) => state.mapThemeId);
  const flySpeed = useGameStore((state) => OBSERVER_FLY_SPEED_PRESETS[state.observerFlySpeedPreset]);
  const cameraStart = useMemo(() => {
    try {
      const preparedMap = getPreparedVoxelMap({ seed: mapSeed, themeId: mapThemeId })
        ?? prepareVoxelMapCpu({ seed: mapSeed, themeId: mapThemeId, source: 'match' });
      return createObserverCameraStart(preparedMap.manifest, preparedMap.key);
    } catch (error) {
      console.warn('[ObserverCamera] Failed to resolve map start position', error);
      return {
        key: `fallback:${mapSeed >>> 0}:${mapThemeId ?? 'default'}`,
        position: FALLBACK_START_POSITION.clone(),
        target: FALLBACK_LOOK_TARGET.clone(),
      };
    }
  }, [mapSeed, mapThemeId]);
  const positionRef = useRef(cameraStart.position.clone());
  const initializedKeyRef = useRef<string | null>(null);
  const verticalRef = useRef({ up: false, down: false });

  useEffect(() => {
    if (!enabled) {
      initializedKeyRef.current = null;
      exitPointerLock();
      return;
    }

    if (initializedKeyRef.current === cameraStart.key) return;

    initializedKeyRef.current = cameraStart.key;
    positionRef.current.copy(cameraStart.position);
    camera.position.copy(positionRef.current);
    camera.rotation.order = 'YXZ';
    camera.lookAt(cameraStart.target);
    cameraControl.refs.yaw.current = camera.rotation.y;
    cameraControl.refs.pitch.current = camera.rotation.x;
    camera.rotation.y = cameraControl.refs.yaw.current;
    camera.rotation.x = cameraControl.refs.pitch.current;
    camera.rotation.z = 0;
  }, [camera, cameraControl.refs.pitch, cameraControl.refs.yaw, cameraStart, enabled, exitPointerLock]);

  useEffect(() => {
    if (!enabled) return;

    const handlePointerDown = () => {
      if (isGameConsoleOpen()) return;
      requestPointerLock();
    };

    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    return () => canvas.removeEventListener('pointerdown', handlePointerDown);
  }, [enabled, gl.domElement, requestPointerLock]);

  useEffect(() => {
    if (!enabled) return;

    const setVertical = (code: string, pressed: boolean): boolean => {
      if (code === 'Space') {
        verticalRef.current.up = pressed;
        return true;
      }
      if (code === 'KeyC') {
        verticalRef.current.down = pressed;
        return true;
      }
      return false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isGameConsoleOpen()) return;
      if (setVertical(event.code, true)) {
        event.preventDefault();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (setVertical(event.code, false)) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      verticalRef.current.up = false;
      verticalRef.current.down = false;
    };
  }, [enabled]);

  useFrame((_, delta) => {
    if (!enabled) return;

    const dt = Math.min(delta, 0.05);
    cameraControl.updateCameraRotation(camera, false, false, dt);

    camera.getWorldDirection(forwardScratch).normalize();
    rightScratch.crossVectors(forwardScratch, WORLD_UP);
    if (rightScratch.lengthSq() < 0.0001) {
      const yaw = cameraControl.refs.yaw.current;
      rightScratch.set(Math.cos(yaw), 0, -Math.sin(yaw));
    } else {
      rightScratch.normalize();
    }
    movementScratch.set(0, 0, 0);

    if (inputState.moveForward) movementScratch.add(forwardScratch);
    if (inputState.moveBackward) movementScratch.sub(forwardScratch);
    if (inputState.moveRight) movementScratch.add(rightScratch);
    if (inputState.moveLeft) movementScratch.sub(rightScratch);
    if (verticalRef.current.up) movementScratch.y += 1;
    if (verticalRef.current.down) movementScratch.y -= 1;

    if (movementScratch.lengthSq() > 0.0001) {
      movementScratch.normalize().multiplyScalar((inputState.sprint ? flySpeed.sprint : flySpeed.base) * dt);
      positionRef.current.add(movementScratch);
      positionRef.current.y = THREE.MathUtils.clamp(positionRef.current.y, MIN_ELEVATION, MAX_ELEVATION);
      camera.position.copy(positionRef.current);
    }

    camera.getWorldDirection(audioForwardScratch);
    audioUpScratch.set(0, 1, 0).applyQuaternion(camera.quaternion);
    setAudioListenerTransform(camera.position, audioForwardScratch, audioUpScratch);
  });

  return null;
}
