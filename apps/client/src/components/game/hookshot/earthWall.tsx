import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, type EarthWallData } from '../../../store/gameStore';
import { checkGroundWithNormal, isPhysicsReady } from '../../../hooks/usePhysics';
import { 
  SHARED_GEOMETRIES, 
  EARTH_COLORS,
} from '../effectResources';

// ============================================================================
// EARTH WALL - Hook slides on ground, wall of dirt rises behind (E ability)
// ============================================================================

const EARTH_WALL_SPEED = 35; // Units per second
const EARTH_WALL_SEGMENT_SPACING = 1.5; // Distance between wall segments
const EARTH_WALL_MAX_HEIGHT = 4; // Maximum wall height
const EARTH_WALL_WIDTH = 2.5; // Wall width
const EARTH_WALL_RISE_SPEED = 8; // How fast segments rise

// Single dirt/rock wall segment
const WallSegment = React.memo(function WallSegment({
  position,
  targetHeight,
  creationTime,
  index,
  rotationY, // Rotation to face perpendicular to travel direction
}: {
  position: { x: number; y: number; z: number };
  targetHeight: number;
  creationTime: number;
  index: number;
  rotationY: number;
}) {
  const meshRef = useRef<THREE.Group>(null);
  const currentHeightRef = useRef(0.1); // Start with small height so it renders
  
  // Vary colors and shapes based on index for natural look
  const colorVariation = (index % 3);
  const mainColor = colorVariation === 0 ? EARTH_COLORS.dirt : 
                    colorVariation === 1 ? EARTH_COLORS.dirtDark : EARTH_COLORS.dirtLight;
  
  useFrame((_, delta) => {
    if (!meshRef.current) return;
    
    // Rise up from ground
    if (currentHeightRef.current < targetHeight) {
      currentHeightRef.current = Math.min(
        currentHeightRef.current + EARTH_WALL_RISE_SPEED * delta, 
        targetHeight
      );
    }
    
    const h = currentHeightRef.current;
    
    // Update position - wall rises from ground
    meshRef.current.position.set(position.x, position.y + h / 2, position.z);
    meshRef.current.scale.set(1, Math.max(0.01, h), 1);
  });
  
  return (
    <group ref={meshRef} position={[position.x, position.y, position.z]} rotation={[0, rotationY, 0]}>
      {/* Main dirt block - wide to block vision */}
      <mesh geometry={SHARED_GEOMETRIES.box} scale={[EARTH_WALL_WIDTH, 1, 1]}>
        <meshStandardMaterial 
          color={mainColor} 
          roughness={0.9} 
          metalness={0.1}
        />
      </mesh>
      
      {/* Rock chunks embedded in dirt */}
      <mesh 
        position={[0.4 * (index % 2 === 0 ? 1 : -1), 0.2, 0.35]} 
        geometry={SHARED_GEOMETRIES.box} 
        scale={[0.4, 0.3, 0.3]}
        rotation={[0.2, 0.3, 0.1]}
      >
        <meshStandardMaterial color={EARTH_COLORS.rock} roughness={0.95} metalness={0.05} />
      </mesh>
      
      <mesh 
        position={[-0.3 * (index % 2 === 0 ? 1 : -1), -0.15, 0.3]} 
        geometry={SHARED_GEOMETRIES.box} 
        scale={[0.35, 0.25, 0.25]}
        rotation={[0.1, -0.2, 0.15]}
      >
        <meshStandardMaterial color={EARTH_COLORS.rock} roughness={0.95} metalness={0.05} />
      </mesh>
      
      {/* Back side rock */}
      <mesh 
        position={[0.2 * (index % 2 === 0 ? -1 : 1), 0, -0.35]} 
        geometry={SHARED_GEOMETRIES.box} 
        scale={[0.3, 0.35, 0.25]}
        rotation={[-0.1, 0.2, 0.1]}
      >
        <meshStandardMaterial color={EARTH_COLORS.rock} roughness={0.95} metalness={0.05} />
      </mesh>
      
      {/* Top grass/soil texture */}
      <mesh 
        position={[0, 0.51, 0]} 
        geometry={SHARED_GEOMETRIES.box} 
        scale={[EARTH_WALL_WIDTH * 0.95, 0.1, 0.9]}
      >
        <meshStandardMaterial color={EARTH_COLORS.grass} roughness={1} metalness={0} />
      </mesh>
      
      {/* Dirt debris around base - front */}
      {[0, 1, 2].map((i) => (
        <mesh 
          key={`front-${i}`}
          position={[
            (i - 1) * 0.7 + Math.sin(index + i) * 0.2, 
            -0.45, 
            0.6 + Math.cos(index + i) * 0.15
          ]} 
          geometry={SHARED_GEOMETRIES.sphere8} 
          scale={[0.2, 0.12, 0.2]}
        >
          <meshStandardMaterial color={EARTH_COLORS.dirtDark} roughness={1} metalness={0} />
        </mesh>
      ))}
      
      {/* Dirt debris around base - back */}
      {[0, 1].map((i) => (
        <mesh 
          key={`back-${i}`}
          position={[
            (i - 0.5) * 0.8, 
            -0.45, 
            -0.55 + Math.sin(index + i) * 0.1
          ]} 
          geometry={SHARED_GEOMETRIES.sphere8} 
          scale={[0.18, 0.1, 0.18]}
        >
          <meshStandardMaterial color={EARTH_COLORS.dirtDark} roughness={1} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}, (prev, next) => {
  // Custom comparison: only re-render if index or position changes
  return prev.index === next.index &&
         prev.position.x === next.position.x &&
         prev.position.y === next.position.y &&
         prev.position.z === next.position.z;
});

interface EarthWallProps {
  wall: EarthWallData;
}

export const EarthWallEffect = React.memo(({ wall }: EarthWallProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const hookRef = useRef<THREE.Group>(null);
  
  const hookProgressRef = useRef(0);
  const lastSegmentDistRef = useRef(0);
  const hookGroundYRef = useRef(wall.startPosition.y); // Track hook's ground level

  // Use ref for wall segments to avoid setState in useFrame (prevents 60fps re-renders)
  const wallSegmentsRef = useRef<{ x: number; y: number; z: number; height: number; time: number }[]>([]);

  // Version counter to trigger re-renders when segments change (incremented only when segments added)
  const [segmentsVersion, setSegmentsVersion] = useState(0);

  const removeEarthWall = useGameStore(state => state.removeEarthWall);
  
  useFrame((state, delta) => {
    if (!groupRef.current || !hookRef.current) return;
    
    const time = state.clock.elapsedTime;
    const elapsed = (Date.now() - wall.startTime) / 1000;
    
    // Check if wall should be removed (duration expired)
    if (elapsed > wall.duration + 2) {
      removeEarthWall(wall.id);
      return;
    }
    
    // Calculate current hook XZ position (travels horizontally)
    const currentDist = Math.min(hookProgressRef.current, wall.maxDistance);
    const hookX = wall.startPosition.x + wall.direction.x * currentDist;
    const hookZ = wall.startPosition.z + wall.direction.z * currentDist;
    
    // Raycast to find ground level at hook position
    if (isPhysicsReady()) {
      const groundCheck = checkGroundWithNormal(hookX, wall.startPosition.y + 50, hookZ, 100);
      if (groundCheck) {
        hookGroundYRef.current = groundCheck.groundY;
      }
    }
    
    const hookPos = {
      x: hookX,
      y: hookGroundYRef.current,
      z: hookZ,
    };
    
    // Hook is still traveling
    if (hookProgressRef.current < wall.maxDistance) {
      hookProgressRef.current += EARTH_WALL_SPEED * delta;
      
      // Create new wall segments behind the hook
      if (currentDist - lastSegmentDistRef.current >= EARTH_WALL_SEGMENT_SPACING && currentDist > 1) {
        lastSegmentDistRef.current = currentDist;
        
        // Calculate segment XZ position (slightly behind hook head)
        const segmentX = hookPos.x - wall.direction.x * 1.5;
        const segmentZ = hookPos.z - wall.direction.z * 1.5;
        
        // Raycast to find ground level at segment position
        let segmentGroundY = hookGroundYRef.current;
        if (isPhysicsReady()) {
          const segmentGroundCheck = checkGroundWithNormal(segmentX, wall.startPosition.y + 50, segmentZ, 100);
          if (segmentGroundCheck) {
            segmentGroundY = segmentGroundCheck.groundY;
          }
        }
        
        // Vary height slightly for natural look
        const heightVariation = 0.8 + Math.random() * 0.4;

        // Add new segment directly to ref (no setState in useFrame - prevents 60fps re-renders)
        wallSegmentsRef.current.push({
          x: segmentX,
          y: segmentGroundY,
          z: segmentZ,
          height: EARTH_WALL_MAX_HEIGHT * heightVariation,
          time: Date.now(),
        });

        // Trigger re-render by incrementing version (only when segment added, not every frame)
        setSegmentsVersion(v => v + 1);
      }
      
      // Update hook visual - position on ground
      hookRef.current.visible = true;
      hookRef.current.position.set(hookPos.x, hookPos.y + 0.5, hookPos.z);
      
      // Rotate hook to face direction of travel
      const angle = Math.atan2(wall.direction.x, wall.direction.z);
      hookRef.current.rotation.y = angle;
      
      // Bob the hook slightly as it travels
      hookRef.current.position.y += Math.sin(time * 15) * 0.1;
    } else {
      // Hook reached max distance - hide it
      hookRef.current.visible = false;
    }
  });
  
  return (
    <group ref={groupRef}>
      {/* THE GROUND HOOK - Large industrial hook that plows through ground */}
      <group ref={hookRef} position={[wall.startPosition.x, wall.startPosition.y + 0.5, wall.startPosition.z]}>
        {/* Main hook body - large and heavy */}
        <mesh geometry={SHARED_GEOMETRIES.box} scale={[0.8, 0.6, 1.5]}>
          <meshStandardMaterial color={EARTH_COLORS.hookMetal} metalness={0.85} roughness={0.3} />
        </mesh>
        
        {/* Plow blade at front */}
        <mesh position={[0, -0.1, -0.9]} rotation={[0.3, 0, 0]} geometry={SHARED_GEOMETRIES.box} scale={[1.2, 0.1, 0.5]}>
          <meshStandardMaterial color={0x555555} metalness={0.9} roughness={0.2} />
        </mesh>
        
        {/* Hook arm - curved down into ground */}
        <mesh position={[0, -0.2, -0.5]} rotation={[-0.5, 0, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.15, 0.8, 0.15]}>
          <meshStandardMaterial color={EARTH_COLORS.hookMetal} metalness={0.85} roughness={0.3} />
        </mesh>
        
        {/* Hook tip - buried in ground */}
        <mesh position={[0, -0.6, -0.2]} rotation={[-1.2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.2, 0.4, 0.2]}>
          <meshStandardMaterial color={0x888888} metalness={0.9} roughness={0.2} />
        </mesh>
        
        {/* Side fins for stability */}
        <mesh position={[0.5, 0, 0]} rotation={[0, 0, 0.3]} geometry={SHARED_GEOMETRIES.box} scale={[0.1, 0.4, 0.8]}>
          <meshStandardMaterial color={0x444444} metalness={0.8} roughness={0.35} />
        </mesh>
        <mesh position={[-0.5, 0, 0]} rotation={[0, 0, -0.3]} geometry={SHARED_GEOMETRIES.box} scale={[0.1, 0.4, 0.8]}>
          <meshStandardMaterial color={0x444444} metalness={0.8} roughness={0.35} />
        </mesh>
        
        {/* Orange energy glow */}
        <mesh geometry={SHARED_GEOMETRIES.sphere12} scale={0.4}>
          <meshBasicMaterial color={EARTH_COLORS.hookGlow} transparent opacity={0.5} />
        </mesh>
        
        {/* Dirt spray particles effect */}
        <pointLight color={EARTH_COLORS.hookGlow} intensity={4} distance={5} decay={2} />
        
        {/* Ground disturbance - ring of dirt being pushed up */}
        <mesh position={[0, -0.4, -0.3]} rotation={[-Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.ring24} scale={[1, 1, 0.3]}>
          <meshBasicMaterial color={EARTH_COLORS.dirt} transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
      </group>
      
      {/* WALL SEGMENTS - Rising dirt walls perpendicular to travel direction */}
      {wallSegmentsRef.current.map((segment, i) => (
        <WallSegment
          key={`${wall.id}_seg_${i}_${segmentsVersion}`} // Include version to trigger re-render on add
          position={segment}
          targetHeight={segment.height}
          creationTime={segment.time}
          index={i}
          rotationY={Math.atan2(wall.direction.x, wall.direction.z) + Math.PI / 2} // Perpendicular to travel
        />
      ))}
    </group>
  );
}, (prev, next) => {
  // Custom comparison: only re-render if wall.id or startTime changes
  return prev.wall.id === next.wall.id && prev.wall.startTime === next.wall.startTime;
});

