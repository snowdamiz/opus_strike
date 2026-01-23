---
phase: 02
plan: 01
subsystem: map-configuration
tags: [spawn-points, flag-zones, shared-types, config]

dependency-graph:
  requires: [01-01, 01-02, 01-03A, 01-03B, 01-04A, 01-04B, 01-05]
  provides: [spawn-positions, flag-positions, server-map-export]
  affects: [02-02, game-server]

tech-stack:
  added: []
  patterns:
    - Centralized position configuration
    - Shared types between client and server

key-files:
  created:
    - packages/shared/src/maps/sci-fi-ctf.ts
    - packages/shared/src/maps/index.ts
  modified:
    - apps/client/src/components/game/maps/sci-fi-ctf/config.ts
    - packages/shared/src/index.ts

decisions:
  - "Team naming: client uses teamA/teamB, server uses red/blue"
  - "Spawn Y=1 for player center slightly above ground level"
  - "5 spawn points per team for rotation variety"

metrics:
  duration: 2m
  completed: 2026-01-23
---

# Phase 02 Plan 01: Spawn and Flag Position Config Summary

Centralized spawn and flag position configuration in MAP_CONFIG with shared export for server consumption.

## What Was Built

### Task 1: Add spawn and flag positions to MAP_CONFIG

Extended `apps/client/src/components/game/maps/sci-fi-ctf/config.ts` with:

**Spawn Points (5 per team):**
- Team A: Distributed across tech base at x=-80 (north, center, south, front-north, front-south)
- Team B: Distributed across cave base at x=80 (mirrored positions)
- All spawns at y=1 to place player center slightly above ground

**Flag Zones:**
- Team A: x=-90, y=1, z=0 (back of tech base on raised platform)
- Team B: x=92, y=1, z=0 (back of cave base in alcove)

### Task 2: Create shared map positions for server

Created `packages/shared/src/maps/sci-fi-ctf.ts`:
- Exports `SCI_FI_CTF_POSITIONS` constant
- Uses red/blue team naming (server convention)
- Includes teamABase, teamBBase, spawnPoints, flagZones
- Type-safe with Vec3 from shared types

Created barrel export `packages/shared/src/maps/index.ts` and updated `packages/shared/src/index.ts` to expose maps module.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | d185275 | feat(02-01): add spawn and flag positions to MAP_CONFIG |
| 2 | 8941bc9 | feat(02-01): create shared map positions for server |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

1. Client builds: PASS
2. Shared builds: PASS
3. MAP_CONFIG exports expected shape: PASS
4. SCI_FI_CTF_POSITIONS exported from @voxel-strike/shared: PASS
5. Position values consistent between client and shared: PASS

## Next Phase Readiness

Ready for 02-02: Team spawn visual markers. The spawn and flag positions are now available for:
- Visual marker placement in geometry components
- Server-side SpawnManager initialization
- FlagManager zone configuration
