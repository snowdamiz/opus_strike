# Opus Strike Performance Optimization

## What This Is

Performance optimization for an existing real-time multiplayer 3D voxel combat game built with React Three Fiber and Colyseus. The game experiences visible hitching (200ms+ freezes) during ability usage, especially with Blaze (rockets, jetpack, airstrike) and Hookshot (grapple, swing, trap) abilities. The goal is to eliminate these stutters through targeted rendering and state management optimizations.

## Core Value

**Stable 60 FPS during heavy multiplayer combat with no visible hitches**, even with 10 players simultaneously using abilities.

## Requirements

### Validated

*Existing capabilities that must be preserved:*
- ✓ React Three Fiber 3D rendering with shadows, lighting, and effects
- ✓ Zustand state management for game state synchronization
- ✓ Hero ability system (Blaze, Hookshot, Glacier, Phantom)
- ✓ Real-time multiplayer via Colyseus WebSocket (authoritative server, client prediction)
- ✓ Physics integration with Rapier3D
- ✓ Player movement with local prediction and server reconciliation
- ✓ Projectile and effect system (rockets, hooks, explosions, etc.)
- ✓ Shared resource system (geometries, materials via effectResources.ts)

### Active

*Performance improvements to implement:*
- [ ] **REND-01**: Eliminate excessive React re-renders caused by store updates during abilities
- [ ] **REND-02**: Reduce store update frequency for high-frequency data (player position, projectile movement)
- [ ] **REND-03**: Implement React.memo for all effect components (RocketEffect, HookshotEffect, etc.)
- [ ] **REND-04**: Consolidate 80+ useFrame hooks into centralized animation loop to reduce scheduling overhead
- [ ] **REND-05**: Implement object pooling for frequently created/destroyed effects (rockets, projectiles, particles)
- [ ] **REND-06**: Remove console.log statements from production code (blocks main thread)
- [ ] **REND-07**: Batch store updates to prevent cascading re-renders
- [ ] **REND-08**: Evaluate instancing for projectiles (one mesh, many instances) instead of per-component rendering

### Out of Scope

*Explicitly excluded from this optimization work:*
- Changing game mechanics or abilities — optimizing rendering, not gameplay
- Server-side optimization — focused on client-side rendering stutters
- Complete rendering engine rewrite — improvements within existing React Three Fiber architecture
- Adding new features — performance only

## Context

**Current architecture:**
- Monorepo with pnpm, separate client/server/apps
- Client: React 18 + React Three Fiber 8 + Three.js 0.169
- Server: Express + Colyseus 0.15 for WebSocket multiplayer
- State: Zustand store with slice pattern (projectiles, glacier, etc.)
- Physics: Rapier3D with local prediction and server reconciliation

**Root causes identified (from codebase exploration):**

1. **Excessive React re-renders (CRITICAL)**
   - Every projectile/effect add/remove triggers Zustand store update
   - Store updates notify ALL subscribed components
   - Effect managers re-render on every projectile change
   - Arrays copied on every update (`[...state.rockets, rocket]`)

2. **Store update frequency**
   - Player position updates 60+ times per second via `useFrame`
   - Ability firing = rapid store updates (5-10/second per player)
   - No batching of updates
   - Cleanup intervals running every 150ms

3. **Per-component rendering overhead**
   - Each rocket = 6 meshes × 30 max rockets = 180+ meshes
   - Jetpack = 21+ meshes when active
   - No instancing — each projectile is separate React component
   - React reconciliation overhead scales with entity count

4. **useFrame callback explosion**
   - 80+ separate useFrame hooks across components
   - Each rocket/effect has its own animation loop
   - Scheduler overhead dominates during heavy ability usage

5. **Missing React optimizations**
   - No React.memo on effect components
   - State updates in useFrame (`setActiveEffects` in Effects.tsx)
   - Targeting indicators raycasting every frame

**Existing optimizations (good foundations):**
- Shared geometry/material system (effectResources.ts)
- Pre-allocated temp vectors to avoid GC
- Some useRef-based updates (good pattern)
- useEffectLOD distance-based culling
- Direct Three.js manipulation in some effects

## Constraints

- **No breaking changes to gameplay** — optimizations must preserve existing ability mechanics and feel
- **Stay within React Three Fiber** — not switching rendering engines, optimizing existing approach
- **Preserve multiplayer integrity** — client-side changes must not break state sync with server
- **Maintain codebase patterns** — follow existing shared resource and ref-based animation patterns where appropriate

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Prioritize React-level optimizations first | Most overhead comes from reconciliation/re-renders, not Three.js itself | — Pending |
| Object pooling for projectiles | Rockets, hooks created/destroyed frequently → GC pressure | — Pending |
| Separate visual state from game state | High-frequency visual updates shouldn't trigger game state re-renders | — Pending |

---
*Last updated: 2026-01-22 after initialization*
