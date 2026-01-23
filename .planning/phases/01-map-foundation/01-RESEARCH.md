# Phase 1: Map Foundation - Research

**Researched:** 2026-01-22
**Domain:** React Three Fiber Procedural Map Geometry with Sci-Fi Aesthetic
**Confidence:** HIGH

## Summary

Phase 1 establishes the playable arena foundation: removing the old imported GLB map and replacing it with procedurally-generated geometry that creates an asymmetrical CTF layout with three distinct routes. The user's decisions lock in a sci-fi/futuristic aesthetic with dark colors and glowing accents, floating platforms, terrain contrast between team sides (tech vs. natural), and hazard zones.

The core technical approach is straightforward: replace the `GLBMap` component with procedural Three.js geometry using React Three Fiber primitives (`BoxGeometry`, `PlaneGeometry`) combined with `@react-three/csg` for carved shapes. The existing physics integration pattern (loading trimesh colliders from geometry) can be adapted for procedural shapes. Glow effects use `MeshStandardMaterial` with emissive properties.

**Primary recommendation:** Build the map as a self-contained R3F component using primitive geometries (boxes, planes) with shared/reused materials. Create visual geometry first with simple collision-friendly shapes, then generate simplified Rapier colliders from the same geometry. Use Drei's `Grid` component for sci-fi floor aesthetics.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @react-three/fiber | 8.17.10 | React renderer for Three.js | Already in project, R3F is the standard for React+Three.js |
| three | 0.169.0 | 3D graphics engine | Already in project, provides all geometry primitives |
| @react-three/drei | 9.114.3 | Helper components for R3F | Already in project, provides Grid, Float, and other utilities |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @react-three/csg | ^3.2.0 | Constructive solid geometry | Carving holes, windows, combining shapes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Procedural geometry | Blender + GLB export | More visual control but slower iteration; procedural fits simple geometry |
| @react-three/csg | three-csg-ts | CSG is R3F-native with better ergonomics |
| Individual materials | Shared material instances | Must reuse materials for performance |

**Installation:**
```bash
pnpm add @react-three/csg --filter @voxel-strike/client
```

## Architecture Patterns

### Recommended Project Structure
```
apps/client/src/components/game/
├── maps/
│   ├── index.ts                    # Map registry/exports
│   └── sci-fi-ctf/
│       ├── SciFiCTFMap.tsx         # Main map component
│       ├── config.ts               # Spawn points, base positions, boundaries
│       ├── geometry/
│       │   ├── TeamABase.tsx       # Tech/platform aesthetic
│       │   ├── TeamBBase.tsx       # Natural/cave aesthetic
│       │   ├── CenterZone.tsx      # Mid-map area
│       │   ├── Routes.tsx          # Three connecting routes
│       │   └── Boundaries.tsx      # Perimeter walls
│       ├── materials.ts            # Shared materials (emissive, floor, etc.)
│       └── colliders/
│           └── MapColliders.tsx    # Physics collision geometry
├── VoxelWorld.tsx                  # Updated to use new map
└── ...
```

### Pattern 1: Reusable Materials
**What:** Define materials once, reuse across all geometry to minimize GPU overhead
**When to use:** Always for repeated materials across map geometry
**Example:**
```typescript
// materials.ts
import * as THREE from 'three';

// Dark base materials
export const floorMaterial = new THREE.MeshStandardMaterial({
  color: '#1a1a2e',
  metalness: 0.8,
  roughness: 0.3,
});

// Team A (red/orange accents)
export const teamAAccent = new THREE.MeshStandardMaterial({
  color: '#2a1a1a',
  emissive: '#ff4400',
  emissiveIntensity: 0.5,
  metalness: 0.9,
  roughness: 0.2,
});

// Team B (blue/cyan accents)
export const teamBAccent = new THREE.MeshStandardMaterial({
  color: '#1a1a2a',
  emissive: '#00ffff',
  emissiveIntensity: 0.5,
  metalness: 0.9,
  roughness: 0.2,
});

// Hazard zone
export const hazardMaterial = new THREE.MeshStandardMaterial({
  color: '#1a0a1a',
  emissive: '#ff00ff',
  emissiveIntensity: 0.8,
  metalness: 0.5,
  roughness: 0.5,
});
```

