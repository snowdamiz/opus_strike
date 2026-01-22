# Stack Research: React Three Fiber Performance Optimization

**Project:** Opus Strike Performance Optimization
**Researched:** 2025-01-22
**Confidence:** HIGH

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| React Three Fiber | ^8.17.10 | 3D rendering framework | Current stable version (v8.x). Your project uses 8.17.10. v9 is in alpha/beta - wait for stable. Official docs provide comprehensive performance guidance. |
| Three.js | ^0.169.0 | 3D engine | Your current version. InstancedMesh API stable since r150+. WebGPU renderer available but experimental. |
| React | ^18.3.1 | UI framework | Your current version. Concurrent rendering enables `startTransition` for expensive operations. |
| Zustand | ^4.x | State management | Already in use. Critical: Must use selector pattern to prevent re-renders. |
| Colyseus.js | Latest | Multiplayer networking | Already in use. Keep 20Hz server updates separate from 60fps visual updates. |

### Performance Libraries

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| @react-three/drei | ^9.x | R3F helper library | Provides `<Instances />`, `<PerformanceMonitor />`, `<AdaptiveDpr />`, `<Detailed />` for LOD. Your project already uses this. |
| r3f-perf | ^7.x | Performance monitoring | Drop-in FPS/GPU monitoring. Latest version 7.2.3+. Critical for catching regressions during optimization. |
| @react-three/postprocessing | ^2.x | Post-processing effects | Use sparingly. Bloom, SSAO, SMAA merge effects into fewer passes than manual setup. |

### State Management Patterns

| Pattern | Purpose | When to Use |
|---------|---------|-------------|
| Selective Zustand selectors | Prevent cascading re-renders | ALL store subscriptions. Use `shallow` for arrays. |
| Visual state separation | High-freq updates without React re-renders | 60fps position updates, animation states |
| Direct store.getState() | Read-only access in useFrame | Inside useFrame only, never subscribe |

### Development Tools

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| r3f-perf | ^7.x | FPS/GPU profiling | During ALL optimization work. Remove in production builds. |
| Spector.js | Latest | WebGL frame capture | Debugging draw calls, shader issues. Browser extension. |
| React DevTools Profiler | Built-in | React render profiling | Identifying unnecessary re-renders |
| stats.js/stats-gl | Latest | Minimal FPS counter | Quick checks, lighter than r3f-perf |

## Installation

```bash
# Core (already installed, keep current versions)
npm install @react-three/fiber@8.17.10 three@0.169.0 react@18.3.1 zustand@4

# Performance helpers (already installed)
npm install @react-three/drei@9

# Performance monitoring (ADD for optimization phase)
npm install r3f-perf

# Optional post-processing (if needed)
npm install @react-three/postprocessing@2

# Dev dependencies
npm install -D @types/three
```

## Current Stack Analysis

### Keep (No Changes Needed)
- **@react-three/fiber@8.17.10** - Stable v8, solid for production
- **three@0.169.0** - Recent stable, InstancedMesh mature
- **@react-three/drei** - Already using, has performance utilities
- **zustand** - Right choice, needs selector optimization
- **vite** - Build tool, performs well

### Add (For Optimization)
- **r3f-perf** - Essential for measuring improvement
- **@react-three/postprocessing** - Only if needed for effects

### DO NOT Upgrade
- **React Three Fiber to v9** - Currently in alpha/beta. Breaking changes, not production-ready.
- **Three.js WebGPU renderer** - Experimental, limited browser support. Defer until 2026.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not Alternative |
|----------|-------------|-------------|---------------------|
| State Management | Zustand (selectors) | Redux Toolkit | Redux boilerplate overkill. Zustand is from same team as R3F (pmndrs), designed for this use case. |
| Performance Monitoring | r3f-perf | React DevTools Profiler | DevTools can't see GPU time, draw calls, or Three.js-specific metrics. r3f-perf shows `calls` (meshes rendered), GL programs, memory. |
| Instancing | THREE.InstancedMesh | Individual meshes | Draw calls: 1 vs 100+. Your projectiles MUST use instancing. |
| Animation | useFrame + mutation | react-spring | Spring animations great for UI, but game loop (60fps positions) should use direct mutation in useFrame. |
| Post-processing | @react-three/postprocessing | Three.js EffectComposer | Drei's wrapper merges effects into fewer passes, easier setup with R3F. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `useState` inside `useFrame` | Triggers React re-render 60fps. Completely defeats R3F design. | `useRef` + direct mutation |
| `new THREE.Vector3()` in `useFrame` | Creates 60+ objects/second, GC pressure causes stutter. | Pre-allocated temp vectors |
| Subscribing to entire Zustand store | Every store update re-renders ALL components. | Narrow selectors with `shallow` |
| Conditional mounting for effects | Mount/unmount re-creates materials/geometries (expensive). | `visible` prop to hide |
| R3F v9 (alpha/beta) | Breaking changes, unstable. | Stay on v8.x until stable |
| WebGPU renderer (2025) | Experimental, poor browser support. | WebGL renderer (current) |
| Point lights per projectile | 5+ lights kills FPS. | Single shared light or baked lighting |

## Stack Patterns by Variant

### If targeting 60fps on mid-range devices:
- Use `<AdaptiveDpr />` from Drei to scale pixel ratio based on performance
- Limit shadow map resolution to 1024 or 2048
- Use `<Detailed />` for LOD on distant objects
- Cap particle counts based on `<PerformanceMonitor />` feedback

