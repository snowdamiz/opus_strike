import { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  MOVEMENT_REMOTE_EXTRAPOLATION_CAP_MS,
  type BattleRoyalDropPlayerSnapshot,
  type BattleRoyalDropSnapshot,
} from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import {
  sampleRemoteTransformInto,
  visualStore,
  type SampledRemoteTransform,
} from '../../store/visualStore';
import {
  getBattleRoyalDropShipYaw,
  writeBattleRoyalDropPlayerSnapshotPosition,
  writeBattleRoyalDropShipPosition,
} from './battleRoyalDropView';

const SHIP_SCALE = 1.05;
const POD_SCALE = 0.92;
const POD_POSITION_SMOOTHING = 24;
const POD_REMOTE_POSITION_SMOOTHING = 32;
const POD_ROTATION_SMOOTHING = 18;
const POD_VELOCITY_SMOOTHING = 14;
const POD_SNAP_DISTANCE = 80;
const POD_SNAP_DISTANCE_SQ = POD_SNAP_DISTANCE * POD_SNAP_DISTANCE;
const POD_MODEL_FORWARD = new THREE.Vector3(0, 1, 0);
const POD_SNAPSHOT_EXTRAPOLATION_CAP_MS = 10_000;

function createSampledRemoteTransform(): SampledRemoteTransform {
  return {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    movementBits: 0,
    wallRunSide: 0,
    movementEpoch: 0,
    extrapolatedMs: 0,
    stale: false,
  };
}

export function BattleRoyalDropDeployment() {
  const drop = useGameStore((state) => {
    const isVisiblePhase = state.gamePhase === 'countdown' || state.gamePhase === 'deployment';
    return state.gameplayMode === 'battle_royal' && isVisiblePhase ? state.battleRoyalDrop : null;
  });
  const frozen = useGameStore((state) => state.gamePhase === 'countdown');
  const localPlayerId = useGameStore((state) => state.localPlayer?.id ?? state.playerId);

  const podPlayers = useMemo(
    () => drop?.players.filter((player) => player.status === 'dropping') ?? [],
    [drop]
  );

  if (!drop?.enabled) return null;

  return (
    <group>
      <DropShipVisual drop={drop} frozen={frozen} />
      {podPlayers.map((player) => (
        <DropPodVisual
          key={player.playerId}
          snapshot={player}
          snapshotServerTime={drop.serverTime}
          isLocal={player.playerId === localPlayerId}
        />
      ))}
    </group>
  );
}

const DropShipVisual = memo(function DropShipVisual({
  drop,
  frozen,
}: {
  drop: BattleRoyalDropSnapshot;
  frozen: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const positionRef = useRef(new THREE.Vector3());
  const yaw = useMemo(() => getBattleRoyalDropShipYaw(drop), [drop]);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    group.position.copy(writeBattleRoyalDropShipPosition(
      drop,
      frozen ? drop.ship.startedAt : Date.now(),
      positionRef.current
    ));
    group.rotation.set(0, yaw, 0);
  });

  return (
    <group ref={groupRef} scale={SHIP_SCALE}>
      <mesh position={[0, 0, -0.4]} castShadow receiveShadow>
        <boxGeometry args={[4.4, 1.8, 12.8]} />
        <meshStandardMaterial color="#21344f" metalness={0.58} roughness={0.34} />
      </mesh>
      <mesh position={[0, 0.16, 6.8]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <coneGeometry args={[2.35, 3.4, 4]} />
        <meshStandardMaterial color="#b8c7d8" metalness={0.5} roughness={0.24} />
      </mesh>
      <mesh position={[0, 1.02, 1.8]} castShadow>
        <boxGeometry args={[2.25, 0.58, 3.8]} />
        <meshStandardMaterial color="#85dfff" emissive="#165f86" emissiveIntensity={0.28} metalness={0.2} roughness={0.18} />
      </mesh>
      <mesh position={[0, -0.86, -1.8]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.45, 6.1]} />
        <meshStandardMaterial color="#142236" metalness={0.48} roughness={0.36} />
      </mesh>
      <mesh position={[-4.1, -0.12, -1.2]} rotation={[0.08, -0.28, -0.08]} castShadow receiveShadow>
        <boxGeometry args={[6.2, 0.32, 4.2]} />
        <meshStandardMaterial color="#2e496e" metalness={0.46} roughness={0.38} />
      </mesh>
      <mesh position={[4.1, -0.12, -1.2]} rotation={[0.08, 0.28, 0.08]} castShadow receiveShadow>
        <boxGeometry args={[6.2, 0.32, 4.2]} />
        <meshStandardMaterial color="#2e496e" metalness={0.46} roughness={0.38} />
      </mesh>
      <mesh position={[-5.55, 0.12, -2.95]} rotation={[0, 0, 0.12]} castShadow>
        <boxGeometry args={[0.58, 1.95, 2.2]} />
        <meshStandardMaterial color="#17253d" metalness={0.52} roughness={0.33} />
      </mesh>
      <mesh position={[5.55, 0.12, -2.95]} rotation={[0, 0, -0.12]} castShadow>
        <boxGeometry args={[0.58, 1.95, 2.2]} />
        <meshStandardMaterial color="#17253d" metalness={0.52} roughness={0.33} />
      </mesh>
      <mesh position={[-1.35, -0.08, -7.25]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.66, 0.82, 1.8, 14]} />
        <meshStandardMaterial color="#0f1a2a" metalness={0.72} roughness={0.24} />
      </mesh>
      <mesh position={[1.35, -0.08, -7.25]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.66, 0.82, 1.8, 14]} />
        <meshStandardMaterial color="#0f1a2a" metalness={0.72} roughness={0.24} />
      </mesh>
      <pointLight position={[-1.35, -0.08, -8.35]} color="#67e8f9" intensity={28} distance={16} decay={2} />
      <pointLight position={[1.35, -0.08, -8.35]} color="#67e8f9" intensity={28} distance={16} decay={2} />
      <mesh position={[-1.35, -0.08, -8.72]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.44, 2.6, 12]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.48} depthWrite={false} />
      </mesh>
      <mesh position={[1.35, -0.08, -8.72]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.44, 2.6, 12]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.48} depthWrite={false} />
      </mesh>
    </group>
  );
});