### Pattern 2: Declarative Geometry with Direct Mutations
**What:** Define geometry declaratively in JSX, animate via refs in useFrame
**When to use:** Floating platforms, animated elements
**Example:**
```typescript
// FloatingPlatform.tsx
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface FloatingPlatformProps {
  position: [number, number, number];
  size: [number, number, number];
  material: THREE.Material;
  floatSpeed?: number;
  floatHeight?: number;
}

export function FloatingPlatform({
  position,
  size,
  material,
  floatSpeed = 1,
  floatHeight = 0.3
}: FloatingPlatformProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const baseY = position[1];

  useFrame((state) => {
    if (meshRef.current) {
      // Floating animation - direct mutation, no React state
      meshRef.current.position.y = baseY + Math.sin(state.clock.elapsedTime * floatSpeed) * floatHeight;
    }
  });

  return (
    <mesh ref={meshRef} position={position} material={material}>
      <boxGeometry args={size} />
    </mesh>
  );
}
```

### Pattern 3: CSG for Complex Shapes
**What:** Use @react-three/csg for carved openings and combined shapes
**When to use:** Tunnels, doorways, complex architectural elements
**Example:**
```typescript
// TunnelEntrance.tsx
import { Geometry, Base, Subtraction } from '@react-three/csg';
import * as THREE from 'three';

const boxGeo = new THREE.BoxGeometry(1, 1, 1);

export function TunnelEntrance({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position}>
      <meshStandardMaterial color="#1a1a2e" />
      <Geometry>
        {/* Solid wall base */}
        <Base scale={[8, 4, 2]}>
          <boxGeometry />
        </Base>
        {/* Carve out tunnel opening */}
        <Subtraction position={[0, -0.5, 0]} scale={[3, 2.5, 3]}>
          <boxGeometry />
        </Subtraction>
      </Geometry>
    </mesh>
  );
}
```

### Pattern 4: Sensor Colliders for Hazard Zones
**What:** Use Rapier sensor colliders to detect player entry without physics response
**When to use:** Void pit death detection, damage zones, out-of-bounds areas
**Example:**
```typescript
// HazardZone detection (conceptual - integrate with existing physics)
// In the physics setup, create sensor colliders:
const hazardColliderDesc = RAPIER.ColliderDesc.cuboid(10, 5, 10)
  .setSensor(true); // No physical response, just detection

// Check intersection in game loop:
world.intersectionPairsWith(hazardCollider, (otherCollider) => {
  // Player entered hazard zone - trigger damage/death
  const playerId = colliderToPlayerMap.get(otherCollider.handle);
  if (playerId) {
    triggerHazardDamage(playerId);
  }
});
```

### Anti-Patterns to Avoid
- **Creating geometry in useFrame:** Never use `new THREE.BoxGeometry()` inside render loops - define geometry once, reuse
- **Inline material objects:** Don't use `<meshStandardMaterial color="red" />` everywhere - share material instances
- **React state for animation:** Avoid `useState` for position/rotation that changes every frame - use refs and direct mutation
- **Visual geometry as collision geometry:** Don't use detailed visual meshes for physics - create simplified colliders

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Grid floor pattern | Custom shader | Drei `<Grid />` | Shader-based, handles fade, infinite option |
| Boolean geometry | Manual vertex manipulation | @react-three/csg | CSG operations are complex; library handles edge cases |
| Floating animation | Custom animation system | `useFrame` + sine wave | Simple pattern, no library needed but don't overcomplicate |
| Glow effects | Custom post-processing | `emissive` + `emissiveIntensity` | Built into MeshStandardMaterial |
| Boundary polygon checking | New algorithm | Existing `isInsideBoundary()` | Already implemented in mapBoundaries.ts |

