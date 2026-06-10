import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, type SwingLineData } from '../../../store/gameStore';
import { writeOwnerVisualPosition } from './ownerPosition';
import { getFrameClock } from '../../../utils/frameClock';
import {
  HOOKSHOT_COLORS,
  getHookshotMaterials,
  TEMP_VECTORS,
} from '../effectResources';
import { HookshotProjectileArrowHead } from './arrowHead';

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
  const ropeMainGeometryRef = useRef<THREE.BufferGeometry>(null);
  const ropeGlowGeometryRef = useRef<THREE.BufferGeometry>(null);
  const ropeCoreGeometryRef = useRef<THREE.BufferGeometry>(null);

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

  const ropePositions = useMemo(() => new Float32Array(6), []);
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

    ropePositions[0] = playerPos.x;
    ropePositions[1] = playerPos.y;
    ropePositions[2] = playerPos.z;
    ropePositions[3] = hookPos.x;
    ropePositions[4] = hookPos.y;
    ropePositions[5] = hookPos.z;

    for (const geometry of [ropeMainGeometryRef.current, ropeGlowGeometryRef.current, ropeCoreGeometryRef.current]) {
      if (!geometry) continue;
      const attribute = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!attribute) continue;
      (attribute.array as Float32Array).set(ropePositions);
      attribute.needsUpdate = true;
      geometry.computeBoundingSphere();
    }
  });

  useEffect(() => {
    return () => {
      ropeMainGeometryRef.current?.dispose();
      ropeGlowGeometryRef.current?.dispose();
      ropeCoreGeometryRef.current?.dispose();
    };
  }, []);
  
  if (!line.isActive && line.state === 'done') return null;
  
  return (
    <group ref={groupRef}>
      <group ref={hookRef} position={[line.startPosition.x, line.startPosition.y, line.startPosition.z]}>
        <HookshotProjectileArrowHead
          materials={{
            shaft: HOOK_MATERIALS.shaft,
            tip: HOOK_MATERIALS.tip,
            glow: HOOK_MATERIALS.glow,
            core: HOOK_MATERIALS.ropeCore,
            ring: HOOK_MATERIALS.ring,
          }}
          scale={1.05}
          lightPriority={2}
          lightIntensity={2.6}
          lightDistance={4}
        />
      </group>

      <line>
        <bufferGeometry ref={ropeMainGeometryRef}>
          <bufferAttribute attach="attributes-position" args={[ropePositions.slice(), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={HOOKSHOT_COLORS.energy} transparent opacity={1} />
      </line>
      <line>
        <bufferGeometry ref={ropeGlowGeometryRef}>
          <bufferAttribute attach="attributes-position" args={[ropePositions.slice(), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={HOOKSHOT_COLORS.energyGlow} transparent opacity={0.4} blending={THREE.AdditiveBlending} />
      </line>
      <line>
        <bufferGeometry ref={ropeCoreGeometryRef}>
          <bufferAttribute attach="attributes-position" args={[ropePositions.slice(), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={0xffffff} transparent opacity={0.8} />
      </line>
    </group>
  );
}, (prev, next) => {
  // Custom comparison: only re-render if line.id or state changes
  return prev.line.id === next.line.id && prev.line.state === next.line.state;
});
