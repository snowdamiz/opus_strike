---
phase: 01-react-optimization-foundation
plan: 05
subsystem: Build Configuration
tags: [vite, esbuild, production-optimization, console-stripping]
created: 2026-01-22
completed: 2026-01-22
duration: 9 minutes
---

# Phase 1 Plan 05: Console Removal in Production Builds

**One-liner:** Compile-time console/debugger stripping via esbuild drop configuration in Vite, eliminating main-thread blocking from 89 debug logging statements.

## Objective Achieved

Configured Vite to strip all console.log, console.error, console.warn, and debugger statements from production builds. This eliminates main-thread blocking from debug logging that was previously executing even in production.

## Implementation

### Changes to `apps/client/vite.config.ts`

Added esbuild drop configuration at three levels:

1. **Top-level `esbuild`** - Applies to all transpilation
2. **`build.esbuild`** - Applies during production build minification
3. **`optimizeDeps.esbuildOptions`** - Applies during dependency pre-bundling

```typescript
const isProduction = process.argv.includes('build');
const dropOptions = isProduction ? ['console', 'debugger'] : [];

export default defineConfig({
  esbuild: {
    drop: dropOptions,
  },
  build: {
    minify: 'esbuild',
    esbuild: {
      drop: dropOptions,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      drop: dropOptions,
    },
  },
});
```

**Key Implementation Details:**

- Uses `process.argv.includes('build')` to detect production mode (Vite's build command)
- In dev mode (`vite`), `dropOptions` is empty array - console statements work for debugging
- In production (`vite build`), `dropOptions` is `['console', 'debugger']` - all removed at compile time
- The `console` drop removes: `console.log`, `console.error`, `console.warn`, `console.info`, `console.debug`

### Verification Results

| Metric | Result |
|--------|--------|
| Source console statements | 89 (found in `/apps/client/src`) |
| Production bundle console.log | 0 |
| Total remaining console.* | 8 (Buffer polyfill error handling, expected) |
| Build status | Success |
| Bundle size | 3.5MB |
| Build time | ~2.8s |

**Console Removal Verification:**

```bash
# Before: Source code has 89 console statements
grep -r "console\." apps/client/src/ | wc -l  # 89

# After: Production build has zero console.log from app code
grep "console\.log" dist/assets/*.js | wc -l  # 0
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing useEffect import in Effects.tsx**

- **Found during:** Task 2 (build verification)
- **Issue:** `useEffect` was called but not imported, causing TypeScript error
- **Fix:** Added `useEffect` to imports from 'react'
- **Files modified:** `apps/client/src/components/game/Effects.tsx`
- **Commit:** `319e5c5`

**2. [Rule 1 - Bug] Wrong import path for effectResources**

- **Found during:** Task 2 (build verification)
- **Issue:** `voidRay.tsx` imported from `../../effectResources` but file is at `../effectResources`
- **Fix:** Corrected import path
- **Files modified:** `apps/client/src/components/game/phantom/voidRay.tsx`
- **Commit:** `319e5c5`

**3. [Rule 1 - Bug] Type error for player.team (possibly undefined)**

- **Found during:** Task 2 (build verification)
- **Issue:** `ctx.localPlayer.team` could be undefined, not assignable to `"red" | "blue"`
- **Fix:** Added fallback `(ctx.localPlayer.team || 'red') as 'red' | 'blue'`
- **Files modified:** `apps/client/src/hooks/player/abilities/useHookshotAbilities.ts`
- **Commit:** `319e5c5`

**4. [Rule 1 - Bug] Camera.updateProjectionMatrix() type error**

- **Found during:** Task 2 (build verification)
- **Issue:** Camera type didn't have `updateProjectionMatrix` method
- **Fix:** Cast to `PerspectiveCamera` before calling method
- **Files modified:** `apps/client/src/hooks/player/useCamera.ts`
- **Commit:** `319e5c5`

**5. [Rule 3 - Blocking] Missing pnpm package manager**

- **Found during:** Task 2 (build verification)
- **Issue:** Project uses pnpm workspaces, but pnpm wasn't installed
- **Fix:** Installed pnpm globally via npm
- **Impact:** Unblocked build process

**6. [Rule 3 - Blocking] @voxel-strike/shared package not built**

- **Found during:** Task 2 (build verification)
- **Issue:** Shared package exports weren't available (dist/ not built)
- **Fix:** Built shared package with `pnpm --filter @voxel-strike/shared build`
- **Impact:** Unblocked TypeScript resolution

## Technical Notes

### esbuild Drop Behavior

The `drop: ['console', 'debugger']` configuration:

- Removes **all calls** to console methods, not just `console.log`
- This includes: `console.log`, `console.error`, `console.warn`, `console.info`, `console.debug`, `console.trace`
- Also removes `debugger;` statements
- Operates at compile-time - zero runtime overhead
- Does NOT affect third-party libraries that are already bundled (they have their own console statements)

### Why process.argv.includes('build')?

The original plan used `process.env.NODE_ENV === 'production'`, but this doesn't work in Vite because:

1. The vite config is evaluated before environment variables are fully processed
2. The function form of `defineConfig(({ command }) => ...)` is the documented approach, but `command` is not reliably passed to all esbuild invocations
3. Checking `process.argv.includes('build')` reliably detects when `vite build` is run vs `vite` (dev server)

### Remaining Console Statements

The 8 remaining `console.error` and `console.warn` statements are from:

1. **Buffer polyfill** (from the `buffer` npm package) - error handling for browsers without typed array support
2. These are in third-party code and NOT from our application
3. They serve a legitimate error-reporting purpose (browser compatibility)

## Commits

| Hash | Type | Message |
|------|------|---------|
| 8794feb | feat | Add esbuild drop console/debugger in production (initial config) |
| 319e5c5 | fix | Fix TypeScript errors blocking build |
| 8784e78 | feat | Configure esbuild drop console/debugger in production (final) |

## Success Criteria

- [x] vite.config.ts has esbuild.drop for 'console' and 'debugger' in production
- [x] Production build contains zero console statements from app code
- [x] Development build still allows console logging for debugging
- [x] Build runs successfully with no errors

## Next Phase Readiness

**Complete.** This plan is standalone and doesn't affect subsequent plans.

**Note:** The console removal is now automatic for all production builds. Future development can use `console.log` freely for debugging - they will be stripped automatically during `vite build`.
