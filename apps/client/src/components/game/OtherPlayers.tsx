import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import { visualStore } from '../../store/visualStore';
import { useShallow } from 'zustand/shallow';
import { HERO_DEFINITIONS } from '@voxel-strike/shared';
import type { Player, Team } from '@voxel-strike/shared';

// Debug: track last logged state to avoid spam
let lastLoggedPlayerCount = -1;
let lastLoggedOtherCount = -1;

export function OtherPlayers() {
  const { players, playerId, gamePhase } = useGameStore(
    useShallow(state => ({
      players: state.players,
      playerId: state.playerId,
      gamePhase: state.gamePhase,
    }))
  );

  const allPlayers = Array.from(players.values());

  // Filter out local player, show all other players except dead ones (unless in respawn view)
  const otherPlayers = allPlayers.filter((p) => {
    if (p.id === playerId) return false;
    // Hide only dead players during active gameplay
    if (p.state === 'dead' && (gamePhase === 'playing' || gamePhase === 'countdown')) {
      return false;
    }
    // Show all other players in lobby, hero select, and during gameplay
    return true;
  });

  // Only log when counts change
  if (players.size !== lastLoggedPlayerCount || otherPlayers.length !== lastLoggedOtherCount) {
    console.log('OtherPlayers:', {
      totalInStore: players.size,
      otherPlayersToRender: otherPlayers.length,
      playerId,
      gamePhase,
      allPlayerIds: allPlayers.map(p => `${p.id.slice(0,6)}(${p.state})`),
      otherPlayerPositions: otherPlayers.map(p => ({ 
        id: p.id.slice(0,6), 
        pos: `(${p.position.x.toFixed(1)}, ${p.position.y.toFixed(1)}, ${p.position.z.toFixed(1)})` 
      })),
    });
    lastLoggedPlayerCount = players.size;
    lastLoggedOtherCount = otherPlayers.length;
  }

  return (
    <group>
      {otherPlayers.map((player) => (
        <OtherPlayer key={player.id} player={player} />
      ))}
    </group>
  );
}

interface OtherPlayerProps {
  player: Player;
}

function OtherPlayer({ player }: OtherPlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const targetPosition = useRef(new THREE.Vector3(player.position.x, player.position.y, player.position.z));
  const currentPosition = useRef(new THREE.Vector3(player.position.x, player.position.y, player.position.z));
  const initializedRef = useRef(false);
  const hasLoggedRef = useRef(false);
  
  // Debug log once when component first renders
  if (!hasLoggedRef.current) {
    console.log('OtherPlayer mounted:', player.id.slice(0,6), player.name, 'at', player.position);
    hasLoggedRef.current = true;
  }

  // VISUAL_STORE_VERIFICATION: This component reads visualStore.getState() in useFrame.
  // Verify with React DevTools profiler that OtherPlayers does NOT re-render when player positions update at 60fps.
  // Expected: OtherPlayers renders only when players Map changes (add/remove), not on position updates.
  useFrame((_, delta) => {
    if (!groupRef.current) return;

    // Initialize position on first frame
    if (!initializedRef.current) {
      const visualState = visualStore.getState();
      const initialPos = visualState.playerPositions.get(player.id);
      currentPosition.current.set(
        initialPos?.x ?? player.position.x,
        initialPos?.y ?? player.position.y,
        initialPos?.z ?? player.position.z
      );
      groupRef.current.position.copy(currentPosition.current);
      initializedRef.current = true;
    }

    // Read from visualStore non-reactively (no re-renders)
    const visualState = visualStore.getState();
    const targetPos = visualState.playerPositions.get(player.id);
    if (targetPos) {
      targetPosition.current.set(targetPos.x, targetPos.y, targetPos.z);
    } else {
      // Fallback to prop position if visualStore doesn't have data yet
      targetPosition.current.set(player.position.x, player.position.y, player.position.z);
    }

    // Lerp current position toward target
    currentPosition.current.lerp(targetPosition.current, Math.min(1, delta * 15));
    groupRef.current.position.copy(currentPosition.current);

    // Read rotation from visualStore non-reactively
    const targetRot = visualState.playerRotations.get(player.id);
    if (targetRot !== undefined) {
      groupRef.current.rotation.y = targetRot;
    } else {
      // Fallback to prop rotation if visualStore doesn't have data yet
      groupRef.current.rotation.y = player.lookYaw;
    }
  });

  const heroStats = player.heroId ? HERO_DEFINITIONS[player.heroId].stats : null;
  const playerHeight = heroStats?.size.height ?? 1.8;
  const playerWidth = heroStats?.size.width ?? 0.8;

  return (
    <group ref={groupRef}>
      {/* Player body */}
      <PlayerModel 
        team={player.team} 
        height={playerHeight}
        width={playerWidth}
      />

      {/* Nameplate */}
      <Nameplate 
        name={player.name} 
        team={player.team}
        health={player.health}
        maxHealth={player.maxHealth}
        height={playerHeight}
      />

      {/* Flag indicator */}
      {player.hasFlag && (
        <FlagCarrierIndicator team={player.team === 'red' ? 'blue' : 'red'} />
      )}
    </group>
  );
}

