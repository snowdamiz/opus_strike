# Feature Landscape: React Three Fiber Performance Optimization

**Domain:** React Three Fiber Game Performance
**Researched:** 2025-01-22
**Overall confidence:** HIGH

## Executive Summary

React Three Fiber games have well-established performance patterns. The core issues in Opus Strike align with common anti-patterns: excessive React re-renders from store updates, per-component rendering instead of instancing, and state mutations inside the render loop. The recommended optimizations follow a clear hierarchy: eliminate unnecessary re-renders first (table stakes), then implement instancing for projectiles, then add advanced features like object pooling and compute shaders.

## Table Stakes

Features users expect. Missing = performance is unacceptable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **useFrame mutations, not setState** | R3F performance pitfall #1 - calling setState in useFrame triggers React re-renders for every frame | Low | Official R3F docs explicitly warn against this. Source: [r3f.docs.pmnd.rs/advanced/pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls) |
| **Zustand selector optimization** | Prevents cascading re-renders when store updates | Low | Using `useGameStore()` without selectors causes ALL subscribers to re-render on ANY change. Source: [Zustand Best Practices](https://github.com/pmndrs/zustand/discussions/3153) |
| **Shared geometries/materials** | GPU resource compilation is expensive | Low | Already partially implemented in `effectResources.ts`. Each unique material = new shader compile. Source: [100 Three.js Best Practices #37](https://www.utsubo.com/blog/threejs-best-practices-100-tips) |
| **Object reuse in useFrame** | Creating objects in useFrame triggers GC pauses | Low | "Never create objects inside useFrame" - R3F official docs. Reuse vectors/matrices. Source: [r3f.docs.pmnd.rs/advanced/pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls) |
| **Frameloop="demand" for static content** | Saves battery on mobile, reduces CPU/GPU when idle | Low | For game: always render, but UI elements can use demand. Source: [r3f.docs.pmnd.rs/advanced/scaling-performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance) |
| **React.memo on expensive components** | Prevents unnecessary re-renders of heavy subtrees | Low | Wrap effect components that don't need to re-render on every store update. Source: [React Performance Guide 2025](https://medium.com/@pawantripathi648/react-performance-optimization-a-complete-guide-for-2025-216b9c3a9400) |
| **Visibility toggle vs mount/unmount** | Remounting recreates buffers and recompiles shaders | Low | "Toggle visibility instead of remounting" - R3F best practice #71. Source: [100 Three.js Best Practices #71](https://www.utsubo.com/blog/threejs-best-practices-100-tips) |
| **Limit active lights to 3 or fewer** | Each additional light adds O(objects) complexity | Low | PointLight shadows = 6 shadow map renders per light. Source: [100 Three.js Best Practices #53](https://www.utsubo.com/blog/threejs-best-practices-100-tips) |

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **InstancedMesh for projectiles** | 1,000 rockets = 1 draw call instead of 1,000. 10x-100x performance improvement | Medium | Core optimization for ability stutters. Current code renders per-component. Source: [100 Three.js Best Practices #31](https://www.utsubo.com/blog/threejs-best-practices-100-tips) |
| **Object pooling for spawned entities** | Eliminates allocation overhead and GC pauses during ability spam | Medium | "Pool instead of creating new" for bullets, particles, explosions. Source: [100 Three.js Best Practices #39](https://www.utsubo.com/blog/threejs-best-practices-100-tips) |
| **Level of Detail (LOD) system** | Reduces vertex count by 30-40% for distant effects | Medium | Already partially implemented in `useEffectLOD.ts`. Can be extended. Source: [100 Three.js Best Practices #26](https://www.utsubo.com/blog/threejs-best-practices-100-tips) |
| **Performance monitoring (r3f-perf)** | Real-time FPS/GPU metrics catch regressions early | Low | Drop-in monitoring component. Source: [100 Three.js Best Practices #72](https://www.utsubo.com/blog/threejs-best-practices-100-tips) |
| **Adaptive quality scaling** | Maintains 60fps during heavy effects by reducing quality | High | Auto-reduce shadow resolution, particle count during combat. Source: [r3f docs - Movement Regression](https://r3f.docs.pmnd.rs/advanced/scaling-performance) |
| **BatchedMesh for varied geometries** | Combine different geometries with same material into single draw call | Medium | Since Three.js r156. Alternative to InstancedMesh. Source: [100 Three.js Best Practices #32](https://www.utsubo.com/blog/threejs-best-practices-100-tips) |

## Anti-Features

Features to explicitly NOT build. Common mistakes in this domain.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **setState inside useFrame** | Routes every-frame updates through React scheduler, triggering component renders | Use ref mutations: `meshRef.current.position.x += delta` |
| **Per-component projectile rendering** | 30 rockets = 30 draw calls + 30 React components | Use InstancedMesh with single draw call |
| **Creating Vectors in useFrame** | "new Vector3()" 60x/sec = GC pauses | Reuse pre-allocated vectors via useMemo or global TEMP_VECTORS |
| **Individual materials per instance** | Each material = shader compile, GPU memory | Share materials via SHARED_GEOMETRIES pattern |
| **Updating entire store for position** | All store subscribers re-render 60fps | Use direct refs for position, store only for authoritative state |
| **React.reconciler() for game state** | React not designed for 60fps game state updates | Use useFrame mutations for visuals, store for network sync |
| **Multiple useFrame for same effect** | Unnecessary scheduling overhead (though R3F handles this well) | Single useFrame per component is fine; don't micro-optimize prematurely |
| **Deleting and recreating effects** | Mount/unmount = buffer recreation, shader recompile | Object pooling with visible/invisible toggle |

## Feature Dependencies

```
Table Stakes (must do first)
+----------------------------+
| 1. Zustand selectors       | --> Prevents cascading re-renders
| 2. useFrame mutations      | --> Eliminates React scheduler overhead
| 3. React.memo on effects   | --> Prevents unnecessary renders
+----------------------------+
              |
              v
Differentiators (build on table stakes)
+----------------------------+
| 4. InstancedMesh           | --> Requires shared geometries (from #3)
| 5. Object pooling          | --> Requires stable refs (from #2)
| 6. LOD system              | --> Requires distance calculations
+----------------------------+
              |
              v
Advanced (post-MVP)
+----------------------------+
| 7. Adaptive quality        | --> Requires performance monitoring
| 8. WebGPU compute shaders  | --> Future-proofing, optional
+----------------------------+
```

## MVP Recommendation

For MVP (eliminating ability stutters), prioritize in order:

**Phase 1 - Critical (Do first)**
1. Zustand selector optimization - highest impact, lowest complexity
2. Eliminate setState in useFrame hooks - use ref mutations
3. Add React.memo to effect components (RocketsManager, Explosions, etc.)

**Phase 2 - High Impact**
4. Implement InstancedMesh for rockets (biggest win for projectiles)
5. Implement InstancedMesh for dire balls and other repeated projectiles
6. Object pooling for explosion effects (reuse explosion objects)

**Phase 3 - Polish**
7. Extend LOD system for particle effects
8. Add r3f-perf monitoring
9. Adaptive quality scaling

Defer to post-MVP:
- WebGPU migration (requires significant refactoring)
- Compute shaders for particle physics (overkill for current scale)
- BatchedMesh (InstancedMesh sufficient for current needs)

## Current Codebase Analysis

**Existing Good Patterns** (keep these):
- `SHARED_GEOMETRIES` in `effectResources.ts` - excellent pattern
- `TEMP_VECTORS` for avoiding GC - good, but underutilized
- Material caching via `getCachedMaterial` - solid pattern
- `useEffectLOD` hook - foundation is there

**Existing Anti-Patterns** (fix these):
- `RocketsManager` uses `.map(rocket => <RocketEffect key={rocket.id} ...>)` - should be InstancedMesh
- `updateLocalPlayer` called in useFrame - triggers store updates 60fps
- 80+ useFrame hooks across components - though R3F handles this well, consider consolidation
- No React.memo on effect components
- Per-projectile React components instead of instancing

## Complexity Notes

| Optimization | Implementation Complexity | Performance Impact | Risk |
|--------------|---------------------------|-------------------|------|
| Zustand selectors | Low - refactor store access | Very High | Low |
| useFrame mutations | Low - change setState to ref | High | Low |
| React.memo | Low - add wrapper | Medium | Low |
| Shared geometries | Low - already partially done | Medium | Low |
| InstancedMesh | Medium - API changes | Very High | Medium |
| Object pooling | Medium - state management | High | Medium |
| LOD system | Medium - distance checks | Medium | Low |
| Adaptive quality | High - performance detection | Medium | High |

## Sources

### HIGH Confidence (Official Documentation)
- [React Three Fiber - Performance Pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls) - Official R3F docs on performance
- [React Three Fiber - Scaling Performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance) - Official R3F scaling guide
- [100 Three.js Best Practices (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips) - Comprehensive 2026 guide

### MEDIUM Confidence (Community Verified)
- [Three.js InstancedMesh Documentation](https://threejs.org/docs/#api/en/objects/InstancedMesh.setMatrixAt) - Official Three.js API
- [Zustand Performance Discussion](https://github.com/pmndrs/zustand/discussions/3153) - Large scale app best practices (June 2025)
- [React Performance Optimization 2025](https://medium.com/@pawantripathi648/react-performance-optimization-a-complete-guide-for-2025-216b9c3a9400) - Modern React patterns

### LOW Confidence (Community Articles)
- Various Medium/dev.to articles on R3F optimization - consistent patterns but less authoritative
- Chinese language articles on InstancedMesh - technical depth but language barrier for verification

## Gaps to Address

- **WebGPU migration timing**: Current WebGL2 approach is fine, but WebGPU offers 2-10x improvements for compute-heavy scenes. Defer until hitting performance walls.
- **BatchedMesh vs InstancedMesh**: For Opus Strike, InstancedMesh is sufficient (same geometry, different transforms). BatchedMesh only needed if geometries vary significantly.
- **React 19 features**: New features like `useOptimistic` may help with networked game state. Research during implementation phase.
