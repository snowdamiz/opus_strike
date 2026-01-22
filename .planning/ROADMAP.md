# Roadmap: Opus Strike Performance Optimization

## Overview

Transform a stuttering React Three Fiber multiplayer game (200ms+ hitches during ability use) into a smooth 60 FPS experience by eliminating React re-renders, implementing instanced rendering, adding object pooling, and consolidating animation loops. The journey follows the dependency hierarchy: eliminate anti-patterns first, then architectural separation of visual/game state, then rendering optimizations, then advanced pooling and scheduling.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: React Optimization Foundation** - Eliminate React-level performance anti-patterns
- [ ] **Phase 2: Visual State Architecture** - Separate high-frequency visual updates from game state
- [ ] **Phase 3: Instanced Rendering** - Reduce draw calls via InstancedMesh for projectiles
- [ ] **Phase 4: Object Pooling System** - Eliminate GC pressure through object reuse
- [ ] **Phase 5: Centralized Animation** - Consolidate 80+ useFrame hooks into managed loop
- [ ] **Phase 6: LOD Enhancement** - Extend distance-based culling for particle effects

## Phase Details

### Phase 1: React Optimization Foundation

**Goal**: Eliminate React-level performance anti-patterns that cause cascading re-renders

**Depends on**: Nothing (first phase)

**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05

**Success Criteria** (what must be TRUE):
1. Game maintains 60 FPS when 3+ players use abilities simultaneously (no hitches above 50ms)
2. React DevTools Profiler shows no component re-rendering more than once per frame during ability use
3. All effect components (RocketEffect, HookshotEffect, etc.) render only when their props actually change
4. No console.log statements execute in production builds
5. Zero temporary objects created per frame in hot code paths (verified via allocation profiling)

**Plans**: 7 plans

Plans:
- [ ] 01-01-PLAN.md — Replace setState calls in useFrame hooks with direct ref mutations
- [ ] 01-02-PLAN.md — Update Zustand subscriptions to narrow selectors with shallow comparison
- [ ] 01-03A-PLAN.md — Add React.memo wrappers to Phantom and Blaze effect components
- [ ] 01-03B-PLAN.md — Add React.memo wrappers to Hookshot and Glacier effect components
- [ ] 01-04A-PLAN.md — Extend TEMP_VECTORS pool and replace object creation in voidRay.tsx
- [ ] 01-04B-PLAN.md — Replace object creation in remaining effect components
- [ ] 01-05-PLAN.md — Remove or wrap all console.log statements for production

### Phase 2: Visual State Architecture

**Goal**: Separate high-frequency visual updates from authoritative game state

**Depends on**: Phase 1

**Requirements**: ARCH-01, ARCH-02, REND-05

**Success Criteria** (what must be TRUE):
1. Player position interpolation updates at 60 FPS without triggering store updates
2. Visual state mutations are invisible to React DevTools (no re-renders from position updates)
3. Real-time FPS/GPU metrics display in corner of screen during gameplay
4. Store only updates on game events (ability fired, player hit), not per-frame position data

**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md — Create visualStore.ts for high-frequency visual data using vanilla Zustand
- [ ] 02-02-PLAN.md — Migrate player position interpolation to visualStore-based updates
- [ ] 02-03-PLAN.md — Add r3f-perf monitoring component to GameCanvas

### Phase 3: Instanced Rendering

**Goal**: Reduce draw calls via InstancedMesh for repeated projectile types

**Depends on**: Phase 2

**Requirements**: REND-01, REND-02

**Success Criteria** (what must be TRUE):
1. 30 rockets on screen render in single draw call (not 30+)
2. r3f-perf shows draw call reduction of 80%+ during heavy ability use
3. All projectile types (rockets, dire balls, hooks) use InstancedMesh pattern
4. Visual quality identical to pre-optimization (no art regression)

**Plans**: 2 plans

Plans:
- [ ] 03-01: Implement InstancedMesh for rockets
- [ ] 03-02: Implement InstancedMesh for hookshot projectiles and other repeated projectiles

### Phase 4: Object Pooling System

**Goal**: Eliminate GC pressure through object reuse for frequently spawned effects

**Depends on**: Phase 3

**Requirements**: REND-03

**Success Criteria** (what must be TRUE):
1. No GC pauses visible in performance profiler during 10-second ability spam test
2. Explosion and particle effects acquire from pool instead of creating new objects
3. Objects return to pool after effect completes (no memory leaks)
4. Pool size auto-adjusts or is configurable per effect type

**Plans**: 1 plan

Plans:
- [ ] 04-01: Implement object pooling system for explosion effects and particles

### Phase 5: Centralized Animation

**Goal**: Consolidate 80+ useFrame hooks into single managed animation loop

**Depends on**: Phase 4

**Requirements**: ARCH-03

**Success Criteria** (what must be TRUE):
1. UseFrame hook count reduced from 80+ to under 10
2. Animation loop executes with priority-based ordering (critical before nice-to-have)
3. All existing effect animations function identically (no behavioral regression)
4. Scheduler overhead visible in profiler is reduced by 50%+

**Plans**: 1 plan

Plans:
- [ ] 05-01: Consolidate useFrame hooks into centralized animation loop with priority system

### Phase 6: LOD Enhancement

**Goal**: Extend distance-based culling to reduce particle rendering load

**Depends on**: Phase 5

**Requirements**: REND-04

**Success Criteria** (what must be TRUE):
1. Distant particle effects (>50 units) render at reduced quality or are culled
2. Visual impact is minimal (player sees no significant quality difference at distance)
3. Vertex count reduced by 30%+ during typical gameplay
4. LOD threshold is configurable per effect type

**Plans**: 1 plan

Plans:
- [ ] 06-01: Extend existing LOD system to cull distant particle effects

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. React Optimization Foundation | 0/7 | Ready to execute | - |
| 2. Visual State Architecture | 0/3 | Ready to execute | - |
| 3. Instanced Rendering | 0/2 | Not started | - |
| 4. Object Pooling System | 0/1 | Not started | - |
| 5. Centralized Animation | 0/1 | Not started | - |
| 6. LOD Enhancement | 0/1 | Not started | - |
