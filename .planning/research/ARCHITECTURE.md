# Architecture Research

**Domain:** R3F Game Level Construction for CTF Map
**Researched:** 2026-01-22
**Confidence:** HIGH (based on existing codebase analysis and official documentation)

## Standard Architecture

### System Overview

```
+---------------------------------------------------------------------------------+
|                          Presentation Layer (R3F)                               |
|  +-------------+  +-------------+  +-------------+  +-------------+             |
|  | MapGeometry |  | MapZones    |  | MapSpawns   |  | MapLighting |             |
|  | Components  |  | (Flags,etc) |  | (Points)    |  | (Ambient)   |             |
|  +------+------+  +------+------+  +------+------+  +------+------+             |
|         |                |                |                |                    |
+---------+----------------+----------------+----------------+--------------------+
          |                |                |
+---------v----------------v----------------v---------------------------------+
|                      Physics Integration Layer                              |
|  +------------------+  +------------------+  +------------------+            |
|  | CollisionMeshes |  | TrimeshColliders |  | BoundaryPolygon  |            |
|  | (from GLTF/JSX) |  | (Rapier)         |  | (2D constraint)  |            |
|  +--------+---------+  +--------+---------+  +--------+---------+            |
|           |                     |                     |                      |
+-----------+---------------------+---------------------+----------------------+
            |                     |                     |
+-----------v---------------------v---------------------v----------------------+
|                      Game Logic Layer (Shared Package)                       |
|  +------------------+  +------------------+  +------------------+             |
|  | SpawnManager     |  | FlagManager      |  | CTFGameMode      |             |
|  | (spawn points)   |  | (base positions) |  | (game rules)     |             |
|  +------------------+  +------------------+  +------------------+             |
+------------------------------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| MapGeometry | Visual 3D mesh rendering | R3F `<primitive>` with GLTF or JSX mesh components |
| MapZones | Game-relevant area definitions | Flag base positions, capture zones, hazard areas |
| MapSpawns | Spawn point configurations | Vec3 arrays per team with rotation data |
| MapLighting | Level-specific lighting setup | Ambient, directional, point lights per area |
| CollisionMeshes | Physics collision surfaces | Trimesh colliders from visual geometry |
| BoundaryPolygon | Playable area constraint | 2D polygon with ray-casting containment check |

## Recommended Project Structure

```
apps/client/src/
├── components/game/
│   ├── maps/                    # Map-specific components
│   │   ├── index.ts             # Map registry/loader
│   │   ├── CTFMap.tsx           # Base CTF map component interface
│   │   ├── inferno/             # Current map (Inferno_World_free)
│   │   │   ├── InfernoMap.tsx   # Main map component
│   │   │   ├── infernoConfig.ts # Map-specific config (scale, bounds)
│   │   │   └── infernoBoundary.ts # Boundary polygon points
│   │   └── lowpoly-ctf/         # New custom map
│   │       ├── LowPolyCTFMap.tsx  # Main map component
│   │       ├── geometry/          # Map geometry components
│   │       │   ├── Base.tsx       # Base structure mesh
│   │       │   ├── MidZone.tsx    # Center area mesh
│   │       │   └── Ramps.tsx      # Ramp/path meshes
│   │       ├── colliders/         # Physics collision meshes
│   │       │   ├── TerrainCollider.tsx
│   │       │   └── StructureColliders.tsx
│   │       ├── config.ts          # Map config (spawns, bases, bounds)
│   │       └── boundary.ts        # Boundary polygon
│   ├── VoxelWorld.tsx           # Map loader/switcher
│   └── ...
├── config/
│   ├── mapBoundaries.ts         # Active map boundary (move to per-map)
│   └── maps/                    # Map configurations
│       └── index.ts             # Map registry
└── hooks/
    └── useMapPhysics.ts         # Map-specific physics initialization
