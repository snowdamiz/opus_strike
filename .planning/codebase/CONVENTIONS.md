# Coding Conventions

**Analysis Date:** 2026-01-22

## Naming Patterns

**Files:**
- Components: PascalCase with .tsx extension (e.g., `HeroSelect.tsx`, `GameCanvas.tsx`)
- Utilities/Hooks: camelCase with .ts extension (e.g., `useAudio.ts`, `clientId.ts`)
- Context files: PascalCase with Context suffix (e.g., `NetworkContext.tsx`, `WalletContext.tsx`)
- Handler modules: camelCase with Handlers suffix (e.g., `gameMessageHandlers.ts`, `abilityHandlers.ts`)
- Directories: camelCase, descriptive (e.g., `components`, `contexts`, `hooks`, `store`)
- Type definition files: camelCase with .ts extension (e.g., `types.ts`, `global.d.ts`)

**Functions:**
- camelCase throughout
- Hook functions prefixed with `use` (e.g., `useAudio()`, `useNetwork()`, `useGameStore()`)
- Event handlers prefixed with `handle` or `on` (e.g., `handleInput()`, `onMessage()`)
- Getter/helper functions use descriptive verbs (e.g., `getSfxVolume()`, `loadSound()`, `createDefaultLocalPlayer()`)

**Variables:**
- camelCase for all variable declarations
- Constants use UPPER_SNAKE_CASE (e.g., `HERO_COLORS`, `SOUND_EFFECTS`, `DEFAULT_CONFIG`)
- State variables in Zustand use camelCase (e.g., `gamePhase`, `isConnected`, `localPlayer`)
- DOM elements are often marked with trailing `Ref` (e.g., `clientRef`, `lobbyRoomRef`, `gameRoomRef`)

**Types:**
- Interfaces use PascalCase and often suffixed with `Type`, `State`, or `Context` (e.g., `NetworkContextType`, `GameStore`, `SoundEffect`)
- Type aliases use PascalCase (e.g., `SoundName`, `HeroId`, `Team`)
- Generic types follow TypeScript conventions (e.g., `MapSchema<Player>`)
- Types are imported separately using `type` keyword (e.g., `import type { HeroId, Team, PlayerInput }`)

## Code Style

**Formatting:**
- No Prettier or ESLint config found - appears to be manual/IDE formatting
- Consistent 2-space indentation throughout codebase
- Files end with trailing newline
- Maximum line length appears to be ~100 characters
- Single quotes used in imports and string literals

**Linting:**
- No ESLint configuration detected
- No specific linting rules enforced
- Developers rely on TypeScript strict mode for type safety

## Import Organization

**Order:**
1. React/Framework imports (e.g., `import { useState } from 'react'`)
2. External library imports (e.g., `import { Client, Room } from 'colyseus.js'`)
3. Internal package imports (e.g., `import { HERO_DEFINITIONS } from '@voxel-strike/shared'`)
4. Type imports with `type` keyword (grouped, e.g., `import type { HeroId, Team }`)
5. Context imports (e.g., `import { useGameStore } from '../store/gameStore'`)
6. Component/utility imports (e.g., `import { GameCanvas } from './components/game/GameCanvas'`)
7. Style imports last (e.g., `import './styles/index.css'`)

**Path Aliases:**
- Workspace packages use @ prefix (e.g., `@voxel-strike/shared`, `@voxel-strike/physics`)
- Relative paths used within packages (e.g., `../store/gameStore`)
- No configured TypeScript path aliases observed beyond workspace packages

## Error Handling

**Patterns:**
- Try-catch blocks in async operations (e.g., `fetchLobbies`, `joinLobby`)
- Error logged to console with `console.error()` before handling
- Graceful fallbacks return empty results on failure (e.g., `return []` in fetchLobbies)
- Network operations catch errors but often continue execution
- Errors in message handlers logged but don't stop game loop (e.g., GameRoom tick loop continues)

**Example from `NetworkContext.tsx`:**
```typescript
try {
  const response = await fetch(`${httpUrl}/lobbies`);
  const data = await response.json();
  const lobbies = data.lobbies || [];
  setAvailableLobbies(lobbies);
  return lobbies;
} catch (error) {
  console.error('Failed to fetch lobbies:', error);
  return [];
}
```

**Example from `useAudio.ts`:**
```typescript
try {
  const response = await fetch(soundDef.path);
  if (!response.ok) {
    console.warn(`[Audio] Sound file not found: ${soundDef.path}`);
    return null;
  }
  // ... process buffer
} catch (error) {
  console.warn(`[Audio] Failed to load sound: ${name}`, error);
  return null;
}
```

