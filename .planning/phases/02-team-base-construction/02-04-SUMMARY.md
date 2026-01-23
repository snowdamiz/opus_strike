---
phase: 02-team-base-construction
plan: 04
subsystem: map-geometry
tags: [flag-zone, contested-state, visual-feedback, useFrame, useGameStore]

dependency-graph:
  requires: ["02-01"]
  provides: ["FlagZone component with contested detection"]
  affects: ["CTF gameplay, visual feedback"]

tech-stack:
  added: []
  patterns: ["useMemo for expensive checks", "useFrame for animation", "shared material instances"]

file-tracking:
  key-files:
    created:
      - apps/client/src/components/game/maps/sci-fi-ctf/geometry/FlagZone.tsx
    modified:
      - apps/client/src/components/game/maps/sci-fi-ctf/geometry/index.ts
      - apps/client/src/components/game/maps/sci-fi-ctf/SciFiCTFMap.tsx

decisions:
  - id: contested-pulse-rate
    choice: "6Hz contested vs 1.5Hz safe"
    rationale: "4x faster pulse provides clear urgent warning"
  - id: contest-radius
    choice: "15 units default"
    rationale: "Reasonable distance for 'enemy nearby' detection"
  - id: player-state-check
    choice: "player.state === 'alive'"
    rationale: "Match actual Player interface (no isAlive field)"

metrics:
  duration: 2m
  completed: 2026-01-23
---

# Phase 02 Plan 04: Flag Zone Indicators Summary

**One-liner:** Flag zone boundary markers with contested-state pulse feedback using useGameStore player detection.

## What Was Built

Created FlagZone component that renders visual boundary indicators around capture zones with dynamic pulse animation based on enemy presence.

### Component Architecture

```
FlagZone.tsx
  - Ring geometry (4 segments = diamond shape) marking zone edge
  - Corner markers (4 planes) reinforcing square boundary
  - Shared materials (red/blue) for GPU efficiency
  - useMemo contested check (O(n) player iteration)
  - useFrame animation (pulse speed based on contested state)
```

### Contested Detection Logic

```typescript
const isContested = useMemo(() => {
  for (const player of players.values()) {
    if (player.team !== team && player.state === 'alive') {
      const distSq = dx*dx + dz*dz;
      if (distSq < contestRadiusSq) return true;
    }
  }
  return false;
}, [players, team, position, contestRadius]);
```

### Animation Parameters

| State | Pulse Speed | Emissive Intensity | Opacity |
|-------|------------|-------------------|---------|
| Safe | 1.5 Hz | 0.3-0.7 | 0.7 |
| Contested | 6 Hz | 0.5-1.5 | 0.65-0.95 |

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Create FlagZone component with contested detection | 358be1d |
| 2 | Add FlagZone components to SciFiCTFMap | f03d2ea |

## Key Files

**Created:**
- `apps/client/src/components/game/maps/sci-fi-ctf/geometry/FlagZone.tsx` - Main component

**Modified:**
- `apps/client/src/components/game/maps/sci-fi-ctf/geometry/index.ts` - Added export
- `apps/client/src/components/game/maps/sci-fi-ctf/SciFiCTFMap.tsx` - Added FlagZone instances

## Flag Zone Positions

| Team | Position | Config Source |
|------|----------|---------------|
| Red (A) | x=-90, z=0 | MAP_CONFIG.flagZones.teamA |
| Blue (B) | x=92, z=0 | MAP_CONFIG.flagZones.teamB |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Player.isAlive does not exist**
- **Found during:** Task 1 implementation
- **Issue:** Plan specified `player.isAlive` but Player interface has `player.state: PlayerState`
- **Fix:** Changed to `player.state === 'alive'` to match actual interface
- **Files modified:** FlagZone.tsx
- **Commit:** 358be1d

## Verification Results

- [x] `pnpm build --filter @voxel-strike/client` completes without errors
- [x] FlagZone.tsx exists and exports FlagZone
- [x] FlagZone uses useGameStore to check player positions
- [x] SciFiCTFMap.tsx imports and renders 2 FlagZone components
- [x] Red flag zone at x=-90, blue flag zone at x=92

## Next Phase Readiness

No blockers. FlagZone provides visual contested feedback for CTF gameplay. Integration with actual flag capture mechanics will be handled by game logic (not map rendering).