const DropPodVisual = memo(function DropPodVisual({
  snapshot,
  snapshotServerTime,
  isLocal,
}: {
  snapshot: BattleRoyalDropPlayerSnapshot;
  snapshotServerTime: number;
  isLocal: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const targetRef = useRef(new THREE.Vector3());
  const targetVelocityRef = useRef(new THREE.Vector3(snapshot.velocity.x, snapshot.velocity.y, snapshot.velocity.z));
  const previousTargetRef = useRef(new THREE.Vector3(snapshot.position.x, snapshot.position.y, snapshot.position.z));
  const hasPreviousTargetRef = useRef(false);
  const velocityRef = useRef(new THREE.Vector3());
  const sampledRemoteRef = useRef<SampledRemoteTransform>(createSampledRemoteTransform());
  const initializedRef = useRef(false);
  const directionRef = useRef(new THREE.Vector3(0, -1, 0));
  const quaternionRef = useRef(new THREE.Quaternion());

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const nowMs = Date.now();
    const sampledRemote = sampledRemoteRef.current;
    const hasSampledRemote = !isLocal && sampleRemoteTransformInto(snapshot.playerId, sampledRemote, nowMs);
    const visualPosition = isLocal ? visualStore.getState().playerPositions.get(snapshot.playerId) : null;
    const target = hasSampledRemote
      ? writeSampledDropPodPosition(sampledRemote, targetRef.current)
      : visualPosition
        ? targetRef.current.set(visualPosition.x, visualPosition.y, visualPosition.z)
        : writeExtrapolatedDropPodSnapshotPosition(snapshot, snapshotServerTime, nowMs, targetRef.current);

    if (hasSampledRemote) {
      targetVelocityRef.current.set(
        sampledRemote.velocity.x,
        sampledRemote.velocity.y,
        sampledRemote.velocity.z
      );
    } else if (hasPreviousTargetRef.current && delta > 0.0001) {
      targetVelocityRef.current.copy(target).sub(previousTargetRef.current).multiplyScalar(1 / delta);
    } else {
      targetVelocityRef.current.set(snapshot.velocity.x, snapshot.velocity.y, snapshot.velocity.z);
    }
    previousTargetRef.current.copy(target);
    hasPreviousTargetRef.current = true;

    const velocitySmoothing = 1 - Math.exp(-POD_VELOCITY_SMOOTHING * delta);
    if (!initializedRef.current) {
      velocityRef.current.copy(targetVelocityRef.current);
    } else {
      velocityRef.current.lerp(targetVelocityRef.current, velocitySmoothing);
    }
    if (velocityRef.current.lengthSq() <= 0.01) {
      velocityRef.current.set(snapshot.velocity.x, snapshot.velocity.y, snapshot.velocity.z);
    }
    if (velocityRef.current.lengthSq() <= 0.01) {
      velocityRef.current.set(0, -1, 0);
    }
    directionRef.current.copy(velocityRef.current).normalize();
    quaternionRef.current.setFromUnitVectors(POD_MODEL_FORWARD, directionRef.current);

    if (!initializedRef.current || group.position.distanceToSquared(target) > POD_SNAP_DISTANCE_SQ) {
      group.position.copy(target);
      initializedRef.current = true;
    } else {
      const smoothingRate = hasSampledRemote ? POD_REMOTE_POSITION_SMOOTHING : POD_POSITION_SMOOTHING;
      group.position.lerp(target, 1 - Math.exp(-smoothingRate * delta));
    }
    group.quaternion.slerp(quaternionRef.current, 1 - Math.exp(-POD_ROTATION_SMOOTHING * delta));
  });

  return (
    <group
      ref={groupRef}
      position={[snapshot.position.x, snapshot.position.y, snapshot.position.z]}
      scale={POD_SCALE}
    >
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.72, 0.82, 2.65, 14]} />
        <meshStandardMaterial color="#34465d" metalness={0.56} roughness={0.35} />
      </mesh>
      <mesh position={[0, 1.58, 0]} castShadow>
        <coneGeometry args={[0.72, 1.1, 14]} />
        <meshStandardMaterial color="#d9e1ec" metalness={0.44} roughness={0.24} />
      </mesh>
      <mesh position={[0, -1.48, 0]} rotation={[Math.PI, 0, 0]} castShadow>
        <coneGeometry args={[0.84, 0.72, 14]} />
        <meshStandardMaterial color="#172235" metalness={0.64} roughness={0.28} />
      </mesh>
      <mesh position={[0, 0.45, -0.76]} castShadow>
        <boxGeometry args={[0.92, 0.72, 0.08]} />
        <meshStandardMaterial color="#7dd3fc" emissive="#0e7490" emissiveIntensity={0.18} metalness={0.2} roughness={0.2} />
      </mesh>
      <mesh position={[0.78, -0.75, 0]} rotation={[0, 0, 0.38]} castShadow>
        <boxGeometry args={[0.3, 1.15, 0.13]} />
        <meshStandardMaterial color="#7b8798" metalness={0.48} roughness={0.4} />
      </mesh>
      <mesh position={[-0.78, -0.75, 0]} rotation={[0, 0, -0.38]} castShadow>
        <boxGeometry args={[0.3, 1.15, 0.13]} />
        <meshStandardMaterial color="#7b8798" metalness={0.48} roughness={0.4} />
      </mesh>
      <mesh position={[0, -0.75, 0.78]} rotation={[0.38, 0, 0]} castShadow>
        <boxGeometry args={[0.13, 1.15, 0.3]} />
        <meshStandardMaterial color="#7b8798" metalness={0.48} roughness={0.4} />
      </mesh>
      <mesh position={[0, -0.75, -0.78]} rotation={[-0.38, 0, 0]} castShadow>
        <boxGeometry args={[0.13, 1.15, 0.3]} />
        <meshStandardMaterial color="#7b8798" metalness={0.48} roughness={0.4} />
      </mesh>
      {snapshot.status === 'dropping' ? (
        <>
          <pointLight position={[0, -1.9, 0]} color="#ffb347" intensity={24} distance={10} decay={2} />
          <mesh position={[0, -2.15, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.46, 1.75, 12]} />
            <meshBasicMaterial color="#ffb347" transparent opacity={0.62} depthWrite={false} />
          </mesh>
        </>
      ) : null}
    </group>
  );
});