### If targeting 60fps on high-end only:
- Use r3f-perf to ensure no unnecessary draw calls
- Still use InstancedMesh for projectiles (non-negotiable)
- Can enable higher shadow resolution
- More particle effects acceptable

### If mobile support required:
- `<AdaptiveDpr />` becomes critical (start at 1.0, can drop to 0.5)
- Use `<PerformanceMonitor />` with aggressive thresholds
- Consider `frameloop="demand"` for static scenes
- Reduce particle counts by 50%

## Version Compatibility

| Package | Compatible With | Notes |
|-----------|-----------------|-------|
| @react-three/fiber@8.17.x | three@0.160-0.171 | Your 0.169.0 is perfect. Three.js 0.172+ may have issues. |
| @react-three/drei@9.x | @react-three/fiber@8.x | Drei v9 is for Fiber v8. |
| r3f-perf@7.x | @react-three/fiber@8.x | Tested with Fiber 8.x. |
| @react-three/postprocessing@2.x | @react-three/fiber@8.x | Postprocessing v2 for Fiber v8. |

## Critical Stack Decisions for This Project

### 1. Keep Current Three.js/R3F Versions
**Rationale:** You're on stable versions (R3F 8.17.10, Three 0.169.0). Upgrading to R3F v9 (alpha) during performance optimization is reckless. The v8 API is stable, well-documented, and your issues are anti-patterns, not version bugs.

### 2. Add r3f-perf Immediately
**Rationale:** Can't optimize what you can't measure. r3f-perf shows:
- FPS (target: 60)
- `calls` (meshes rendered - target: minimize)
- GPU memory
- Custom data tracking

Usage:
```tsx
import { Perf } from 'r3f-perf'

<Canvas>
  <Perf position="top-left" />
  {/* ... rest of scene */}
</Canvas>
```

### 3. NO WebGPU Migration
**Rationale:** WebGPU is immature (2025). Browser support is ~60% and growing, but you don't need it. Your bottleneck is React re-renders, not GPU throughput. WebGPU is a 2026+ consideration.

### 4. Use Drei's Performance Utilities
Already available in @react-three/drei:
- `<PerformanceMonitor />` - Detect performance degradation and react
- `<AdaptiveDpr />` - Auto-adjust pixel ratio
- `<Instances />` - Wrapper around THREE.InstancedMesh (but verify performance vs native)
- `<Detailed />` - LOD for distant objects

## Performance Monitoring Strategy

### Phase 1 (Baseline)
```tsx
import { Perf } from 'r3f-perf'

<Canvas>
  <Perf position="top-left" overClock={false} />
  {/* existing scene */}
</Canvas>
```
- Record baseline FPS, calls, memory
- Identify stutter patterns

### Phase 2 (During Optimization)
```tsx
import { Perf } from 'r3f-perf'

<Canvas>
  <Perf
    position="top-left"
    deepAnalyze={true}  // More detailed GL info
    matrixUpdate={true} // Track matrixWorld calls
  />
  {/* optimized scene */}
</Canvas>
```
- Verify improvements
- Catch regressions

### Production
- Remove `<Perf />` component
- Or use conditional: `{import.meta.env.DEV && <Perf />}`

## Sources

### Official Documentation (HIGH Confidence)
- [React Three Fiber - Performance Pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls) - Official anti-patterns guide. Covers setState in loops, object creation, mount costs.
- [React Three Fiber - Scaling Performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance) - Official performance guide. Covers instancing, LOD, on-demand rendering.
- [Poimandres Documentation](https://docs.pmnd.rs/) - Index of pmndrs/* libraries including Zustand, Drei.

### Package Repositories (HIGH Confidence)
- [r3f-perf GitHub](https://github.com/utsuboco/r3f-perf) - Official repo. Latest version 7.2.3.
- [@react-three/drei GitHub](https://github.com/pmndrs/drei) - Official repo. Latest is v9.x.
- [React Three Fiber Releases](https://github.com/pmndrs/react-three-fiber/releases) - v8.17.10 is latest stable. v9 is alpha.

### Performance Guides (MEDIUM Confidence)
- [100 Three.js Best Practices (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips) - Comprehensive guide. Tip #72 specifically recommends r3f-perf.
- [Building Efficient Three.js Scenes (Feb 2025)](https://tympanus.net/codrops/2025/02/11/building-efficient-three-js-scenes-optimize-performance-while-maintaining-quality/) - Recent guide on Fiber + Drei optimization.
- [R3F-Perf Tutorial](https://sbcode.net/react-three-fiber/r3f-perf/) - Usage guide showing `calls` metric for draw call analysis.

### Community Discussions (MEDIUM Confidence)
- [R3F Instances Performance Issue #3306](https://github.com/pmndrs/react-three-fiber/issues/3306) - Discusses performance drops with Drei Instances. Verify for your use case.
- [How to improve three.js performance with R3F](https://discourse.threejs.org/t/how-to-improve-three-js-performance-with-react-three-fiber/69562) - Real-world optimization discussion.

### Three.js Documentation (HIGH Confidence)
- [Three.js Docs](https://threejs.org/docs/) - Core API reference. InstancedMesh documentation.

---

*Stack research for: React Three Fiber Performance Optimization*
*Researched: 2025-01-22*
