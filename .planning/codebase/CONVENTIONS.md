# Coding Conventions

**Analysis Date:** 2026-01-22

## Naming Patterns

**Files:**
- React components: PascalCase with `.tsx` extension (`HeroSelect.tsx`, `GameCanvas.tsx`, `MainMenu.tsx`)
- React hooks: camelCase prefixed with `use` (`useNetworkClient.ts`, `usePhysics.ts`, `useAudio.ts`)
- Utilities: camelCase (e.g., `clientId.ts`, `math.ts`)
- Types: camelCase (e.g., `hero.ts`, `network.ts`, `ability.ts`)
- Constants: camelCase (e.g., `heroes.ts`, `physics.ts`, `game.ts`)
- Class files: PascalCase (e.g., `GameRoom.ts`, `MovementController.ts`, `HeroBase.ts`)

**Functions:**
- camelCase for all functions and methods
- Examples: `getClientId()`, `createHero()`, `handleInput()`, `updateGameState()`
- Async functions use standard naming, not prefixed with "async"

**Variables:**
- camelCase for local variables and parameters
- Examples: `playerName`, `clientId`, `heroId`, `abilityState`
- Constants in files use UPPER_SNAKE_CASE (e.g., `VOID_ZONE_RADIUS`, `TICK_RATE`, `DEFAULT_HERO_STATS`)

**Types:**
- PascalCase for interfaces and types
- Examples: `HeroDefinition`, `AbilityContext`, `MovementInput`, `GameStateSync`
- Type union literals use snake_case strings (e.g., `'hero_select' | 'waiting' | 'playing'`)

**Classes:**
- PascalCase for class names
- Examples: `HeroBase`, `MovementController`, `GameRoom`, `PhysicsWorld`
- Abstract classes follow same pattern (e.g., `HeroBase`)

## Code Style

**Formatting:**
- No explicit formatter configured (no Prettier/ESLint config files detected)
- Indentation: 2 spaces (observed in all source files)
- Single quotes preferred for strings in most files
- Template literals used for multi-line strings and interpolation

**Linting:**
- No ESLint configuration detected in root or app directories
- TypeScript strict mode enabled via `tsconfig.base.json`:
  - `strict: true`
  - `strictNullChecks: true`
  - `noFallthroughCasesInSwitch: true`
  - `forceConsistentCasingInFileNames: true`
- `noUnusedLocals` and `noUnusedParameters` explicitly disabled

**TypeScript:**
- Target: ES2022
- Module: ESNext (client), CommonJS (server)
- JSX: react-jsx (client only)
- Decorators enabled for server (Colyseus schema): `experimentalDecorators: true`, `emitDecoratorMetadata: true`

## Import Organization

**Order:**
1. External package imports (React, Three.js, Colyseus, etc.)
2. Internal workspace package imports (`@voxel-strike/*`)
3. Relative imports (local files)
4. Type-only imports are inline (use `import type` syntax)

**Example from `apps/client/src/App.tsx`:**
```typescript
import { useEffect, useState } from 'react';
import { useGameStore } from './store/gameStore';
import { MainLobby } from './components/ui/MainLobby';
```

**Example from `apps/server/src/rooms/GameRoom.ts`:**
```typescript
import { Room, Client } from 'colyseus';
import { GameState } from './schema/GameState';
import { DEFAULT_GAME_CONFIG, TICK_RATE } from '@voxel-strike/shared';
import type { HeroId, Team, PlayerInput } from '@voxel-strike/shared';
```

**Path Aliases:**
- Client uses `@/*` alias pointing to `./src/*` (configured in `apps/client/tsconfig.json`)
- No path aliases configured for server or packages
- Workspace packages imported via `@voxel-strike/*` namespace

**File Extensions:**
- Explicit `.js` extensions in dynamic imports for ESM compatibility
- Example: `await import('./PhantomHero.js')`

## Error Handling

**Patterns:**
- Try-catch blocks for async operations (HTTP requests, room creation)
- Error logging to console with context
- Error objects passed to callbacks/handlers without throwing up the stack
- No centralized error handling framework

**Example from `apps/server/src/index.ts`:**
```typescript
try {
  const rooms = await matchMaker.query({ name: 'lobby_room' });
  // ... process rooms
  res.json({ lobbies });
} catch (error) {
  console.error('Failed to list lobbies:', error);
  res.status(500).json({ error: 'Failed to list lobbies' });
}
```

