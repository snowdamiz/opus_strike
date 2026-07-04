import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTeamCatalogEntry, type MapPingSnapshot } from '@voxel-strike/shared';
import { useShallow } from 'zustand/shallow';
import { useGameStore } from '../../store/gameStore';

const PING_MARKER_LIFT = 0.14;
const PING_BEAM_HEIGHT = 2.2;
const PING_RING_RADIUS = 0.64;
const PING_DEFAULT_COLOR = '#facc15';

export function TeamPings() {
  const { localPlayer, mapPings } = useGameStore(
    useShallow((state) => ({
      localPlayer: state.localPlayer,
      mapPings: state.mapPings,
    }))
  );

  if (!localPlayer) return null;

  const now = Date.now();
  const pings = Array.from(mapPings.values()).filter((ping) => (
    ping.team === localPlayer.team && ping.expiresAt > now
  ));

  return (
    <>
      {pings.map((ping) => (
        <TeamPingMarker
          key={ping.id}
          ping={ping}
          isLocal={ping.playerId === localPlayer.id}
        />
      ))}
    </>
  );
}

function TeamPingMarker({ ping, isLocal }: { ping: MapPingSnapshot; isLocal: boolean }) {
  const groupRef = useRef<THREE.Group | null>(null);
  const teamColor = getTeamCatalogEntry(ping.team)?.accentColor ?? PING_DEFAULT_COLOR;
  const color = isLocal ? PING_DEFAULT_COLOR : teamColor;

  useFrame(({ clock, camera }) => {
    const group = groupRef.current;
    if (!group) return;

    const now = Date.now();
    const active = ping.expiresAt > now;
    group.visible = active;
    if (!active) return;

    const pulse = 1 + Math.sin(clock.elapsedTime * 5.6 + ping.sequence * 0.37) * 0.08;
    group.scale.setScalar(isLocal ? pulse * 1.08 : pulse);
    group.lookAt(camera.position.x, group.position.y, camera.position.z);
  });

  return (
    <group
      ref={groupRef}
      position={[ping.position.x, ping.position.y + PING_MARKER_LIFT, ping.position.z]}
      renderOrder={12}
    >
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[PING_RING_RADIUS, 0.035, 8, 36]} />
        <meshBasicMaterial color={color} transparent opacity={0.82} depthWrite={false} />
      </mesh>
      <mesh position={[0, PING_BEAM_HEIGHT * 0.5, 0]}>
        <cylinderGeometry args={[0.025, 0.025, PING_BEAM_HEIGHT, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.38} depthWrite={false} />
      </mesh>
      <mesh position={[0, PING_BEAM_HEIGHT + 0.28, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[0.24, 0.52, 4]} />
        <meshBasicMaterial color={color} transparent opacity={0.92} depthWrite={false} />
      </mesh>
    </group>
  );
}