**Key insight:** For simple sci-fi floor/wall geometry, Three.js primitives with shared materials are sufficient. Only use CSG when you need to carve holes or combine shapes in ways primitives can't achieve.

## Common Pitfalls

### Pitfall 1: Performance Death from Material Recreation
**What goes wrong:** Each inline material in JSX creates a new GPU resource, causing performance degradation
**Why it happens:** React's declarative model makes it easy to write `<meshStandardMaterial color="red" />` repeatedly
**How to avoid:** Define materials once in a shared module, import and reference by instance
**Warning signs:** Frame rate drops as map complexity increases; profiler shows many material instances

### Pitfall 2: Collision Geometry Mismatch
**What goes wrong:** Players hit invisible walls or pass through visible geometry
**Why it happens:** Physics colliders don't match visual geometry transforms or scale
**How to avoid:**
- Create colliders from the same geometry definitions as visual meshes
- Apply identical transforms (position, rotation, scale) to both
- Enable physics debug visualization during development
**Warning signs:** Players report "invisible walls" or "falling through floor"

### Pitfall 3: Asymmetric Travel Time Imbalance
**What goes wrong:** One team consistently reaches objectives faster
**Why it happens:** Route lengths look similar visually but differ in actual traversal distance/complexity
**How to avoid:**
- Measure travel time with "knife runs" (no abilities) from spawn to center and to enemy flag
- Keep variance within 20% between teams
- Test all three routes independently
**Warning signs:** Playtest shows one team winning first engagement consistently

### Pitfall 4: Floating Platform Collision Timing
**What goes wrong:** Player falls through floating platforms or gets pushed unexpectedly
**Why it happens:** Physics collider position doesn't sync with animated visual position
**How to avoid:**
- For animated platforms, update collider position in the same frame as visual position
- Consider making floating platforms visually animated but physically static (visual only floats, collision stays fixed)
**Warning signs:** Inconsistent jumping onto floating platforms

### Pitfall 5: Hazard Zone False Positives
**What goes wrong:** Players take damage or die when clearly not in hazard zone
**Why it happens:** Sensor collider is larger than visual hazard indicator, or positioned incorrectly
**How to avoid:**
- Make sensor colliders slightly smaller than visual hazard area (give grace zone)
- Add brief warning period before damage/death
- Verify sensor position matches visual hazard position exactly
**Warning signs:** Player complaints about unfair deaths

## Code Examples

### Removing Old Map (VoxelWorld.tsx modification)
```typescript
// VoxelWorld.tsx - BEFORE (current)
export function VoxelWorld() {
  return (
    <group>
      <GLBMap />  {/* Remove this */}
      <Ground />
      <ArenaBoundaries />
    </group>
  );
}

// VoxelWorld.tsx - AFTER
import { SciFiCTFMap } from './maps/sci-fi-ctf/SciFiCTFMap';

export function VoxelWorld() {
  return (
    <group>
      <SciFiCTFMap />
    </group>
  );
}
```

### Basic Map Structure
```typescript
// SciFiCTFMap.tsx
import { Grid } from '@react-three/drei';
import { TeamABase } from './geometry/TeamABase';
import { TeamBBase } from './geometry/TeamBBase';
import { CenterZone } from './geometry/CenterZone';
import { Routes } from './geometry/Routes';
import { Boundaries } from './geometry/Boundaries';

export function SciFiCTFMap() {
  return (
    <group>
      {/* Sci-fi grid floor */}
      <Grid
        position={[0, 0, 0]}
        args={[200, 200]}
        cellSize={2}
        cellThickness={0.5}
        cellColor="#0088ff"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#00ffff"
        fadeDistance={150}
        fadeStrength={1}
        infiniteGrid
      />

      {/* Team bases at opposite ends */}
      <TeamABase position={[-80, 0, 0]} />
      <TeamBBase position={[80, 0, 0]} />

      {/* Center/mid area */}
      <CenterZone position={[0, 0, 0]} />

      {/* Three connecting routes */}
      <Routes />

      {/* Map boundary walls */}
      <Boundaries />
    </group>
  );
}
```

