import { useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import { visualStore } from '../../store/visualStore';
import { useShallow } from 'zustand/shallow';
import { HERO_DEFINITIONS, PLAYER_CROUCH_HEIGHT, PLAYER_HEIGHT } from '@voxel-strike/shared';
import type { HeroId, Player, Team } from '@voxel-strike/shared';
import { HeroVoxelBody } from './HeroVoxelBody';
import { HeroIcon } from '../ui/HeroIcons';
import { HERO_COLORS as HERO_ICON_COLORS } from '../ui/hero-svgs/types';

// Debug: track last logged state to avoid spam
let lastLoggedPlayerCount = -1;
let lastLoggedOtherCount = -1;

export function OtherPlayers() {
  // NOTE: This component subscribes to gameStore.players but does NOT re-render on
  // position updates because updateGameState() updates Map entries in-place (same Map
  // reference). The Map reference only changes when players are added/removed. Position
  // interpolation reads from visualStore in useFrame (non-reactive, 60fps).
  const { players, playerId, localPlayerId, gamePhase } = useGameStore(
    useShallow(state => ({
      players: state.players,
      playerId: state.playerId,
      localPlayerId: state.localPlayer?.id ?? null,
      gamePhase: state.gamePhase,
    }))
  );

  const allPlayers = Array.from(players.values());

  // Filter out local player, show all other players except dead ones (unless in respawn view)
  const otherPlayers = allPlayers.filter((p) => {
    if (p.id === playerId || p.id === localPlayerId) return false;
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
      localPlayerId,
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

const PLAYER_CENTER_TO_FEET = PLAYER_HEIGHT / 2;
const CROUCH_HEIGHT_RATIO = PLAYER_CROUCH_HEIGHT / PLAYER_HEIGHT;

function setPlayerRenderOrigin(
  target: THREE.Vector3,
  position: { x: number; y: number; z: number }
): THREE.Vector3 {
  return target.set(position.x, position.y - PLAYER_CENTER_TO_FEET, position.z);
}

function OtherPlayer({ player }: OtherPlayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const heroStats = player.heroId ? HERO_DEFINITIONS[player.heroId].stats : null;
  const playerHeight = heroStats?.size.height ?? 1.8;
  const hasLoweredPosture = player.movement.isCrouching || player.movement.isSliding;
  const visibleHeight = hasLoweredPosture
    ? Math.max(PLAYER_CROUCH_HEIGHT, playerHeight * CROUCH_HEIGHT_RATIO)
    : playerHeight;
  const postureScaleY = visibleHeight / playerHeight;
  const targetPosition = useRef(setPlayerRenderOrigin(new THREE.Vector3(), player.position));
  const currentPosition = useRef(setPlayerRenderOrigin(new THREE.Vector3(), player.position));
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
      setPlayerRenderOrigin(currentPosition.current, initialPos ?? player.position);
      groupRef.current.position.copy(currentPosition.current);
      initializedRef.current = true;
    }

    // Read from visualStore non-reactively (no re-renders)
    const visualState = visualStore.getState();
    const targetPos = visualState.playerPositions.get(player.id);
    if (targetPos) {
      setPlayerRenderOrigin(targetPosition.current, targetPos);
    } else {
      // Fallback to prop position if visualStore doesn't have data yet
      setPlayerRenderOrigin(targetPosition.current, player.position);
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

  return (
    <group ref={groupRef}>
      {/* Player body */}
      <HeroVoxelBody
        heroId={player.heroId}
        team={player.team} 
        height={playerHeight}
        postureScaleY={postureScaleY}
        isBot={player.isBot}
        isMoving={Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z) > 0.5}
        hasFlag={player.hasFlag}
      />

      {/* Nameplate */}
      <Nameplate 
        heroId={player.heroId}
        name={player.name} 
        team={player.team}
        health={player.health}
        maxHealth={player.maxHealth}
        height={visibleHeight}
      />

      <PlayerVisibilityBeacon team={player.team} height={visibleHeight} isBot={player.isBot} />

      {/* Flag indicator */}
      {player.hasFlag && (
        <FlagCarrierIndicator team={player.team === 'red' ? 'blue' : 'red'} />
      )}
    </group>
  );
}

interface NameplateProps {
  heroId: HeroId | null;
  name: string;
  team: Team;
  health: number;
  maxHealth: number;
  height: number;
}

function Nameplate({ heroId, name, team, health, maxHealth, height }: NameplateProps) {
  const groupRef = useRef<THREE.Group>(null);
  const parentWorldQuaternionRef = useRef(new THREE.Quaternion());
  const cameraWorldQuaternionRef = useRef(new THREE.Quaternion());
  const { camera } = useThree();
  const teamColor = team === 'red' ? '#ef4444' : '#4444ff';
  const healthPercent = Math.max(0, Math.min(1, health / Math.max(1, maxHealth)));
  const heroColor = heroId ? HERO_ICON_COLORS[heroId].primary : teamColor;
  const tagWidth = Math.max(112, Math.min(188, 58 + name.length * 7.2));

  useFrame(() => {
    if (!groupRef.current) return;
    camera.getWorldQuaternion(cameraWorldQuaternionRef.current);
    const parent = groupRef.current.parent;
    if (!parent) {
      groupRef.current.quaternion.copy(cameraWorldQuaternionRef.current);
      return;
    }

    parent.getWorldQuaternion(parentWorldQuaternionRef.current);
    groupRef.current.quaternion
      .copy(parentWorldQuaternionRef.current)
      .invert()
      .multiply(cameraWorldQuaternionRef.current);
  });

  return (
    <group ref={groupRef} position={[0, height + 0.5, 0]}>
      <Html
        center
        transform
        occlude="raycast"
        distanceFactor={8}
        zIndexRange={[30, 0]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div
          className="flex flex-col items-center"
          style={{
            width: `${tagWidth}px`,
          }}
        >
          <div className="flex h-5 max-w-full items-center gap-1.5">
            <div
              className="flex h-[17px] w-[17px] shrink-0 items-center justify-center"
              style={{
                color: heroColor,
                filter: `drop-shadow(0 0 4px ${heroColor}) drop-shadow(0 1px 2px rgba(0,0,0,0.9))`,
              }}
            >
              {heroId ? (
                <HeroIcon heroId={heroId} size={15} color={heroColor} />
              ) : (
                <div className="h-2 w-2 rotate-45 rounded-[1px]" style={{ background: teamColor }} />
              )}
            </div>
            <span
              className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-white"
              style={{
                textShadow: '0 1px 2px rgba(0,0,0,0.95), 0 0 5px rgba(0,0,0,0.9)',
              }}
            >
              {name}
            </span>
          </div>
          <div
            className="mt-0.5 h-[3px] w-full overflow-hidden rounded-full"
            style={{
              filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.9))',
            }}
          >
            <div
              className="h-full"
              style={{
                width: `${healthPercent * 100}%`,
                background: healthPercent > 0.3
                  ? 'linear-gradient(90deg, #22c55e, #86efac)'
                  : 'linear-gradient(90deg, #ef4444, #f97316)',
                boxShadow: healthPercent > 0.3
                  ? '0 0 5px rgba(34,197,94,0.75)'
                  : '0 0 5px rgba(239,68,68,0.75)',
              }}
            />
          </div>
        </div>
      </Html>
    </group>
  );
}

function PlayerVisibilityBeacon({ team, height, isBot }: { team: Team; height: number; isBot?: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const color = team === 'red' ? '#ef4444' : '#38bdf8';

  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y = state.clock.elapsedTime * 1.6;
  });

  return (
    <group ref={groupRef} position={[0, height + 0.18, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.42, 0.018, 6, 24]} />
        <meshBasicMaterial color={color} transparent opacity={isBot ? 0.95 : 0.75} />
      </mesh>
      <pointLight color={color} intensity={isBot ? 1.1 : 0.75} distance={4} />
    </group>
  );
}

interface FlagCarrierIndicatorProps {
  team: Team; // Team of the flag being carried
}

function FlagCarrierIndicator({ team }: FlagCarrierIndicatorProps) {
  const flagColor = team === 'red' ? '#ef4444' : '#4444ff';

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
