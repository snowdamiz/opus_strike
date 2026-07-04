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

const SHIP_SCALE = 1.38;
const POD_SCALE = 1.05;
const POD_POSITION_SMOOTHING = 24;
const POD_REMOTE_POSITION_SMOOTHING = 32;
const POD_ROTATION_SMOOTHING = 18;
const POD_VELOCITY_SMOOTHING = 14;
const POD_SNAP_DISTANCE = 80;
const POD_SNAP_DISTANCE_SQ = POD_SNAP_DISTANCE * POD_SNAP_DISTANCE;
const POD_MODEL_FORWARD = new THREE.Vector3(0, 1, 0);
const POD_SNAPSHOT_EXTRAPOLATION_CAP_MS = 10_000;
const SHIP_WINDOW_Z_OFFSETS = [3.8, 2.65, 1.5, 0.35, -0.8, -1.95, -3.1] as const;
const SHIP_ENGINE_X_OFFSETS = [-2.25, 0, 2.25] as const;
const SHIP_WING_TIP_LIGHTS = [
  { x: -8.7, color: '#ff5a7a' },
  { x: 8.7, color: '#67e8f9' },
] as const;
const SHIP_VENT_Z_OFFSETS = [-6.45, -5.55, -4.65, -3.75] as const;
const POD_WINDOW_X_OFFSETS = [-0.42, 0, 0.42] as const;
const POD_RCS_PORTS: Array<{
  key: string;
  position: [number, number, number];
  rotation: [number, number, number];
}> = [
  { key: 'port', position: [-0.96, -0.08, 0], rotation: [0, 0, Math.PI / 2] },
  { key: 'starboard', position: [0.96, -0.08, 0], rotation: [0, 0, -Math.PI / 2] },
  { key: 'dorsal', position: [0, -0.08, 0.96], rotation: [Math.PI / 2, 0, 0] },
  { key: 'ventral', position: [0, -0.08, -0.96], rotation: [-Math.PI / 2, 0, 0] },
];

function createDropShipNoseGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -2.9, -1.05, 7.35,
    2.9, -1.05, 7.35,
    2.65, 0.95, 7.35,
    -2.65, 0.95, 7.35,
    -0.72, -0.36, 10.35,
    0.72, -0.36, 10.35,
    0.98, 0.34, 10.35,
    -0.98, 0.34, 10.35,
  ], 3));
  geometry.setIndex([
    4, 5, 6, 4, 6, 7,
    3, 2, 6, 3, 6, 7,
    0, 4, 5, 0, 5, 1,
    0, 3, 7, 0, 7, 4,
    1, 5, 6, 1, 6, 2,
    0, 1, 2, 0, 2, 3,
  ]);
  geometry.computeVertexNormals();
  return geometry;
}

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
  const gameplayMode = useGameStore((state) => state.gameplayMode);
  const gamePhase = useGameStore((state) => state.gamePhase);
  const drop = useGameStore((state) => state.battleRoyalDrop);
  const localPlayerId = useGameStore((state) => state.localPlayer?.id ?? state.playerId);
  const isBattleRoyal = gameplayMode === 'battle_royal';
  const isDeploymentPhase = gamePhase === 'countdown' || gamePhase === 'deployment';
  const shouldRenderDropVisuals = isBattleRoyal && isDeploymentPhase && drop?.enabled === true;

  const podPlayers = useMemo(
    () => shouldRenderDropVisuals ? drop?.players.filter((player) => (
      player.status === 'dropping' && player.attachedToPlayerId === null
    )) ?? [] : [],
    [drop, shouldRenderDropVisuals]
  );

  if (!shouldRenderDropVisuals) return null;

  return (
    <group>
      {shouldRenderDropVisuals && drop ? <DropShipVisual drop={drop} frozen={gamePhase === 'countdown'} /> : null}
      {shouldRenderDropVisuals && drop ? podPlayers.map((player) => {
        const isLocal = player.playerId === localPlayerId;
        return (
          <DropPodVisual
            key={player.playerId}
            snapshot={player}
            snapshotServerTime={drop.serverTime}
            isLocal={isLocal}
          />
        );
      }) : null}
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
  const engineFlameMaterialsRef = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const engineLightRefs = useRef<(THREE.PointLight | null)[]>([]);
  const positionRef = useRef(new THREE.Vector3());
  const yaw = useMemo(() => getBattleRoyalDropShipYaw(drop), [drop]);
  const noseGeometry = useMemo(createDropShipNoseGeometry, []);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;

    group.position.copy(writeBattleRoyalDropShipPosition(
      drop,
      frozen ? drop.ship.startedAt : Date.now(),
      positionRef.current
    ));
    const flightPulse = clock.elapsedTime;
    group.position.y += Math.sin(flightPulse * 1.15) * 0.22;
    group.rotation.set(
      Math.sin(flightPulse * 0.9) * 0.014,
      yaw,
      Math.sin(flightPulse * 0.7) * 0.032
    );

    const enginePulse = 0.48
      + Math.sin(flightPulse * 18) * 0.08
      + Math.sin(flightPulse * 31) * 0.04;
    engineFlameMaterialsRef.current.forEach((material) => {
      if (material) material.opacity = enginePulse;
    });
    engineLightRefs.current.forEach((light, index) => {
      if (light) light.intensity = (index === 1 ? 34 : 28) + enginePulse * 14;
    });
  });

  return (
    <group ref={groupRef} scale={SHIP_SCALE}>
      <mesh position={[0, 0, -0.35]} castShadow receiveShadow>
        <boxGeometry args={[5.8, 2.15, 15.6]} />
        <meshStandardMaterial color="#16263b" metalness={0.68} roughness={0.28} />
      </mesh>
      <mesh geometry={noseGeometry} castShadow receiveShadow>
        <meshStandardMaterial color="#324a63" metalness={0.62} roughness={0.24} />
      </mesh>
      <mesh position={[0, 0.46, 8.62]} rotation={[-0.16, 0, 0]} castShadow>
        <boxGeometry args={[1.6, 0.24, 2.35]} />
        <meshStandardMaterial
          color="#7dd3fc"
          emissive="#0e7490"
          emissiveIntensity={0.42}
          metalness={0.18}
          roughness={0.14}
        />
      </mesh>
      <mesh position={[0, 0.72, -0.6]} castShadow receiveShadow>
        <boxGeometry args={[3.45, 0.62, 12.6]} />
        <meshStandardMaterial color="#263e5d" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 1.2, 2.55]} castShadow>
        <boxGeometry args={[2.35, 0.58, 3.45]} />
        <meshStandardMaterial
          color="#284866"
          emissive="#0b4f6d"
          emissiveIntensity={0.22}
          metalness={0.38}
          roughness={0.2}
        />
      </mesh>
      <mesh position={[-1.34, 0.24, 7.98]} rotation={[0, -0.28, 0]}>
        <boxGeometry args={[0.08, 0.18, 1.65]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.78} depthWrite={false} />
      </mesh>
      <mesh position={[1.34, 0.24, 7.98]} rotation={[0, 0.28, 0]}>
        <boxGeometry args={[0.08, 0.18, 1.65]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.78} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.78, -2.95]} castShadow>
        <boxGeometry args={[1.25, 0.46, 8.2]} />
        <meshStandardMaterial color="#0d1728" metalness={0.74} roughness={0.24} />
      </mesh>
      <mesh position={[0, 1.64, -6.55]} castShadow receiveShadow>
        <boxGeometry args={[1.55, 2.35, 2.9]} />
        <meshStandardMaterial color="#101d31" metalness={0.62} roughness={0.27} />
      </mesh>
      <mesh position={[0, -1.0, -1.55]} castShadow receiveShadow>
        <boxGeometry args={[2.95, 0.58, 9.4]} />
        <meshStandardMaterial color="#0b1423" metalness={0.58} roughness={0.32} />
      </mesh>
      <mesh position={[0, -1.34, 0.65]}>
        <boxGeometry args={[2.25, 0.08, 5.7]} />
        <meshBasicMaterial color="#fb923c" transparent opacity={0.34} depthWrite={false} />
      </mesh>
      <mesh position={[-4.95, -0.18, -1.35]} rotation={[0.05, -0.34, -0.08]} castShadow receiveShadow>
        <boxGeometry args={[7.8, 0.38, 5.35]} />
        <meshStandardMaterial color="#284869" metalness={0.56} roughness={0.32} />
      </mesh>
      <mesh position={[4.95, -0.18, -1.35]} rotation={[0.05, 0.34, 0.08]} castShadow receiveShadow>
        <boxGeometry args={[7.8, 0.38, 5.35]} />
        <meshStandardMaterial color="#284869" metalness={0.56} roughness={0.32} />
      </mesh>
      <mesh position={[-8.25, -0.22, -2.95]} rotation={[0.02, -0.48, -0.13]} castShadow receiveShadow>
        <boxGeometry args={[3.6, 0.28, 3.15]} />
        <meshStandardMaterial color="#122138" metalness={0.64} roughness={0.3} />
      </mesh>
      <mesh position={[8.25, -0.22, -2.95]} rotation={[0.02, 0.48, 0.13]} castShadow receiveShadow>
        <boxGeometry args={[3.6, 0.28, 3.15]} />
        <meshStandardMaterial color="#122138" metalness={0.64} roughness={0.3} />
      </mesh>
      <mesh position={[-6.25, 0.1, -5.55]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.78, 0.98, 3.45, 18]} />
        <meshStandardMaterial color="#101b2d" metalness={0.76} roughness={0.22} />
      </mesh>
      <mesh position={[6.25, 0.1, -5.55]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.78, 0.98, 3.45, 18]} />
        <meshStandardMaterial color="#101b2d" metalness={0.76} roughness={0.22} />
      </mesh>
      <mesh position={[-6.25, 0.1, -7.35]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.9, 0.08, 8, 22]} />
        <meshBasicMaterial color="#7dd3fc" transparent opacity={0.72} depthWrite={false} />
      </mesh>
      <mesh position={[6.25, 0.1, -7.35]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.9, 0.08, 8, 22]} />
        <meshBasicMaterial color="#7dd3fc" transparent opacity={0.72} depthWrite={false} />
      </mesh>
      {SHIP_ENGINE_X_OFFSETS.map((x, index) => (
        <group key={`drop-ship-engine-${x}`} position={[x, -0.22, -7.8]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.6, 0.84, 2.05, 18]} />
            <meshStandardMaterial color="#07111f" metalness={0.82} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0, -1.18]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.68, 0.07, 8, 20]} />
            <meshBasicMaterial color="#f59e0b" transparent opacity={0.8} depthWrite={false} />
          </mesh>
          <pointLight
            ref={(light) => {
              engineLightRefs.current[index] = light;
            }}
            position={[0, 0, -1.45]}
            color="#67e8f9"
            intensity={x === 0 ? 38 : 30}
            distance={18}
            decay={2}
          />
          <mesh position={[0, 0, -2.1]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[x === 0 ? 0.58 : 0.46, x === 0 ? 3.45 : 2.95, 18]} />
            <meshBasicMaterial
              ref={(material) => {
                engineFlameMaterialsRef.current[index] = material;
              }}
              color={x === 0 ? '#f97316' : '#67e8f9'}
              transparent
              opacity={x === 0 ? 0.52 : 0.46}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </group>
      ))}
      <pointLight position={[-6.25, 0.1, -7.75]} color="#67e8f9" intensity={22} distance={15} decay={2} />
      <pointLight position={[6.25, 0.1, -7.75]} color="#67e8f9" intensity={22} distance={15} decay={2} />
      <mesh position={[-6.25, 0.1, -8.55]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.62, 3.4, 18]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.32} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh position={[6.25, 0.1, -8.55]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.62, 3.4, 18]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.32} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {SHIP_WINDOW_Z_OFFSETS.map((z) => (
        <mesh key={`drop-ship-port-window-${z}`} position={[-2.96, 0.42, z]}>
          <boxGeometry args={[0.08, 0.34, 0.62]} />
          <meshStandardMaterial
            color="#a5f3fc"
            emissive="#22d3ee"
            emissiveIntensity={0.68}
            metalness={0.12}
            roughness={0.14}
          />
        </mesh>
      ))}
      {SHIP_WINDOW_Z_OFFSETS.map((z) => (
        <mesh key={`drop-ship-starboard-window-${z}`} position={[2.96, 0.42, z]}>
          <boxGeometry args={[0.08, 0.34, 0.62]} />
          <meshStandardMaterial
            color="#a5f3fc"
            emissive="#22d3ee"
            emissiveIntensity={0.68}
            metalness={0.12}
            roughness={0.14}
          />
        </mesh>
      ))}
      {SHIP_VENT_Z_OFFSETS.map((z) => (
        <mesh key={`drop-ship-vent-${z}`} position={[0, 0.03, z]}>
          <boxGeometry args={[6.05, 0.08, 0.12]} />
          <meshBasicMaterial color="#67e8f9" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      ))}
      {SHIP_WING_TIP_LIGHTS.map((light) => (
        <group key={`drop-ship-wing-tip-${light.x}`} position={[light.x, 0.05, -3.9]}>
          <pointLight color={light.color} intensity={10} distance={10} decay={2} />
          <mesh>
            <sphereGeometry args={[0.16, 10, 10]} />
            <meshBasicMaterial color={light.color} />
          </mesh>
        </group>
      ))}
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
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.08, 0.58, 2.08, 28]} />
        <meshStandardMaterial color="#d7e3ee" metalness={0.5} roughness={0.27} />
      </mesh>
      <mesh position={[0, 1.34, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.16, 1.04, 0.28, 28]} />
        <meshStandardMaterial color="#1c2634" metalness={0.64} roughness={0.32} />
      </mesh>
      <mesh position={[0, 1.51, 0]}>
        <cylinderGeometry args={[0.86, 0.98, 0.06, 28]} />
        <meshBasicMaterial color="#fb923c" transparent opacity={0.52} depthWrite={false} />
      </mesh>
      <mesh position={[0, -0.94, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.58, 0.74, 0.72, 24]} />
        <meshStandardMaterial color="#28384f" metalness={0.62} roughness={0.28} />
      </mesh>
      <mesh position={[0, -1.38, 0]} rotation={[Math.PI, 0, 0]} castShadow>
        <coneGeometry args={[0.54, 0.62, 24]} />
        <meshStandardMaterial color="#111827" metalness={0.78} roughness={0.2} />
      </mesh>
      <mesh position={[0, -1.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.64, 0.055, 8, 24]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.54} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.3, -1.02]} castShadow>
        <boxGeometry args={[1.28, 0.72, 0.08]} />
        <meshStandardMaterial color="#26384c" metalness={0.46} roughness={0.24} />
      </mesh>
      <mesh position={[0, 0.28, -1.07]}>
        <torusGeometry args={[0.46, 0.035, 8, 28]} />
        <meshBasicMaterial color="#94a3b8" transparent opacity={0.72} depthWrite={false} />
      </mesh>
      {POD_WINDOW_X_OFFSETS.map((x) => (
        <mesh key={`drop-pod-window-${x}`} position={[x, 0.56, -1.1]}>
          <boxGeometry args={[0.24, 0.2, 0.045]} />
          <meshStandardMaterial
            color="#a5f3fc"
            emissive="#22d3ee"
            emissiveIntensity={0.52}
            metalness={0.16}
            roughness={0.16}
          />
        </mesh>
      ))}
      {POD_RCS_PORTS.map((port) => (
        <group key={`drop-pod-rcs-${port.key}`} position={port.position} rotation={port.rotation}>
          <mesh castShadow>
            <cylinderGeometry args={[0.1, 0.14, 0.22, 12]} />
            <meshStandardMaterial color="#111827" metalness={0.68} roughness={0.24} />
          </mesh>
          <mesh position={[0, 0.13, 0]}>
            <sphereGeometry args={[0.045, 8, 8]} />
            <meshBasicMaterial color="#67e8f9" transparent opacity={0.78} depthWrite={false} />
          </mesh>
        </group>
      ))}
      <mesh position={[0.72, -0.72, 0]} rotation={[0, 0, 0.46]} castShadow>
        <boxGeometry args={[0.24, 0.86, 0.12]} />
        <meshStandardMaterial color="#7b8798" metalness={0.5} roughness={0.38} />
      </mesh>
      <mesh position={[-0.72, -0.72, 0]} rotation={[0, 0, -0.46]} castShadow>
        <boxGeometry args={[0.24, 0.86, 0.12]} />
        <meshStandardMaterial color="#7b8798" metalness={0.5} roughness={0.38} />
      </mesh>
      <mesh position={[0, -0.72, 0.72]} rotation={[0.46, 0, 0]} castShadow>
        <boxGeometry args={[0.12, 0.86, 0.24]} />
        <meshStandardMaterial color="#7b8798" metalness={0.5} roughness={0.38} />
      </mesh>
      <mesh position={[0, -0.72, -0.72]} rotation={[-0.46, 0, 0]} castShadow>
        <boxGeometry args={[0.12, 0.86, 0.24]} />
        <meshStandardMaterial color="#7b8798" metalness={0.5} roughness={0.38} />
      </mesh>
      {snapshot.status === 'dropping' ? (
        <>
          <pointLight position={[0, -1.78, 0]} color="#ffb347" intensity={30} distance={12} decay={2} />
          <mesh position={[0, -1.74, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.34, 0.055, 8, 18]} />
            <meshBasicMaterial color="#f97316" transparent opacity={0.78} depthWrite={false} />
          </mesh>
          <mesh position={[0, -2.12, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.4, 1.62, 18]} />
            <meshBasicMaterial color="#ffb347" transparent opacity={0.62} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
          <mesh position={[0, -2.42, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.24, 2.05, 18]} />
            <meshBasicMaterial color="#67e8f9" transparent opacity={0.28} depthWrite={false} blending={THREE.AdditiveBlending} />
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