### Team Base with Distinct Aesthetic
```typescript
// TeamABase.tsx - Tech/Platform aesthetic
import * as THREE from 'three';
import { teamAAccent, floorMaterial } from '../materials';

// Reuse geometry instances
const platformGeo = new THREE.BoxGeometry(1, 1, 1);

export function TeamABase({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Main platform */}
      <mesh position={[0, 0.5, 0]} geometry={platformGeo} material={floorMaterial} scale={[30, 1, 40]} />

      {/* Elevated tech platforms */}
      <mesh position={[-8, 3, -10]} geometry={platformGeo} material={teamAAccent} scale={[8, 0.5, 8]} />
      <mesh position={[8, 5, -10]} geometry={platformGeo} material={teamAAccent} scale={[6, 0.5, 6]} />

      {/* Connecting stairs/ramps */}
      <mesh
        position={[-4, 1.75, -10]}
        rotation={[0, 0, Math.PI * 0.15]}
        geometry={platformGeo}
        material={floorMaterial}
        scale={[8, 0.3, 4]}
      />

      {/* Glowing accent strips */}
      <mesh position={[0, 0.6, -15]} geometry={platformGeo} material={teamAAccent} scale={[20, 0.1, 0.5]} />
    </group>
  );
}
```

### Three-Route Structure
```typescript
// Routes.tsx
import * as THREE from 'three';
import { floorMaterial, hazardMaterial } from '../materials';

const floorGeo = new THREE.BoxGeometry(1, 1, 1);

export function Routes() {
  return (
    <group>
      {/* Route 1: Close-quarters (tunnel/corridor) - center */}
      <group position={[0, 0, 0]}>
        {/* Narrow corridor floor */}
        <mesh position={[0, 0.25, 0]} geometry={floorGeo} material={floorMaterial} scale={[60, 0.5, 8]} />
        {/* Corridor walls */}
        <mesh position={[0, 2, 4.5]} geometry={floorGeo} material={floorMaterial} scale={[60, 4, 1]} />
        <mesh position={[0, 2, -4.5]} geometry={floorGeo} material={floorMaterial} scale={[60, 4, 1]} />
      </group>

      {/* Route 2: Medium-range (standard mixed) - north */}
      <group position={[0, 0, 30]}>
        <mesh position={[0, 0.25, 0]} geometry={floorGeo} material={floorMaterial} scale={[60, 0.5, 15]} />
      </group>

      {/* Route 3: Long-range (elevated platform) - south */}
      <group position={[0, 0, -30]}>
        {/* Elevated exposed platform */}
        <mesh position={[0, 4, 0]} geometry={floorGeo} material={floorMaterial} scale={[50, 0.5, 10]} />
        {/* Ramps up from each side */}
        <mesh
          position={[-35, 2, 0]}
          rotation={[0, 0, -Math.PI * 0.1]}
          geometry={floorGeo}
          material={floorMaterial}
          scale={[20, 0.5, 8]}
        />
        <mesh
          position={[35, 2, 0]}
          rotation={[0, 0, Math.PI * 0.1]}
          geometry={floorGeo}
          material={floorMaterial}
          scale={[20, 0.5, 8]}
        />
      </group>

      {/* Cross-passages between routes */}
      <mesh position={[-20, 0.25, 15]} geometry={floorGeo} material={floorMaterial} scale={[8, 0.5, 30]} />
      <mesh position={[20, 0.25, 15]} geometry={floorGeo} material={floorMaterial} scale={[8, 0.5, 30]} />

      {/* Hazard zones at strategic mid-map locations */}
      <mesh position={[0, -0.5, 15]} geometry={floorGeo} material={hazardMaterial} scale={[10, 0.2, 10]} />
    </group>
  );
}
```

