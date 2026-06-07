import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore, type SwingLineData } from '../../../store/gameStore';
import { writeOwnerVisualPosition } from './ownerPosition';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';
import {
  SHARED_GEOMETRIES,
  HOOKSHOT_COLORS,
  getHookshotMaterials,
  TEMP_VECTORS,
} from '../effectResources';

// ============================================================================
// SWING LINE - Kept for backwards compatibility but now unused for Hookshot E
// ============================================================================

interface SwingLineProps {
  line: SwingLineData;
}

const getHookMaterials = () => getHookshotMaterials();

export const SwingLineEffect = React.memo(({ line }: SwingLineProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);

  const hookExtensionRef = useRef(0);
  const hasReachedRef = useRef(false);
  const frameCount = useRef(0);
  const ownerVisualPositionRef = useRef({ x: line.startPosition.x, y: line.startPosition.y, z: line.startPosition.z });
  const hookPosRef = useRef({ x: line.startPosition.x, y: line.startPosition.y, z: line.startPosition.z });
  const startFrameTimeRef = useRef(getFrameClock().nowMs - Math.max(0, Date.now() - line.startTime));
  const initialDistanceRef = useRef(Math.sqrt(
    (line.attachPoint.x - line.startPosition.x) ** 2 +
    (line.attachPoint.y - line.startPosition.y) ** 2 +
    (line.attachPoint.z - line.startPosition.z) ** 2
  ));

  // Use ref for rope points to avoid setState in useFrame (prevents 60fps re-renders)
  const ropePointsRef = useRef<[[number, number, number], [number, number, number]]>([
    [line.startPosition.x, line.startPosition.y, line.startPosition.z],
    [line.startPosition.x, line.startPosition.y, line.startPosition.z]
  ]);

  // Version counter to trigger re-renders when rope points change significantly
  const [, setRopeVersion] = useState(0);
  const HOOK_MATERIALS = getHookMaterials();

  const removeSwingLine = useGameStore(state => state.removeSwingLine);
  const updateSwingLine = useGameStore(state => state.updateSwingLine);
  
  useFrame((_, delta) => {
    frameCount.current++;
    
    if (!groupRef.current || !hookRef.current) return;
    const frameNow = getFrameClock().nowMs;
    
    const { localPlayer, players } = useGameStore.getState();
    
    const playerPos = writeOwnerVisualPosition(ownerVisualPositionRef.current, line.ownerId, 0.6, line.startPosition, players, localPlayer);
    
    const toTargetX = line.attachPoint.x - playerPos.x;
    const toTargetY = line.attachPoint.y - playerPos.y;
    const toTargetZ = line.attachPoint.z - playerPos.z;
    const totalDist = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY + toTargetZ * toTargetZ);
    const dirX = totalDist > 0 ? toTargetX / totalDist : 0;
    const dirY = totalDist > 0 ? toTargetY / totalDist : 0;
    const dirZ = totalDist > 0 ? toTargetZ / totalDist : 0;
    
    const hookPos = hookPosRef.current;
    hookPos.x = playerPos.x;
    hookPos.y = playerPos.y;
    hookPos.z = playerPos.z;
    
    if (line.state === 'extending' && !hasReachedRef.current) {
      const speed = 90 * delta;
      hookExtensionRef.current += speed;
      
      if (hookExtensionRef.current >= initialDistanceRef.current) {
        hasReachedRef.current = true;
        hookPos.x = line.attachPoint.x;
        hookPos.y = line.attachPoint.y;
        hookPos.z = line.attachPoint.z;
        updateSwingLine(line.id, { state: 'attached' });
      } else {
        hookPos.x = playerPos.x + dirX * hookExtensionRef.current;
        hookPos.y = playerPos.y + dirY * hookExtensionRef.current;
        hookPos.z = playerPos.z + dirZ * hookExtensionRef.current;
      }
    } else if (line.state === 'attached' || line.state === 'swinging') {
      hasReachedRef.current = true;
      hookPos.x = line.attachPoint.x;
      hookPos.y = line.attachPoint.y;
      hookPos.z = line.attachPoint.z;
    } else if (line.state === 'done') {
      removeSwingLine(line.id);
      return;
    }
    
    const elapsed = (frameNow - startFrameTimeRef.current) / 1000;
    if (elapsed > line.duration + 1) {
      removeSwingLine(line.id);
      return;
    }
    
    hookRef.current.position.set(hookPos.x, hookPos.y, hookPos.z);

    if (totalDist > 0.01) {
      TEMP_VECTORS.v1.set(dirX, dirY, dirZ);
      TEMP_VECTORS.quat1.setFromUnitVectors(TEMP_VECTORS.forward, TEMP_VECTORS.v1);
      hookRef.current.quaternion.copy(TEMP_VECTORS.quat1);
    }

    // Only trigger re-render if rope state changed (extending vs attached)
    const stateChanged =
      (line.state === 'extending' && !hasReachedRef.current) ||
      (line.state !== 'extending' && hasReachedRef.current);

    const ropePoints = ropePointsRef.current;
    ropePoints[0][0] = playerPos.x;
    ropePoints[0][1] = playerPos.y;
    ropePoints[0][2] = playerPos.z;
    ropePoints[1][0] = hookPos.x;
    ropePoints[1][1] = hookPos.y;
    ropePoints[1][2] = hookPos.z;

    if (stateChanged && frameCount.current % 10 === 0) {
      // Throttle re-renders during state transitions
      setRopeVersion(v => v + 1);
    }
  });
  
  if (!line.isActive && line.state === 'done') return null;
  
  return (
    <group ref={groupRef}>
      <group ref={hookRef} position={[line.startPosition.x, line.startPosition.y, line.startPosition.z]}>
        <mesh position={[0, 0, 0.35]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.2, 0.2, 0.08]} material={HOOK_MATERIALS.ring} />
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.08, 0.8, 0.08]} material={HOOK_MATERIALS.shaft} />
        <mesh position={[0, 0, -0.45]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.1, 0.15, 0.1]} material={HOOK_MATERIALS.tip} />
        <BudgetedPointLight budgetPriority={2} color={0xffffff} intensity={2} distance={4} decay={2} />
      </group>

      <Line points={ropePointsRef.current} color={HOOKSHOT_COLORS.energy} lineWidth={8} transparent opacity={1} />
      <Line points={ropePointsRef.current} color={HOOKSHOT_COLORS.energyGlow} lineWidth={16} transparent opacity={0.4} />
      <Line points={ropePointsRef.current} color={0xffffff} lineWidth={3} transparent opacity={0.8} />
    </group>
  );
}, (prev, next) => {
  // Custom comparison: only re-render if line.id or state changes
  return prev.line.id === next.line.id && prev.line.state === next.line.state;
});
