import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore, type SwingLineData } from '../../../store/gameStore';
import {
  SHARED_GEOMETRIES,
  HOOKSHOT_COLORS,
} from '../effectResources';

// ============================================================================
// SWING LINE - Kept for backwards compatibility but now unused for Hookshot E
// ============================================================================

interface SwingLineProps {
  line: SwingLineData;
}

export function SwingLineEffect({ line }: SwingLineProps) {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);

  const hookExtensionRef = useRef(0);
  const hasReachedRef = useRef(false);
  const frameCount = useRef(0);

  // Use ref for rope points to avoid setState in useFrame (prevents 60fps re-renders)
  const ropePointsRef = useRef<[[number, number, number], [number, number, number]]>([
    [line.startPosition.x, line.startPosition.y, line.startPosition.z],
    [line.startPosition.x, line.startPosition.y, line.startPosition.z]
  ]);

  // Version counter to trigger re-renders when rope points change significantly
  const [ropeVersion, setRopeVersion] = useState(0);

  const removeSwingLine = useGameStore(state => state.removeSwingLine);
  const updateSwingLine = useGameStore(state => state.updateSwingLine);
  
  useFrame((_, delta) => {
    frameCount.current++;
    
    if (!groupRef.current || !hookRef.current) return;
    
    const { localPlayer, players } = useGameStore.getState();
    
    let playerPos = line.startPosition;
    
    if (localPlayer && line.ownerId === localPlayer.id) {
      playerPos = {
        x: localPlayer.position.x,
        y: localPlayer.position.y + 0.6,
        z: localPlayer.position.z,
      };
    } else {
      const owner = players.get(line.ownerId);
      if (owner) {
        playerPos = {
          x: owner.position.x,
          y: owner.position.y + 0.6,
          z: owner.position.z,
        };
      }
    }
    
    const toTarget = {
      x: line.attachPoint.x - playerPos.x,
      y: line.attachPoint.y - playerPos.y,
      z: line.attachPoint.z - playerPos.z,
    };
    const totalDist = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2);
    const dirX = totalDist > 0 ? toTarget.x / totalDist : 0;
    const dirY = totalDist > 0 ? toTarget.y / totalDist : 0;
    const dirZ = totalDist > 0 ? toTarget.z / totalDist : 0;
    
    let hookPos = { x: playerPos.x, y: playerPos.y, z: playerPos.z };
    
    if (line.state === 'extending' && !hasReachedRef.current) {
      const speed = 90 * delta;
      hookExtensionRef.current += speed;
      
      const initialDist = Math.sqrt(
        (line.attachPoint.x - line.startPosition.x) ** 2 +
        (line.attachPoint.y - line.startPosition.y) ** 2 +
        (line.attachPoint.z - line.startPosition.z) ** 2
      );
      
      if (hookExtensionRef.current >= initialDist) {
        hasReachedRef.current = true;
        hookPos = { ...line.attachPoint };
        updateSwingLine(line.id, { state: 'attached' });
      } else {
        hookPos = {
          x: playerPos.x + dirX * hookExtensionRef.current,
          y: playerPos.y + dirY * hookExtensionRef.current,
          z: playerPos.z + dirZ * hookExtensionRef.current,
        };
      }
    } else if (line.state === 'attached' || line.state === 'swinging') {
      hasReachedRef.current = true;
      hookPos = { ...line.attachPoint };
    } else if (line.state === 'done') {
      removeSwingLine(line.id);
      return;
    }
    
    const elapsed = (Date.now() - line.startTime) / 1000;
    if (elapsed > line.duration + 1) {
      removeSwingLine(line.id);
      return;
    }
    
    hookRef.current.position.set(hookPos.x, hookPos.y, hookPos.z);

    if (totalDist > 0.01) {
      const quat = new THREE.Quaternion();
      quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(dirX, dirY, dirZ));
      hookRef.current.quaternion.copy(quat);
    }

    // Update rope points directly via ref (no setState in useFrame - prevents 60fps re-renders)
    const newPoints: [[number, number, number], [number, number, number]] = [
      [playerPos.x, playerPos.y, playerPos.z],
      [hookPos.x, hookPos.y, hookPos.z]
    ];

    // Only trigger re-render if rope state changed (extending vs attached)
    const oldPoints = ropePointsRef.current;
    const stateChanged =
      (line.state === 'extending' && !hasReachedRef.current) ||
      (line.state !== 'extending' && hasReachedRef.current);

    ropePointsRef.current = newPoints;

    if (stateChanged && frameCount.current % 10 === 0) {
      // Throttle re-renders during state transitions
      setRopeVersion(v => v + 1);
    }
  });
  
  if (!line.isActive && line.state === 'done') return null;
  
  return (
    <group ref={groupRef}>
      <group ref={hookRef} position={[line.startPosition.x, line.startPosition.y, line.startPosition.z]}>
        <mesh position={[0, 0, 0.35]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.2, 0.2, 0.08]}>
          <meshStandardMaterial color={0x888888} metalness={0.9} roughness={0.2} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.08, 0.8, 0.08]}>
          <meshStandardMaterial color={0x666666} metalness={0.85} roughness={0.25} />
        </mesh>
        <mesh position={[0, 0, -0.45]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.1, 0.15, 0.1]}>
          <meshStandardMaterial color={0xcccccc} metalness={0.95} roughness={0.1} />
        </mesh>
        <pointLight color={0xffffff} intensity={2} distance={4} decay={2} />
      </group>

      <Line points={ropePointsRef.current} color={HOOKSHOT_COLORS.energy} lineWidth={8} transparent opacity={1} />
      <Line points={ropePointsRef.current} color={HOOKSHOT_COLORS.energyGlow} lineWidth={16} transparent opacity={0.4} />
      <Line points={ropePointsRef.current} color={0xffffff} lineWidth={3} transparent opacity={0.8} />
    </group>
  );
}