### Boundary Walls
```typescript
// Boundaries.tsx
import * as THREE from 'three';

const wallGeo = new THREE.BoxGeometry(1, 1, 1);
const wallMaterial = new THREE.MeshStandardMaterial({
  color: '#0a0a15',
  metalness: 0.9,
  roughness: 0.1,
});

export function Boundaries() {
  const mapWidth = 200;
  const mapDepth = 100;
  const wallHeight = 30; // High enough players cannot pass
  const wallThickness = 2;

  return (
    <group>
      {/* North wall */}
      <mesh
        position={[0, wallHeight / 2, mapDepth / 2]}
        geometry={wallGeo}
        material={wallMaterial}
        scale={[mapWidth, wallHeight, wallThickness]}
      />
      {/* South wall */}
      <mesh
        position={[0, wallHeight / 2, -mapDepth / 2]}
        geometry={wallGeo}
        material={wallMaterial}
        scale={[mapWidth, wallHeight, wallThickness]}
      />
      {/* East wall */}
      <mesh
        position={[mapWidth / 2, wallHeight / 2, 0]}
        geometry={wallGeo}
        material={wallMaterial}
        scale={[wallThickness, wallHeight, mapDepth]}
      />
      {/* West wall */}
      <mesh
        position={[-mapWidth / 2, wallHeight / 2, 0]}
        geometry={wallGeo}
        material={wallMaterial}
        scale={[wallThickness, wallHeight, mapDepth]}
      />
    </group>
  );
}
```