## Logging

**Framework:** Native `console` object (no logging library)

**Patterns:**
- `console.log()` for general information and debug output
- `console.error()` for errors that need attention
- `console.warn()` for warnings and potentially problematic conditions
- Messages often prefixed with context/feature name in brackets (e.g., `[Lobby]`, `[Audio]`, `[joinGameRoom]`)
- Structured logging: `console.log('Message:', data)` with separate data argument

**Examples:**
```typescript
console.log('Received lobby state:', data);
console.error('Failed to join game room:', error);
console.warn('[Audio] Sound file not found: ${soundDef.path}');
console.log('[Lobby] Ignoring duplicate gameStarting message');
```

## Comments

**When to Comment:**
- Complex game logic (e.g., input handling, state synchronization)
- Non-obvious performance optimizations (e.g., Map reference stability)
- Important architectural decisions (e.g., visual store separation for 60fps)
- State management mutations that need explanation
- Comments are inline and close to relevant code

**JSDoc/TSDoc:**
- Minimal usage observed
- Function descriptions at declaration level in some utility functions
- Type documentation in interfaces/types (e.g., AudioConfig fields have comments)
- Example from `useAudio.ts`:
```typescript
interface AudioConfig {
  masterVolume: number;  // 0-100
  sfxVolume: number;     // 0-100
  musicVolume: number;   // 0-100
  muted: boolean;
}
```

## Function Design

**Size:**
- Most functions are 15-50 lines
- Complex functions decomposed into smaller helpers
- Hook callbacks kept focused (e.g., `createLobby`, `joinLobby` in NetworkContext)
- UI component functions often 80-200+ lines including JSX

**Parameters:**
- Use typed objects for multiple parameters rather than positional args
- Optional parameters with `?:` syntax
- Destructuring common in React component props and function arguments
- Examples:
```typescript
const joinLobby = useCallback(async (playerName: string, lobbyId: string) => { ... })
const playSound = useCallback(async (name: SoundName, options?: { volume?: number; pitch?: number; ... }) => { ... })
const handleSpawnNpc = (client, data: { heroId: HeroId; team: Team; position?: ...; name?: ... }) => { ... }
```

**Return Values:**
- Functions explicitly type return values
- Async functions return Promises (e.g., `Promise<LobbyInfo[]>`)
- Void return for side-effect functions (e.g., `setLoading: (loading: boolean) => void`)
- Nullable returns use `Type | null` (e.g., `loadSound()` returns `SoundEffect | null`)

## Module Design

**Exports:**
- Named exports for functions and types (e.g., `export function useNetwork()`)
- Default exports uncommon
- Context provider components exported as named exports
- Re-exports of shared types from public API (e.g., `export type { LobbyInfo, LobbyPlayer, UserStats }`)

**Barrel Files:**
- Minimal barrel file usage observed
- Components and utilities imported directly from files
- No index.ts aggregation patterns detected in main directories
- Workspaces use explicit main/types exports in package.json

## Zustand Store Pattern

**Store structure observed in `gameStore.ts`:**
- Sliced stores with separate initial states (e.g., `projectileInitialState`)
- Actions grouped by domain (core, lobby, UI)
- State updates use `set()` with object spread for immutability
- Store composition: `const GameStore = CoreState & CoreActions & ProjectileSlice`
- Inline initial state objects
- Comments separating action groups with `// ==================== GROUP NAME ====================`

## Context Provider Pattern

**Pattern from `NetworkContext.tsx` and `WalletContext.tsx`:**
- Context created with `createContext<TypeName | null>(null)`
- Provider component accepts `{ children: ReactNode }`
- Hooks use `useContext()` with null-check and error throw
- Room/client references stored in `useRef` for lifecycle management
- Cleanup functions handle existing connections before new ones

## Performance Conventions

**State Management:**
- Zustand for centralized game state
- Non-reactive visual store (`visualStore`) for high-frequency position/rotation updates
- In-place Map updates to avoid React re-renders on position sync
- Callback memoization with `useCallback()` for handler stability

**Rendering:**
- Conditional rendering based on game phase (e.g., show HUD only during 'playing' phase)
- Suspense boundaries used in Canvas (e.g., `<Suspense fallback={null}>`)
- Audio context is singleton/shared across hook instances
- Loops managed in shared state to prevent duplicate audio sources

---

*Convention analysis: 2026-01-22*