```

### Structure Rationale

- **maps/[mapname]/** - Each map is self-contained with its own geometry, colliders, and config
- **geometry/** - Visual components separated from collision for independent optimization
- **colliders/** - Physics meshes can be simplified versions of visual geometry
- **config.ts** - Single source of truth for spawn points, base positions, boundaries

## Architectural Patterns

### Pattern 1: Declarative Map Component

**What:** Map as a self-contained R3F component that exposes configuration via props/context
**When to use:** For maps that need to integrate with existing game systems
**Trade-offs:**
- Pro: Encapsulation, easy to swap maps
- Con: Must ensure collider initialization timing with physics world

**Example:**
```typescript
// LowPolyCTFMap.tsx
export function LowPolyCTFMap({ onReady }: { onReady?: () => void }) {
  const { registerColliders } = useMapPhysics();

  useEffect(() => {
    // Register colliders when geometry loads
    registerColliders(mapColliderData);
    onReady?.();
  }, []);

  return (
    <group>
      {/* Visual geometry */}
      <MapTerrain />
      <RedBase />
      <BlueBase />
      <MidZone />

      {/* Non-visual collision helpers */}
      <CollisionMeshes visible={__DEV__} />
    </group>
  );
}

// Export map configuration for game systems
export const mapConfig: MapConfig = {
  redBase: { x: -40, y: 10, z: 0 },
  blueBase: { x: 40, y: 10, z: 0 },
  redSpawns: [...],
  blueSpawns: [...],
  boundary: [...],
};
```

### Pattern 2: Separated Visual/Collision Geometry

**What:** Visual meshes and physics colliders as separate geometry, allowing LOD for each
**When to use:** When visual detail exceeds physics precision needs
**Trade-offs:**
- Pro: Optimized collision detection, visual fidelity independent of physics
- Con: Two geometries to maintain, potential for visual/collision mismatch

**Example:**
```typescript
// TerrainCollider.tsx - simplified collision mesh
export function TerrainCollider() {
  const geometry = useMemo(() => {
    // Simplified geometry for collision
    const geo = new THREE.PlaneGeometry(100, 100, 10, 10);
    // Apply height displacement for terrain
    return geo;
  }, []);

  // Register with Rapier on mount
  useColliderRegistration(geometry);

  return null; // No visual representation
}

// MapTerrain.tsx - detailed visual mesh
export function MapTerrain() {
  return (
    <mesh>
      <planeGeometry args={[100, 100, 100, 100]} />
      <meshStandardMaterial map={terrainTexture} />
    </mesh>
  );
}
```

### Pattern 3: Configuration-Driven Spawns and Zones

**What:** Map config file defines all game-relevant positions that game logic consumes
**When to use:** Always - decouples map from game mode
**Trade-offs:**
- Pro: Game logic doesn't need to know map structure
- Con: Config must stay in sync with visual geometry

**Example:**
```typescript
// config.ts
export const mapConfig = {
  name: 'lowpoly-ctf',

  // Team bases (flag positions)
  redBase: { x: -40, y: 12, z: 0 },
  blueBase: { x: 40, y: 12, z: 0 },

  // Spawn points per team
  redSpawns: [
    { x: -35, y: 12, z: -5 },
    { x: -35, y: 12, z: 5 },
    { x: -38, y: 12, z: 0 },
  ],
  blueSpawns: [
    { x: 35, y: 12, z: -5 },
    { x: 35, y: 12, z: 5 },
    { x: 38, y: 12, z: 0 },
  ],

  // Map scale and position
  transform: {
    scale: 1,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  },
};
```

## Data Flow

### Map Loading Flow

```
[GameCanvas mounts]
    |
[VoxelWorld selects active map]
    |
[MapComponent mounts] --> [Visual geometry renders]
    |
[useEffect triggers] --> [Collider registration starts]
    |
[usePhysics.loadMapColliders()] --> [Rapier trimesh creation]
    |
[physics.step() called] --> [Collision structures initialized]
    |
[onReady callback] --> [Game can start]
```

### Spawn Point Data Flow

```
[Map config.ts]
    |
    v (exports)
[SpawnManager.initialize(config.redSpawns, config.blueSpawns)]
    |
    v (stores)
[SpawnManager internal arrays]
    |
    v (provides)
[SpawnManager.getSpawnPoint(team)] --> [Player respawn position]
```

### Collision Data Flow

```
[Map geometry (GLTF or JSX meshes)]
    |
    v (traverse meshes)
[Extract vertices + indices from BufferGeometry]
    |
    v (apply world transform)
[Scale/rotate/translate vertices to world space]
    |
    v (create collider)