### Physics Integration (updating usePhysics.ts)
```typescript
// Modification to loadMapColliders in usePhysics.ts
// Instead of loading from GLB, generate colliders from procedural geometry

async function loadMapColliders(world: RAPIER.World, rapier: typeof RAPIER): Promise<void> {
  // Ground plane
  const groundBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
  const groundBody = world.createRigidBody(groundBodyDesc);

  // Main floor colliders for each route
  // Route 1 (center corridor)
  createBoxCollider(world, rapier, [0, 0.25, 0], [30, 0.25, 4]);

  // Route 2 (north)
  createBoxCollider(world, rapier, [0, 0.25, 30], [30, 0.25, 7.5]);

  // Route 3 (elevated south)
  createBoxCollider(world, rapier, [0, 4, -30], [25, 0.25, 5]);
  // Ramps
  createRampCollider(world, rapier, [-35, 2, -30], [10, 0.25, 4], -Math.PI * 0.1);
  createRampCollider(world, rapier, [35, 2, -30], [10, 0.25, 4], Math.PI * 0.1);

  // Team bases
  createBoxCollider(world, rapier, [-80, 0.5, 0], [15, 0.5, 20]);
  createBoxCollider(world, rapier, [80, 0.5, 0], [15, 0.5, 20]);

  // Boundary walls
  createBoxCollider(world, rapier, [0, 15, 50], [100, 15, 1]);
  createBoxCollider(world, rapier, [0, 15, -50], [100, 15, 1]);
  createBoxCollider(world, rapier, [100, 15, 0], [1, 15, 50]);
  createBoxCollider(world, rapier, [-100, 15, 0], [1, 15, 50]);
}

function createBoxCollider(
  world: RAPIER.World,
  rapier: typeof RAPIER,
  position: [number, number, number],
  halfExtents: [number, number, number]
) {
  const bodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(...position);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = rapier.ColliderDesc.cuboid(...halfExtents);
  world.createCollider(colliderDesc, body);
}

function createRampCollider(
  world: RAPIER.World,
  rapier: typeof RAPIER,
  position: [number, number, number],
  halfExtents: [number, number, number],
  rotationZ: number
) {
  const bodyDesc = rapier.RigidBodyDesc.fixed()
    .setTranslation(...position)
    .setRotation({ x: 0, y: 0, z: Math.sin(rotationZ / 2), w: Math.cos(rotationZ / 2) });
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = rapier.ColliderDesc.cuboid(...halfExtents);
  world.createCollider(colliderDesc, body);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| GLTF for all map geometry | Procedural + GLTF hybrid | Ongoing trend | Full control over collision, faster iteration |
| Trimesh from visual geometry | Simplified cuboid colliders | Best practice 2023+ | Better physics performance |
| Per-mesh materials | Shared material instances | Always been best practice | 10x+ material count reduction |
| Physics separate from visual | Co-located geometry definitions | R3F pattern | Easier to keep in sync |

**Deprecated/outdated:**
- Using `path.toShapes(true)` for SVG paths - use `SVGLoader.createShapes(path)` instead (as of Three.js 2025)
- Creating new Vector3/geometry objects in useFrame - always reuse instances

## Open Questions

Things that couldn't be fully resolved:

1. **Exact map dimensions for balanced travel time**
   - What we know: Three routes should have ~equal travel time within 20% variance
   - What's unclear: Actual dimensions depend on player movement speed
   - Recommendation: Start with 200x100 unit arena, measure knife-run times, adjust

2. **Floating platform collision sync**
   - What we know: Animated platforms need collision to track visual
   - What's unclear: Performance cost of updating collider position each frame
   - Recommendation: Make floating platforms visually animated but collision static for Phase 1; revisit if gameplay requires moving collision

3. **Hazard zone damage integration**
   - What we know: Rapier sensors detect entry without physics response
   - What's unclear: How to integrate with existing damage/death system
   - Recommendation: Define sensor colliders in Phase 1; implement damage logic in later phase with game systems

## Sources

### Primary (HIGH confidence)
- [React Three Fiber Documentation](https://r3f.docs.pmnd.rs/) - Component patterns, useFrame, performance
- [Drei Grid Component](https://drei.docs.pmnd.rs/gizmos/grid) - Grid floor implementation
- [@react-three/csg GitHub](https://github.com/pmndrs/react-three-csg) - CSG operations API
- [Three.js MeshStandardMaterial Docs](https://threejs.org/docs/#api/materials/MeshStandardMaterial.emissive) - Emissive properties
- [R3F Scaling Performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance) - Material reuse, instancing
- Existing codebase: `VoxelWorld.tsx`, `usePhysics.ts`, `mapBoundaries.ts`

### Secondary (MEDIUM confidence)
- [Three.js ExtrudeGeometry Docs](https://threejs.org/docs/pages/ExtrudeGeometry.html) - Complex shape creation
- [react-three-rapier GitHub](https://github.com/pmndrs/react-three-rapier) - Sensor colliders, collision events
- [TF2Maps.net CTF Design Guide](https://tf2maps.net/threads/guide-fun-fast-and-dynamic-ctf-design.11683/) - Route design principles
- [Valve TF2 Design Theory](https://developer.valvesoftware.com/wiki/TF2_Design_Theory) - Class-based map considerations

### Tertiary (LOW confidence)
- [Three.js Forum: Neon Materials](https://discourse.threejs.org/t/neon-illuminating-materials/55522) - Glow effect approaches
- [Codrops R3F Animations](https://tympanus.net/codrops/2025/07/09/how-to-create-kinetic-image-animations-with-react-three-fiber/) - Animation patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Uses existing project dependencies with one optional addition
- Architecture: HIGH - Follows established R3F patterns already used in codebase
- Pitfalls: HIGH - Based on official docs and existing codebase pain points
- Code examples: MEDIUM - Based on patterns, not tested in this specific codebase

**Research date:** 2026-01-22
**Valid until:** 60 days (stable domain, no fast-moving dependencies)
