---
phase: 01-react-optimization-foundation
plan: 03B
type: execute
wave: 2
depends_on: [01-04A]
files_modified:
  - apps/client/src/components/game/hookshot/hookProjectile.tsx
  - apps/client/src/components/game/hookshot/dragHook.tsx
  - apps/client/src/components/game/hookshot/grappleTrap.tsx
  - apps/client/src/components/game/hookshot/swingLine.tsx
  - apps/client/src/components/game/hookshot/grappleLine.tsx
  - apps/client/src/components/game/hookshot/earthWall.tsx
  - apps/client/src/components/game/glacier/iceWall.tsx
  - apps/client/src/components/game/glacier/mallet.tsx
  - apps/client/src/components/game/glacier/shield.tsx
  - apps/client/src/components/game/glacier/frostStorm.tsx
autonomous: true
user_setup: []

must_haves:
  truths:
    - "Hookshot and Glacier effect components only re-render when their props actually change"
    - "Parent component updates don't cascade to Hookshot/Glacier effect children"
    - "React DevTools Profiler shows Hookshot/Glacier components grayed out (not re-rendering) during parent updates"
  artifacts:
    - path: "apps/client/src/components/game/hookshot/earthWall.tsx"
      provides: "EarthWallEffect with React.memo and custom comparison"
      contains: "React\\.memo.*EarthWallEffect"
    - path: "apps/client/src/components/game/glacier/iceWall.tsx"
      provides: "IceWall component with React.memo wrapper"
      contains: "React\\.memo"
  key_links:
    - from: "Hookshot/Glacier effect component exports"
      to: "React.memo wrapper"
      via: "Export statement wrapping"
      pattern: "export const EffectName = React\\.memo"
    - from: "Custom comparison functions"
      to: "Object prop equality checks"
      via: "Second argument to React.memo"
      pattern: "\\(prev, next\\) =>"
---

<objective>
Add React.memo wrappers to Hookshot and Glacier effect components to prevent cascading re-renders from parent updates.

Purpose: When effect manager components re-render (due to new projectiles added), ALL existing effect children re-render unnecessarily. React.memo ensures children only re-render when their props actually change.

Output: Hookshot and Glacier effect components wrapped in React.memo, with custom comparison for object props.
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

@apps/client/src/components/game/hookshot/earthWall.tsx
@apps/client/src/components/game/HookshotEffects.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Wrap Hookshot effect components in React.memo</name>
  <files>
    apps/client/src/components/game/hookshot/hookProjectile.tsx
    apps/client/src/components/game/hookshot/dragHook.tsx
    apps/client/src/components/game/hookshot/grappleTrap.tsx
    apps/client/src/components/game/hookshot/swingLine.tsx
    apps/client/src/components/game/hookshot/grappleLine.tsx
    apps/client/src/components/game/hookshot/earthWall.tsx
  </files>
  <action>
For each Hookshot effect component:
1. Wrap export with React.memo
2. Add custom comparison for object props

EarthWallEffect special case (from plan 01-01, now uses refs):
- Props: wall.id, wall.startPosition, wall.direction, etc.
- Custom comparison on id (primary) + startTime + position values

WallSegment sub-component:
- Already only receives position object
- Add React.memo with position comparison

Pattern for EarthWallEffect:
```typescript
export const EarthWallEffect = React.memo(({ wall }: EarthWallProps) => {
  // ... component (now uses wallSegmentsRef internally)
}, (prev, next) => {
  return prev.wall.id === next.wall.id &&
         prev.wall.startTime === next.wall.startTime;
});
```

Pattern for WallSegment (sub-component):
```typescript
const WallSegment = React.memo(({ position, targetHeight, creationTime, index, rotationY }: WallSegmentProps) => {
  // ... component
}, (prev, next) => {
  return prev.index === next.index &&
         prev.position.x === next.position.x &&
         prev.position.y === next.position.y &&
         prev.position.z === next.position.z;
});
```

WHY: Earth wall creates multiple segments over time. Without React.memo, each new segment addition re-renders all existing segments. ID comparison prevents this since walls never change their ID.
  </action>
  <verify>grep -l "React.memo" apps/client/src/components/game/hookshot/*.tsx returns all hookshot effect files</verify>
  <done>All Hookshot effect components use React.memo</done>
</task>

<task type="auto">
  <name>Task 2: Wrap Glacier effect components in React.memo</name>
  <files>
    apps/client/src/components/game/glacier/iceWall.tsx
    apps/client/src/components/game/glacier/mallet.tsx
    apps/client/src/components/game/glacier/shield.tsx
    apps/client/src/components/game/glacier/frostStorm.tsx
  </files>
  <action>
For each Glacier effect component:
1. Wrap export with React.memo
2. Add custom comparison for object props

Glacier effects typically receive position, direction objects as props.

WHY: Same pattern - when new ice walls/frost storms are added, existing ones shouldn't re-render.
  </action>
  <verify>grep -l "React.memo" apps/client/src/components/game/glacier/*.tsx returns all glacier effect files</verify>
  <done>All Glacier effect components use React.memo</done>
</task>

</tasks>

<verification>
1. React DevTools Profiler: Highlight Hookshot/Glacier effect components, verify they don't re-render when new effects of same type are added
2. Visual check: All effects still render correctly, animate properly
3. Code review: Custom comparison functions check primitive values, not object references
</verification>

<success_criteria>
1. All Hookshot and Glacier effect components wrapped in React.memo
2. Custom comparison functions for components with object props
3. React DevTools shows effect components not re-rendering during parent updates
4. No visual regressions in effect rendering
</success_criteria>

<output>
After completion, create `.planning/phases/01-react-optimization-foundation/01-03B-SUMMARY.md`
</output>
