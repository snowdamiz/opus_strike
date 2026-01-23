---
phase: 01-map-foundation
plan: 05
subsystem: physics
tags: [boundaries, colliders, rapier, walls, physics]
dependencies:
  requires: [01-02, 01-03, 01-04]
  provides: [map-colliders, perimeter-walls, boundary-config]
  affects: [player-movement, collision-detection, phase-02]
tech-stack:
  added: []
  patterns: [cuboid-colliders, fixed-rigid-bodies]
key-files:
  created:
    - apps/client/src/components/game/maps/sci-fi-ctf/geometry/Boundaries.tsx
    - apps/client/src/components/game/maps/sci-fi-ctf/colliders/MapColliders.ts
    - apps/client/src/components/game/maps/sci-fi-ctf/colliders/index.ts
  modified:
    - apps/client/src/components/game/maps/sci-fi-ctf/geometry/index.ts
    - apps/client/src/components/game/maps/sci-fi-ctf/SciFiCTFMap.tsx
    - apps/client/src/config/mapBoundaries.ts
    - apps/client/src/hooks/usePhysics.ts
    - apps/client/src/components/game/VoxelWorld.tsx
decisions:
  - id: boundary-inset
    choice: "5-unit inset from walls for boundary polygon"
    rationale: "Buffer for collision response prevents players from getting stuck at exact wall positions"
  - id: collider-architecture
    choice: "Centralized createMapColliders function with cuboid colliders"
    rationale: "Simple cuboids provide reliable collision; avoids trimesh complexity"
metrics:
  duration: 3.5m
  completed: 2026-01-23
---

# Phase 01 Plan 05: Boundaries and Colliders Summary

Perimeter walls with physics colliders for complete map collision coverage using Rapier cuboid colliders.

## What Was Built

### Task 1: Perimeter Boundary Walls

Created `Boundaries.tsx` component with four tall perimeter walls enclosing the map:

- **North/South walls:** Position at z = +/-50, spanning x = -100 to +100
- **West/East walls:** Position at x = +/-100, spanning z = -50 to +50
- **Wall height:** 15 units (from MAP_CONFIG.wallHeight)
- **Wall thickness:** 2 units

Additional visual elements:
- Glow strips at top edge of each wall (energyBarrierMaterial)
- Corner pillars at all four corners (18 units high, extending above wall height)
- Vertical glow strips on corner pillars

### Task 2: Map Boundary Config Update

Replaced the complex Inferno_World polygon with a simple rectangle matching the sci-fi CTF map:

```typescript
export const MAP_BOUNDARY_POLYGON: BoundaryPoint[] = [
  { x: -95, z: -45 }, // SW
  { x: -95, z: 45 },  // NW
  { x: 95, z: 45 },   // NE
  { x: 95, z: -45 },  // SE
];
```

The 5-unit inset from walls (95 vs 100, 45 vs 50) provides buffer for collision response.

### Task 3: Physics Colliders

Created `MapColliders.ts` with comprehensive collider coverage:

**Ground and Perimeter:**
- Main ground plane: cuboid at y=-0.5, covering 200x100 map
- Four perimeter wall colliders matching visual geometry

**Team Bases (both A and B):**
- Main spawn platform colliders
- Elevated command platform colliders (y=3)
- Flag zone platform colliders (y=1)

**Route Colliders:**
- North route: elevated floor at y=3, railings, cover pillars
- Middle route: cover blocks at ground level
- South route: tunnel walls and ceilings for all three sections

**Center Zone:**
- Central hub platform (slightly elevated)
- Sniper perch colliders (north and south at y=3)

**Integration:**
- Updated `usePhysics.ts` to call `createMapColliders(world, RAPIER)`
- Removed obsolete `createBoundaryColliders` function
- Removed `ArenaBoundaries` from `VoxelWorld.tsx` (replaced by visual Boundaries component)

## Commits

| Commit | Description |
|--------|-------------|
| 3a8d779 | feat(01-05): create perimeter boundary walls |
| 05dc74a | feat(01-05): update mapBoundaries for sci-fi CTF map |
| 2348c91 | feat(01-05): create physics colliders for all map geometry |

## Deviations from Plan

None - plan executed exactly as written.

## Technical Notes

**Collider Architecture:**
- All colliders use `RigidBodyDesc.fixed()` for static geometry
- Cuboid colliders with half-extents (Rapier convention)
- Single `createMapColliders` function for centralized management

**Helper Function:**
```typescript
function createCuboidCollider(
  world: RAPIER.World,
  rapier: typeof RAPIER,
  posX, posY, posZ,
  halfWidth, halfHeight, halfDepth
): void
```

## Verification

- [x] Build compiles: `pnpm build --filter @voxel-strike/client`
- [x] Boundaries visible enclosing map
- [x] mapBoundaries.ts correctly identifies inside/outside points
- [x] Colliders created for all surfaces

## Phase 1 Completion Status

This was the final plan (05 of 05) in Phase 01-map-foundation.

**All Phase 1 plans complete:**
1. 01-01: Config and materials
2. 01-02: Team A base geometry
3. 01-03: Team B base geometry
4. 01-04: Routes and center zone
5. 01-05: Boundaries and colliders (this plan)

**Phase 1 deliverables achieved:**
- Complete visual map geometry
- Full physics collision coverage
- Proper boundary enforcement
- Players can walk on all intended surfaces
