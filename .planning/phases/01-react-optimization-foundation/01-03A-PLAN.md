---
phase: 01-react-optimization-foundation
plan: 03A
type: execute
wave: 2
depends_on: [01-04A]
files_modified:
  - apps/client/src/components/game/phantom/direBall.tsx
  - apps/client/src/components/game/phantom/voidRay.tsx
  - apps/client/src/components/game/phantom/voidZone.tsx
  - apps/client/src/components/game/phantom/blinkTeleport.tsx
  - apps/client/src/components/game/phantom/shadowStepArrival.tsx
  - apps/client/src/components/game/blaze/rockets.tsx
  - apps/client/src/components/game/blaze/bomb.tsx
  - apps/client/src/components/game/blaze/jetpack.tsx
autonomous: true
user_setup: []

must_haves:
  truths:
    - "Phantom and Blaze effect components only re-render when their props actually change"
    - "Parent component updates don't cascade to Phantom/Blaze effect children"
    - "React DevTools Profiler shows Phantom/Blaze components grayed out (not re-rendering) during parent updates"
  artifacts:
    - path: "apps/client/src/components/game/phantom/voidRay.tsx"
      provides: "VoidRay component wrapped in React.memo"
      contains: "React\\.memo\\(.*VoidRay"
    - path: "apps/client/src/components/game/blaze/rockets.tsx"
      provides: "Rocket component with React.memo wrapper"
      contains: "React\\.memo"
  key_links:
    - from: "Phantom/Blaze effect component exports"
      to: "React.memo wrapper"
      via: "Export statement wrapping"
      pattern: "export const EffectName = React\\.memo"
    - from: "Custom comparison functions"
      to: "Object prop equality checks"
      via: "Second argument to React.memo"
      pattern: "\\(prev, next\\) =>"
---

<objective>
Add React.memo wrappers to Phantom and Blaze effect components to prevent cascading re-renders from parent updates.

Purpose: When effect manager components re-render (due to new projectiles added), ALL existing effect children re-render unnecessarily. React.memo ensures children only re-render when their props actually change.

Output: Phantom and Blaze effect components wrapped in React.memo, with custom comparison for object props.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-react-optimization-foundation/01-RESEARCH.md

@apps/client/src/components/game/phantom/voidRay.tsx
@apps/client/src/components/game/blaze/rockets.tsx
@apps/client/src/components/game/HookshotEffects.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Wrap Phantom effect components in React.memo</name>
  <files>
    apps/client/src/components/game/phantom/direBall.tsx
    apps/client/src/components/game/phantom/voidRay.tsx
    apps/client/src/components/game/phantom/voidZone.tsx
    apps/client/src/components/game/phantom/blinkTeleport.tsx
    apps/client/src/components/game/phantom/shadowStepArrival.tsx
  </files>
  <action>
For each Phantom effect component:
1. Add React import if not present: `import { React } from 'react';` or use existing import
2. Wrap component export with React.memo

Pattern for components with simple props (primitives only):
```typescript
// Before:
export function VoidRay({ id, startPosition, direction, startTime, ownerId }: VoidRayProps) {

// After:
export const VoidRay = React.memo(({ id, startPosition, direction, startTime, ownerId }: VoidRayProps) => {
  // ... component body
});
```

For components with object props (position, velocity objects):
```typescript
export const VoidRay = React.memo(({ id, startPosition, direction, startTime, ownerId }: VoidRayProps) => {
  // ... component body
}, (prev, next) => {
  // Custom comparison for object props
  return (
    prev.id === next.id &&
    prev.startPosition.x === next.startPosition.x &&
    prev.startPosition.y === next.startPosition.y &&
    prev.startPosition.z === next.startPosition.z &&
    prev.direction.x === next.direction.x &&
    prev.direction.y === next.direction.y &&
    prev.direction.z === next.direction.z &&
    prev.startTime === next.startTime &&
    prev.ownerId === next.ownerId
  );
});
```

WHY: When a new projectile is added, the manager re-renders. Without React.memo, ALL existing projectile components re-render too. Default shallow comparison fails for object props (new reference each frame).

NOTE: voidRay.tsx already has stable props from plan 01-04A (temp vectors), but still needs React.memo.
  </action>
  <verify>grep -l "React.memo" apps/client/src/components/game/phantom/*.tsx returns all phantom effect files</verify>
  <done>All Phantom effect components use React.memo with appropriate comparison</done>
</task>

<task type="auto">
  <name>Task 2: Wrap Blaze effect components in React.memo</name>
  <files>
    apps/client/src/components/game/blaze/rockets.tsx
    apps/client/src/components/game/blaze/bomb.tsx
    apps/client/src/components/game/blaze/jetpack.tsx
    apps/client/src/components/game/blaze/airstrike.tsx
  </files>
  <action>
For each Blaze effect component:
1. Wrap export with React.memo
2. Add custom comparison for object props (position, velocity, direction)

Special case for rockets.tsx:
- Rocket components receive position/velocity as objects
- Use custom comparison checking x/y/z values

Special case for jetpack.tsx:
- Only receives playerPosition object
- Simple comparison on position x/y/z

Pattern:
```typescript
export const BombEffect = React.memo(({ bomb }: BombEffectProps) => {
  // ... component
}, (prev, next) => {
  return prev.bomb.id === next.bomb.id &&
         prev.bomb.startTime === next.bomb.startTime &&
         // ... other relevant fields
});
```

WHY: Rockets fire rapidly (5-10/second). Without React.memo, adding a new rocket re-renders ALL existing rockets. Custom comparison prevents re-render when position object reference changes but values are same.
  </action>
  <verify>grep -l "React.memo" apps/client/src/components/game/blaze/*.tsx returns all blaze effect files</verify>
  <done>All Blaze effect components use React.memo</done>
</task>

</tasks>

<verification>
1. React DevTools Profiler: Highlight Phantom/Blaze effect components, verify they don't re-render when new effects of same type are added
2. Visual check: All effects still render correctly, animate properly
3. Code review: Custom comparison functions check primitive values, not object references
</verification>

<success_criteria>
1. All Phantom and Blaze effect components wrapped in React.memo
2. Custom comparison functions for components with object props
3. React DevTools shows effect components not re-rendering during parent updates
4. No visual regressions in effect rendering
</success_criteria>

<output>
After completion, create `.planning/phases/01-react-optimization-foundation/01-03A-SUMMARY.md`
</output>
