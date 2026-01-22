# Requirements: Opus Strike Performance Optimization

**Defined:** 2026-01-22
**Core Value:** Stable 60 FPS during heavy multiplayer combat with no visible hitches

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation

Critical React-level optimizations. Without these, performance is unacceptable.

- [ ] **FND-01**: Replace all setState calls in useFrame hooks with direct ref mutations
- [ ] **FND-02**: Update all Zustand store subscriptions to use narrow selectors with shallow comparison
- [ ] **FND-03**: Add React.memo wrapper to all effect components (RocketEffect, HookshotEffect, ExplosionEffect, etc.)
- [ ] **FND-04**: Replace object creation in useFrame with pre-allocated temp vector reuse
- [ ] **FND-05**: Remove or wrap all console.log statements in production code (57 occurrences found)

### Rendering

Rendering optimizations to reduce draw calls and GPU overhead.

- [ ] **REND-01**: Implement InstancedMesh for rockets (single draw call for all rockets)
- [ ] **REND-02**: Implement InstancedMesh for hookshot projectiles and other repeated projectiles
- [ ] **REND-03**: Implement object pooling system for explosion effects and particles
- [ ] **REND-04**: Extend existing LOD system to cull distant particle effects
- [ ] **REND-05**: Add r3f-perf monitoring component for real-time FPS/GPU metrics

### Architecture

Structural changes to separate high-frequency visual updates from game state.

- [ ] **ARCH-01**: Create visualStore.ts for high-frequency visual data (60fps mutations)
- [ ] **ARCH-02**: Migrate player position interpolation to use ref-based updates instead of store updates
- [ ] **ARCH-03**: Consolidate 80+ useFrame hooks into centralized animation loop with priority-based system

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Adaptive Quality

- **ADAPT-01**: Implement adaptive quality scaling to auto-reduce shadow resolution during heavy combat
- **ADAPT-02**: Implement dynamic particle count adjustment based on FPS
- **ADAPT-03**: Add adaptive rendering distance scaling

### Advanced Monitoring

- **MON-02**: Implement performance regression testing in CI/CD
- **MON-03**: Add user telemetry for performance metrics

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| WebGPU migration | Experimental in 2025, limited browser support. Current bottleneck is React, not GPU. |
| R3F v9 upgrade | Currently in alpha/beta with breaking changes. v8 is stable and sufficient. |
| Gameplay mechanics changes | Optimizing rendering, not changing ability behavior or game feel. |
| Server-side optimization | Focus on client-side rendering stutters. Server performance is separate concern. |
| ECS pattern (miniplex) | Significant refactor. Evaluate only if current architecture proves insufficient. |
| Compute shaders | Overkill for current scale. Defer until hitting performance walls with standard optimizations. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 | Pending |
| FND-02 | Phase 1 | Pending |
| FND-03 | Phase 1 | Pending |
| FND-04 | Phase 1 | Pending |
| FND-05 | Phase 1 | Pending |
| ARCH-01 | Phase 2 | Pending |
| ARCH-02 | Phase 2 | Pending |
| REND-05 | Phase 2 | Pending |
| REND-01 | Phase 3 | Pending |
| REND-02 | Phase 3 | Pending |
| ARCH-03 | Phase 4 | Pending |
| REND-03 | Phase 4 | Pending |
| REND-04 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0 ✓

---
*Requirements defined: 2026-01-22*
*Last updated: 2026-01-22 after initial definition*