function writeSampledDropPodPosition(
  sampledRemote: SampledRemoteTransform,
  target: THREE.Vector3
): THREE.Vector3 {
  const extraSeconds = sampledRemote.stale
    ? Math.max(0, sampledRemote.extrapolatedMs - MOVEMENT_REMOTE_EXTRAPOLATION_CAP_MS) / 1000
    : 0;
  return target.set(
    sampledRemote.position.x + sampledRemote.velocity.x * extraSeconds,
    sampledRemote.position.y + sampledRemote.velocity.y * extraSeconds,
    sampledRemote.position.z + sampledRemote.velocity.z * extraSeconds
  );
}

function writeExtrapolatedDropPodSnapshotPosition(
  snapshot: BattleRoyalDropPlayerSnapshot,
  snapshotServerTime: number,
  nowMs: number,
  target: THREE.Vector3
): THREE.Vector3 {
  if (!Number.isFinite(snapshotServerTime)) {
    return writeBattleRoyalDropPlayerSnapshotPosition(snapshot, target);
  }

  const ageSeconds = Math.min(
    POD_SNAPSHOT_EXTRAPOLATION_CAP_MS,
    Math.max(0, nowMs - snapshotServerTime)
  ) / 1000;
  return target.set(
    snapshot.position.x + snapshot.velocity.x * ageSeconds,
    snapshot.position.y + snapshot.velocity.y * ageSeconds,
    snapshot.position.z + snapshot.velocity.z * ageSeconds
  );
}
