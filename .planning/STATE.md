# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-22)

**Core value:** Stable 60 FPS during heavy multiplayer combat with no visible hitches
**Current focus:** Phase 2 - Visual State Architecture

## Current Position

Phase: 2 of 6 (Visual State Architecture)
Plan: 5 of 5 in current phase
Status: Phase complete
Last activity: 2026-01-22T11:36:35Z — Completed 02-05: In-Place Map Updates for Player Position Data

Progress: [█████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 12
- Average duration: 121s
- Total execution time: 0.403 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 - React Optimization Foundation | 7 | 7 | 134s |
| 02 - Visual State Architecture | 5 | 5 | 91s |

**Recent Trend:**
- Last 3 plans: 219s (02-05), 103s (02-04), 62s (02-03)
- Trend: Phase 2 complete

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- **Ref-based state for useFrame hooks** (01-01): Use `useRef` instead of `useState` for high-frequency data updated in useFrame. Use version counters to trigger re-renders only when data structures change, not every frame.
- **useShallow pattern for Zustand multi-field selectors** (01-02): Import `useShallow` from `zustand/shallow`, wrap selector as `useShallow(state => ({ field1: state.field1, ... }))` to prevent re-renders on object reference changes
- **Effect managers subscribe only to specific effect arrays** (01-02): Each effect manager (HookshotEffects, BlazeEffects, etc.) uses narrow selectors to avoid re-rendering when unrelated state changes
- **TEMP_VECTORS pool extended to v5-v10** (01-04A): Added 6 additional generic vectors plus 4 named semantic vectors (tempPos, tempDir, tempScale, tempRot) to support parallel effect calculations without conflicts
- **Zero-allocation pattern established** (01-04A): useFrame calculations must use TEMP_VECTORS.vX.set() instead of new THREE.Vector3() to eliminate per-frame GC pressure
- **Console stripping via esbuild drop** (01-05): Configure `esbuild: { drop: ['console', 'debugger'] }` in vite.config.ts for production builds. Removes all console statements at compile-time with zero runtime overhead. Use `process.argv.includes('build')` to detect production mode.
- **Zero-allocation pattern complete across all effects** (01-04B): All remaining effect components (swingLine) now use TEMP_VECTORS pool. Module-level vectors accepted for rockets/bomb (created once, not per-frame). useMemo allocations acceptable for static rotation (only runs on dependency change).
- **React.memo pattern for effect components** (01-03A): All Phantom and Blaze effect components wrapped in React.memo with custom comparison functions. Custom comparison checks primitive x/y/z values instead of object references to prevent re-renders when parent managers update.
- **React.memo with ID-based comparison for Hookshot/Glacier effects** (01-03B): Hookshot and Glacier effect components wrapped in React.memo with custom comparison on ID fields (hook.id, wall.id, etc.) since effect data is immutable after creation. WallSegment sub-component compares on index and position primitives.
- **Vanilla Zustand store for visual state** (02-01): Use `createStore` from `zustand/vanilla` for visual state that can be mutated at 60fps without triggering React re-renders. Access via `visualStore.getState()` in useFrame hooks.
- **Map-based player tracking in visualStore** (02-01): Use `Map<string, {x, y, z}>` for player positions/rotations instead of arrays for O(1) lookup by playerId and efficient add/remove operations.
- **Plain objects for visual position data** (02-01): Use `{x: number; y: number; z: number}` instead of THREE.Vector3 in VisualState interface. Simpler, no dependency issues, components convert to THREE.Vector3 as needed during interpolation.
- **Fallback to props when visualStore doesn't have data** (02-02): OtherPlayers falls back to prop-based position/rotation if visualStore doesn't have the player data yet. Ensures robustness during initial sync and handles edge cases.
- **Update visualStore after authoritative state updates** (02-02): VisualStore updates happen after gameStore set() calls complete. Visual state derives from authoritative game state, maintaining separation of concerns.
- **Local player visual updates after physics** (02-02): PlayerController updates visualStore after updateLocalPlayer() which happens after physics. Ensures visual representation matches local player's simulated position.
- **r3f-perf for performance monitoring** (02-03): Use r3f-perf library for React Three Fiber-specific performance metrics (FPS, GPU time, triangle count, geometries). Provides browser DevTools can't show R3F-internal metrics.
- **Top-left positioning for PerfMonitor** (02-03): PerfMonitor positioned in top-left corner of canvas for visibility during gameplay without obstructing center screen action.
- **Non-minimal mode for detailed metrics** (02-03): PerfMonitor uses minimal={false} to show detailed metrics including FPS, GPU time, triangle count, geometries, textures, and shaders during development.
- **Per-frame position data flows ONLY to visualStore** (02-04): Local player position/velocity/rotation updates in useFrame go exclusively to visualStore (non-reactive). gameStore.updateLocalPlayer() in per-frame loop only tracks movement state flags (isGrounded, isSprinting, isCrouching, isSliding, slideTimeRemaining).
- **Game state tracks discrete events, not continuous data** (02-04): gameStore is for game events (abilities fired, player hit, flag capture, spawn), not per-frame position updates. One-time position updates (spawn initialization) correctly use gameStore as game events.
- **In-place Map mutation for position updates** (02-05): updateGameState() preserves the players Map reference by updating existing player object properties in-place instead of creating a new Map. Only creates new Map when players are removed (structural change). Prevents React re-renders in components subscribed to gameStore.players when network players move.

### Pending Todos

- Update remaining components with bare `useGameStore()` calls: Flags, GameCanvas, shadowStepIndicator, HeroSelect, InGameMenu, Lobby, LobbyBrowser, MainLobby, MainMenu, ShadowStepOverlay, UltimateEffects

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-01-22T11:36:35Z
Stopped at: Completed 02-05-PLAN.md (In-Place Map Updates for Player Position Data)
Resume file: None