[rapier.ColliderDesc.trimesh(vertices, indices)]
    |
    v (attach to body)
[world.createCollider(colliderDesc, fixedBody)]
    |
    v (query)
[world.castRay() / checkGroundWithNormal() / checkWallCollision()]
```

### Key Data Flows

1. **Visual to Physics:** Mesh geometry -> BufferGeometry -> Float32Array vertices -> Rapier trimesh
2. **Config to Game:** mapConfig.ts -> SpawnManager/FlagManager -> CTFGameMode
3. **Boundary to Player:** boundary.ts -> isInsideBoundary() -> constrainToMapBoundary()

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1 map | Current monolithic approach is fine |
| 2-5 maps | Per-map folders with shared interface, map registry |
| 5+ maps | Lazy loading, LOD system, collision mesh simplification |

### Scaling Priorities

1. **First bottleneck:** Collision mesh complexity - simplify trimesh geometry before adding detail
2. **Second bottleneck:** Map loading time - implement async loading with progress indicator

## Anti-Patterns

### Anti-Pattern 1: Tight Coupling to GLTF Structure

**What people do:** Reference GLTF node names directly in game code
**Why it's wrong:** Changing map model breaks game logic
**Do this instead:** Export map config separately; map component translates GLTF structure to config

### Anti-Pattern 2: Visual Geometry as Physics Collider

**What people do:** Use high-detail visual mesh directly for collision
**Why it's wrong:** Wasted physics computation, potential for buggy collision on complex surfaces
**Do this instead:** Create simplified collision geometry, use convex decomposition for complex shapes

### Anti-Pattern 3: Hard-coded Spawn/Base Positions

**What people do:** Embed positions directly in SpawnManager/FlagManager
**Why it's wrong:** Changing map requires modifying game logic code
**Do this instead:** SpawnManager receives positions from map config at initialization

### Anti-Pattern 4: Global Boundary Polygon

**What people do:** Single mapBoundaries.ts file shared across all maps
**Why it's wrong:** Can only have one map's boundary active
**Do this instead:** Each map exports its boundary; VoxelWorld sets active boundary on map change

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Rapier Physics | Global world instance + per-map collider registration | Must step world after adding colliders |
| SpawnManager | Initialize with map config on map load | Call before game start |
| FlagManager | Initialize with base positions on map load | Positions from map config |
| CTFGameMode | Receives managers already configured | Doesn't know about map structure |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| MapComponent -> usePhysics | Function call to register colliders | Async, wait for physics ready |
| MapConfig -> GameLogic | Import config, pass to managers | Synchronous at game start |
| VoxelWorld -> MapComponent | Component rendering | Props for any dynamic config |
| PlayerController -> Physics | Query functions (raycast, ground check) | Every frame during gameplay |

## Build Order Implications

Based on dependencies, the recommended build order for a new map:

1. **Map Config** - Define spawns, bases, boundaries (no dependencies)
2. **Boundary Polygon** - Playable area constraint (depends on config)
3. **Collision Meshes** - Simplified physics geometry (depends on config for bounds)
4. **Visual Geometry** - Detailed render meshes (can parallel with collision)
5. **Map Component** - Assembles geometry + registers colliders (depends on 3, 4)
6. **VoxelWorld Integration** - Map selection/loading (depends on 5)
7. **Manager Integration** - Connect config to SpawnManager/FlagManager (depends on 1, 6)

**Parallelizable:** Steps 3 and 4 can be done in parallel. Step 1 should be done first as it informs all other work.

## Sources

- Existing codebase analysis: `/apps/client/src/components/game/VoxelWorld.tsx`, `/apps/client/src/hooks/usePhysics.ts`
- Existing architecture: `/packages/game-logic/src/match/SpawnManager.ts`, `/packages/game-logic/src/ctf/FlagManager.ts`
- [React Three Fiber Documentation](https://r3f.docs.pmnd.rs/getting-started/introduction)
- [React Three Rapier GitHub](https://github.com/pmndrs/react-three-rapier)
- [Rapier Colliders Documentation](https://rapier.rs/docs/user_guides/javascript/colliders/)

---
*Architecture research for: R3F Game Level Construction*
*Researched: 2026-01-22*