interface PlayerModelProps {
  team: Team;
  height: number;
  width: number;
}

const PlayerModel = ({ team, height, width }: PlayerModelProps) => {
  const teamColor = team === 'red' ? '#ff4444' : '#4444ff';

  return (
    <group>
      {/* Body (blocky Minecraft style) */}
      <mesh position={[0, height / 2 - 0.3, 0]} castShadow>
        <boxGeometry args={[width * 0.8, height * 0.5, width * 0.4]} />
        <meshStandardMaterial color={teamColor} roughness={0.8} />
      </mesh>

      {/* Head */}
      <mesh position={[0, height - 0.25, 0]} castShadow>
        <boxGeometry args={[width * 0.5, width * 0.5, width * 0.5]} />
        <meshStandardMaterial color="#ddc8a0" roughness={0.9} />
      </mesh>

      {/* Arms */}
      <mesh position={[-width * 0.55, height / 2 - 0.1, 0]} castShadow>
        <boxGeometry args={[width * 0.25, height * 0.4, width * 0.25]} />
        <meshStandardMaterial color={teamColor} roughness={0.8} />
      </mesh>
      <mesh position={[width * 0.55, height / 2 - 0.1, 0]} castShadow>
        <boxGeometry args={[width * 0.25, height * 0.4, width * 0.25]} />
        <meshStandardMaterial color={teamColor} roughness={0.8} />
      </mesh>

      {/* Legs */}
      <mesh position={[-width * 0.2, 0.35, 0]} castShadow>
        <boxGeometry args={[width * 0.3, height * 0.4, width * 0.3]} />
        <meshStandardMaterial color="#333344" roughness={0.9} />
      </mesh>
      <mesh position={[width * 0.2, 0.35, 0]} castShadow>
        <boxGeometry args={[width * 0.3, height * 0.4, width * 0.3]} />
        <meshStandardMaterial color="#333344" roughness={0.9} />
      </mesh>

      {/* Hero emblem on chest */}
      <mesh position={[0, height / 2 - 0.2, width * 0.21]}>
        <planeGeometry args={[0.3, 0.3]} />
        <meshStandardMaterial 
          color="#ffffff" 
          emissive="#ffffff"
          emissiveIntensity={0.3}
        />
      </mesh>
    </group>
  );
};

interface NameplateProps {
  name: string;
  team: Team;
  health: number;
  maxHealth: number;
  height: number;
}

function Nameplate({ name, team, health, maxHealth, height }: NameplateProps) {
  const teamColor = team === 'red' ? '#ff4444' : '#4444ff';
  const healthPercent = health / maxHealth;

  return (
    <group position={[0, height + 0.5, 0]}>
      {/* Health bar background */}
      <mesh position={[0, 0.15, 0]}>
        <planeGeometry args={[1, 0.1]} />
        <meshBasicMaterial color="#1a1a1a" transparent opacity={0.8} />
      </mesh>

      {/* Health bar fill */}
      <mesh position={[(healthPercent - 1) * 0.5, 0.15, 0.001]}>
        <planeGeometry args={[healthPercent, 0.08]} />
        <meshBasicMaterial 
          color={healthPercent > 0.3 ? '#00ff88' : '#ff4444'} 
        />
      </mesh>

      {/* Name background */}
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[name.length * 0.12 + 0.2, 0.25]} />
        <meshBasicMaterial color={teamColor} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

interface FlagCarrierIndicatorProps {
  team: Team; // Team of the flag being carried
}

function FlagCarrierIndicator({ team }: FlagCarrierIndicatorProps) {
  const flagColor = team === 'red' ? '#ff4444' : '#4444ff';

  return (
    <group position={[0, 2.5, 0]}>
      {/* Flag pole */}
      <mesh position={[0, 0.3, -0.3]}>
        <cylinderGeometry args={[0.02, 0.02, 0.8]} />
        <meshStandardMaterial color="#888888" />
      </mesh>

      {/* Flag cloth */}
      <mesh position={[0.2, 0.5, -0.3]}>
        <planeGeometry args={[0.4, 0.3]} />
        <meshStandardMaterial 
          color={flagColor}
          emissive={flagColor}
          emissiveIntensity={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

