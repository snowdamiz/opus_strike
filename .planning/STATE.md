# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-22)

**Core value:** Stable 60 FPS during heavy multiplayer combat with no visible hitches
**Current focus:** Phase 1 - React Optimization Foundation

## Current Position

Phase: 1 of 6 (React Optimization Foundation)
Plan: 4B of 5 in current phase
Status: In progress
Last activity: 2026-01-22T10:22:44Z — Completed 01-04B: Zero-Allocation Effect Components (Remaining)

Progress: [████░░░░░░░] 80%

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: 117s
- Total execution time: 0.162 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 - React Optimization Foundation | 5 | 5 | 117s |

**Recent Trend:**
- Last 3 plans: 150s (01-02 alt), 546s (01-05), 122s (01-04B)
- Trend: On track for Phase 1

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

### Pending Todos

- Update remaining components with bare `useGameStore()` calls: Flags, GameCanvas, shadowStepIndicator, HeroSelect, InGameMenu, Lobby, LobbyBrowser, MainLobby, MainMenu, ShadowStepOverlay, UltimateEffects

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-01-22T10:22:44Z
Stopped at: Completed 01-04B-PLAN.md (Zero-Allocation Effect Components - Remaining)
Resume file: None