**Example from `apps/client/src/contexts/NetworkContext.tsx`:**
```typescript
try {
  const lobby = await client.joinById(lobbyId, options);
  // ... setup
} catch (error) {
  console.error('Failed to join lobby:', error);
  setError(error as Error);
}
```

## Logging

**Framework:** Native `console` methods

**Patterns:**
- Server uses structured logging with prefixes: `console.log('[GameRoom] Player joining: ...')`
- Client uses descriptive messages: `console.log('Received lobby state:', data)`
- Error logging: `console.error('Failed to X:', error)`
- Debug logging present in development (not removed for production)
- Banner-style ASCII art for server startup in `apps/server/src/index.ts`

**Common log points:**
- Server: Player join/leave events, room lifecycle, game state transitions
- Client: Network events, lobby operations, connection state changes
- Both: Error conditions

## Comments

**When to Comment:**
- Complex algorithms and game logic calculations
- Inline explanations for non-obvious behavior
- TODO markers for future work (sparse usage: only 3 TODOs found)
- Event handler purposes
- State management rationale

**Example from `apps/client/src/store/gameStore.ts`:**
```typescript
// NOTE: We update players Map entries in-place for position/rotation data to avoid
// triggering React re-renders on every server tick. The Map reference only changes
// when players are added/removed.
```

**Example from `apps/client/src/App.tsx`:**
```typescript
// ESC handling - only when menu is already open (to close it)
// When pointer is locked, browser will exit pointer lock on ESC,
// and we handle that in pointerlockchange event below
```

**JSDoc/TSDoc:**
- Used for utility functions (e.g., `apps/client/src/utils/clientId.ts`)
- Includes descriptions and parameter/return documentation
- Not consistently applied across all public APIs

**Example:**
```typescript
/**
 * Gets the persistent client ID, creating one if it doesn't exist.
 * This ID is stored in localStorage and survives page reloads.
 */
export function getClientId(): string {
```

## Function Design

**Size:**
- Most functions 10-50 lines
- Complex update loops (game tick, physics) 100-200 lines
- React components vary widely (50-200 lines)

**Parameters:**
- Object parameters preferred for complex inputs
- Example: `update(movementInput: MovementInput)` instead of multiple parameters
- Options objects for configuration: `onCreate(options: CreateOptions)`

**Return Values:**
- Explicit types always defined
- Object returns for multiple values (e.g., `MovementState` with position, velocity, movement)
- `void` for side-effect functions
- Promise-wrapped for async functions

**Arrow Functions vs. Regular:**
- React component functions: Regular function declarations
- Class methods: Regular method syntax
- Callbacks and inline functions: Arrow functions
- Example: `const handleKeyDown = (e: KeyboardEvent) => { ... }`

## Module Design

**Exports:**
- Named exports preferred over default exports
- Multiple exports per file common
- Re-exports used in index files for package entry points
- Type exports separated with `export type` syntax

**Example from `packages/shared/src/index.ts`:**
```typescript
export * from './types/hero.js';
export * from './types/ability.js';
export * from './constants/heroes.js';
```

**Example from `apps/client/src/store/gameStore.ts`:**
```typescript
export type { LobbyInfo, LobbyPlayer, UserStats, AppPhase } from './types';
export const useGameStore = create<GameStore>(...);
```

**Barrel Files:**
- Used in packages: `packages/shared/src/index.ts`, `packages/game-logic/src/index.ts`
- Not used extensively in apps (direct imports preferred)

## State Management

**Client:**
- Zustand for global game state (`apps/client/src/store/gameStore.ts`)
- State organized with slices pattern for different concerns (projectiles, glacier effects, etc.)
- Direct mutation avoided - immutable updates with spread operators
- Separate visual store for high-frequency non-reactive data (60fps position updates)

**Server:**
- Colyseus Schema for synchronized state
- Imperative mutation allowed (Colyseus synchronizes changes)
- Schema classes use decorators: `@type()`, `@filter()`

## React Patterns

**Hooks Usage:**
- Custom hooks for reusable logic (network, physics, audio)
- `useEffect` for lifecycle and side effects
- `useState` for local component state
- `useRef` for DOM/Three.js object references
- `useShallow` from Zustand for selective re-renders

**Component Structure:**
- Functional components only (no class components observed)
- Props destructured in function parameters
- Early returns for conditional rendering
- Fragments used to avoid wrapper divs

**Three.js with React:**
- `@react-three/fiber` for declarative Three.js
- `@react-three/drei` helper components (OrbitControls, Sky, Grid)
- `useFrame` hook for animation loop
- Refs for accessing Three.js objects directly

---

*Convention analysis: 2026-01-22*
