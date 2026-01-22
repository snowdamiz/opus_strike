---
phase: 01-react-optimization-foundation
plan: 02
subsystem: react-performance
tags: [zustand, shallow-selectors, react-optimization, re-render-prevention]

# Dependency graph
requires: []
provides:
  - Narrow Zustand selectors with useShallow pattern for effect managers
  - OtherPlayers component only re-renders when players change
  - All effect managers use single shallow selector instead of multiple individual subscriptions
affects: [01-03-memoize-expensive-calculations, 02-component-memoization]

# Tech tracking
tech-stack:
  added: ["zustand/shallow"]
  patterns: ["useShallow(state => ({ ... })) selector pattern for multi-field subscriptions"]

key-files:
  created: []
  modified:
    - apps/client/src/components/game/OtherPlayers.tsx
    - apps/client/src/components/game/HookshotEffects.tsx
    - apps/client/src/components/game/BlazeEffects.tsx
    - apps/client/src/components/game/PhantomEffects.tsx
    - apps/client/src/components/game/GlacierEffects.tsx
    - apps/client/src/components/ui/Scoreboard.tsx
    - apps/client/src/components/ui/HUD.tsx

key-decisions:
  - "Use useShallow from zustand/shallow for multi-field selectors to prevent re-renders on object reference changes"
  - "Pattern: useGameStore(useShallow(state => ({ field1: state.field1, field2: state.field2 })))"

patterns-established:
  - "Zustand shallow selector pattern: Import useShallow, wrap selector function for multi-field subscriptions"
  - "Effect managers subscribe only to their specific effect arrays, not entire store"

# Metrics
duration: 2.5min
completed: 2026-01-22
---

# Phase 1 Plan 2: Narrow Zustand Selectors Summary

**Zustand shallow selectors with useShallow for 7 React components, preventing cascading re-renders when unrelated state changes**

## Performance

- **Duration:** 2.5 min
- **Started:** 2026-01-22T10:07:55Z
- **Completed:** 2026-01-22T10:10:25Z
- **Tasks:** 4
- **Files modified:** 7

## Accomplishments

- OtherPlayers now uses shallow selectors for players, playerId, gamePhase - will not re-render when projectiles/effects update
- HookshotEffects manager combines 6 individual selectors into single shallow selector
- BlazeEffects manager uses shallow comparison for bombs, localPlayer, jetpackActive
- PhantomEffects, GlacierEffects, Scoreboard, HUD all migrated to narrow selectors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add useShallow import and update OtherPlayers** - `955b898` (feat)
2. **Task 2: Update HookshotEffects manager with narrow selectors** - `f8b926d` (feat)
3. **Task 3: Update BlazeEffects manager with narrow selectors** - `23413e5` (feat)
4. **Task 4: Audit and update remaining components with broad subscriptions** - `073c2e5` (feat)

## Files Created/Modified

- `apps/client/src/components/game/OtherPlayers.tsx` - Added useShallow import, narrow selector for players/playerId/gamePhase
- `apps/client/src/components/game/HookshotEffects.tsx` - Combined 6 individual selectors into single shallow selector
- `apps/client/src/components/game/BlazeEffects.tsx` - Shallow selector for bombs/localPlayer/jetpackActive
- `apps/client/src/components/game/PhantomEffects.tsx` - Shallow selector for localPlayer/ultimateEffectActive/ultimateEffectType
- `apps/client/src/components/game/GlacierEffects.tsx` - Shallow selector for 8 glacier-specific fields
- `apps/client/src/components/ui/Scoreboard.tsx` - Shallow selector for players/localPlayer/redScore/blueScore
- `apps/client/src/components/ui/HUD.tsx` - Shallow selector for 18 HUD-specific fields

## Decisions Made

- Used Zustand's `useShallow` from `zustand/shallow` for multi-field selectors
- Pattern established: `useGameStore(useShallow(state => ({ field1: state.field1, field2: state.field2 })))`
- This prevents re-renders when the selector object reference changes (which happens on every store update)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All target components now use narrow selectors with shallow comparison
- Pattern established for remaining components (Flags, GameCanvas, shadowStepIndicator, etc.)
- Ready for Phase 1 Plan 3: Memoize expensive calculations

**Note:** Some components still use bare `useGameStore()` calls (Flags, GameCanvas, shadowStepIndicator, HeroSelect, InGameMenu, Lobby, LobbyBrowser, MainLobby, MainMenu, ShadowStepOverlay, UltimateEffects). These were not in scope for this plan but should be updated following the same pattern.

---
*Phase: 01-react-optimization-foundation*
*Plan: 02*
*Completed: 2026-01-22*
