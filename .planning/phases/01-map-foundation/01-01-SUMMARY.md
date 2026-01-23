---
phase: 01-map-foundation
plan: 01
subsystem: map-rendering
tags: [react-three-fiber, drei, materials, three.js]

dependency-graph:
  requires: []
  provides:
    - SciFiCTFMap component
    - MAP_CONFIG with dimensions and spawn positions
    - 10 shared MeshStandardMaterial instances
  affects:
    - 01-02 (ground geometry)
    - 01-03 (boundary walls)
    - 01-04 (team bases)
    - 01-05 (physics colliders)

tech-stack:
  added: []
  patterns:
    - drei Grid for debug floor visualization
    - THREE.MeshStandardMaterial constructor for shared materials

key-files:
  created:
    - apps/client/src/components/game/maps/sci-fi-ctf/SciFiCTFMap.tsx
    - apps/client/src/components/game/maps/sci-fi-ctf/config.ts
    - apps/client/src/components/game/maps/sci-fi-ctf/materials.ts
    - apps/client/src/components/game/maps/sci-fi-ctf/index.ts
  modified:
    - apps/client/src/components/game/VoxelWorld.tsx
    - apps/client/src/hooks/usePhysics.ts

decisions:
  - id: map-dimensions
    choice: "200x100 elongated rectangle (width x depth)"
    reason: "Classic CTF layout with teams on opposite ends"
  - id: material-construction
    choice: "THREE.MeshStandardMaterial constructor, not JSX"
    reason: "Single GPU resource per material type for performance"

metrics:
  duration: 3m
  completed: 2026-01-23
---

# Phase 1 Plan 01: Scaffold Map Structure Summary

Removed old GLB map dependency and scaffolded procedural sci-fi CTF map with shared materials for dark metallic aesthetic with team-colored emissive accents.

## What Was Built

### 1. Map Component Structure
- Created `apps/client/src/components/game/maps/sci-fi-ctf/` directory
- `SciFiCTFMap.tsx`: Main map component with drei Grid debug floor
- `config.ts`: MAP_CONFIG with dimensions (200x100), team bases, elevations
- `index.ts`: Barrel export for clean imports
- `materials.ts`: 10 shared MeshStandardMaterial instances

### 2. VoxelWorld Integration
- Removed GLBMap component and useGLTF imports
- Removed CURRENT_MAP constant and MAP_CONFIG (scale/position)
- Now imports and renders SciFiCTFMap instead
- Kept Ground (fallback floor) and ArenaBoundaries

### 3. Physics Cleanup
- Removed loadMapColliders function (no more GLB loading)
- Removed createTrimeshCollider function
- Removed GLTFLoader and THREE imports
- Removed CURRENT_MAP and MAP_SCALE constants
- Kept safety ground at y=-50 and boundary colliders

### 4. Shared Materials (10 total)
| Material | Color | Properties |
|----------|-------|------------|
| floorMaterial | #1a1a2e | metalness 0.8, roughness 0.3 |
| wallMaterial | #0d0d1a | metalness 0.7, roughness 0.4 |
| platformMaterial | #1f1f35 | metalness 0.85, roughness 0.25 |
| teamAAccent | #2a1a1a | emissive #ff4400, intensity 0.5 |
| teamAGlow | #1a0a0a | emissive #ff6600, intensity 1.2 |
| teamBAccent | #1a1a2a | emissive #00ffff, intensity 0.5 |
| teamBGlow | #0a0a1a | emissive #00ccff, intensity 1.2 |
| hazardMaterial | #1a0a1a | emissive #ff00ff, intensity 0.8 |
| caveMaterial | #1a1512 | metalness 0.3, roughness 0.8 |
| energyBarrierMaterial | #000000 | emissive #00ff88, transparent |

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | b826b1e | Remove GLB map, scaffold SciFiCTFMap component |
| 2 | 536ab35 | Create shared materials for sci-fi CTF map |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- [x] `pnpm build --filter @voxel-strike/client` compiles successfully
- [x] Old GLB map no longer appears (useGLTF removed)
- [x] SciFiCTFMap renders with Grid floor
- [x] Materials file exports 10+ material instances (10 materials + registry)

## Success Criteria Met

1. [x] VoxelWorld.tsx imports and renders SciFiCTFMap (not GLBMap)
2. [x] usePhysics.ts no longer loads GLB colliders
3. [x] materials.ts exports 10+ shared material instances
4. [x] config.ts exports MAP_CONFIG with dimensions and base positions
5. [x] Game compiles without errors

## Next Steps

Plan 02 will add ground geometry and elevation to the map using these shared materials.
