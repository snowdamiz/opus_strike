---
phase: 02-team-base-construction
plan: 03
subsystem: ui
tags: [three.js, react-three-fiber, spawn-indicators, emissive-materials, animation]

# Dependency graph
requires:
  - phase: 02-01
    provides: Team base geometry and config with spawn positions
provides:
  - Reusable SpawnIndicator component with team-colored glow
  - Visual spawn point markers in both team bases
  - Pulse animation for subtle visual feedback
affects: [03-player-spawning, 05-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Shared materials outside component for GPU performance
    - Ring geometry for floor markers
    - useFrame for emissive intensity animation

key-files:
  created:
    - apps/client/src/components/game/maps/sci-fi-ctf/geometry/SpawnIndicator.tsx
  modified:
    - apps/client/src/components/game/maps/sci-fi-ctf/geometry/index.ts
    - apps/client/src/components/game/maps/sci-fi-ctf/geometry/TeamABase.tsx
    - apps/client/src/components/game/maps/sci-fi-ctf/geometry/TeamBBase.tsx

key-decisions:
  - "Ring geometry with inner circle for spawn marker visual"
  - "Shared materials per team for single GPU resource"
  - "Emissive intensity pulse (0.2-0.4) for subtle animation"

patterns-established:
  - "Spawn indicator pattern: ring + center dot at y=0.02"
  - "Local coordinate conversion: spawn.x - base.x for group positioning"

# Metrics
duration: 2min
completed: 2026-01-23
---

# Phase 02 Plan 03: Spawn Indicators Summary

**Subtle floor markers with team-colored glowing rings and pulse animation at configured spawn positions**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-23T10:00:00Z
- **Completed:** 2026-01-23T10:02:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Created SpawnIndicator component with ring geometry and center dot
- Implemented subtle pulse animation varying emissive intensity
- Added 5 spawn indicators to TeamABase (red/orange glow)
- Added 5 spawn indicators to TeamBBase (blue/cyan glow)
- Shared materials for performance (single GPU resource per team)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create SpawnIndicator component** - `551c851` (feat)
2. **Task 2: Add spawn indicators to TeamABase** - `65330fb` (feat)
3. **Task 3: Add spawn indicators to TeamBBase** - `f9ec92d` (feat)

## Files Created/Modified

- `apps/client/src/components/game/maps/sci-fi-ctf/geometry/SpawnIndicator.tsx` - Reusable spawn point visual indicator
- `apps/client/src/components/game/maps/sci-fi-ctf/geometry/index.ts` - Barrel export for SpawnIndicator
- `apps/client/src/components/game/maps/sci-fi-ctf/geometry/TeamABase.tsx` - Renders 5 red spawn indicators
- `apps/client/src/components/game/maps/sci-fi-ctf/geometry/TeamBBase.tsx` - Renders 5 blue spawn indicators

## Decisions Made

- **Ring geometry + center dot:** Creates clear spawn point visual without being intrusive
- **Shared materials:** Materials created outside component (not JSX) for single GPU resource per team
- **y=0.02 offset:** Prevents z-fighting with ground floor meshes
- **Emissive intensity animation:** Pulse between 0.2-0.4 for subtle visual without being distracting

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Spawn indicators complete and integrated
- Both team bases now have visual spawn point markers
- Ready for player spawning integration in Phase 3

---
*Phase: 02-team-base-construction*
*Plan: 03*
*Completed: 2026-01-23*
