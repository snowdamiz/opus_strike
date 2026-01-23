# Testing Patterns

**Analysis Date:** 2026-01-22

## Test Framework

**Status:** Not detected

**Runner:**
- No Jest, Vitest, or other test runner configured
- No `jest.config.js`, `vitest.config.ts`, or similar files present
- No test scripts in package.json files

**Assertion Library:**
- No testing libraries detected in dependencies

**Run Commands:**
- No test commands available
- Only build, dev, typecheck, and lint commands present in package.json

## Test File Organization

**Current State:**
- No test files present in codebase
- No `*.test.ts`, `*.spec.ts`, `*.test.tsx`, or `*.spec.tsx` files found
- No `__tests__` directories

**Observation:**
Testing infrastructure has not been established. All validation appears to be manual and runtime-based.

## Type Safety as Substitute for Tests

The codebase relies heavily on TypeScript's strict mode for safety:
- `strict: true` in `tsconfig.base.json`
- `strictNullChecks: true` enforced
- `noFallthroughCasesInSwitch: true`
- Full type annotations throughout

**Example from `gameStore.ts`:**
```typescript
interface CoreState {
  walletAddress: string | null;
  userId: string | null;
  userStats: UserStats | null;
  isConnected: boolean;
  isLoading: boolean;
  // ... more typed fields
}

interface CoreActions {
  setWalletAddress: (address: string | null) => void;
  setUser: (userId: string | null, name: string, stats: UserStats | null) => void;
  // ... more typed actions
}
```

## Mocking Strategy

**Current Approach:**
- No mocking framework detected
- NPC/bot spawning provides test/development alternative to unit mocking
- Message handlers in `NetworkContext` can be stubbed by controlling Room messages

**Testing capability from `NetworkContext.tsx`:**
```typescript
const spawnNpc = useCallback((heroId: HeroId, team?: Team, position?: { x: number; y: number; z: number }, name?: string) => {
  if (gameRoomRef.current) {
    const data: any = { heroId, position, name };
    if (team) data.team = team;
    gameRoomRef.current.send('spawnNpc', data);
  }
}, []);

const damageNpc = useCallback((npcId: string, damage: number) => {
  gameRoomRef.current?.send('damageNpc', { npcId, damage });
}, []);

const killNpc = useCallback((npcId: string) => {
  gameRoomRef.current?.send('killNpc', { npcId });
}, []);

const killAllNpcs = useCallback(() => {
  gameRoomRef.current?.send('killAllNpcs', {});
}, []);
```

## Manual Testing Capabilities

The game includes built-in development commands accessible through:

**In-game Console:**
- Location: `apps/client/src/components/ui/GameConsole.tsx`
- Triggered by backtick key (`) during gameplay
- Provides direct command execution interface

**NPC/Bot Operations:**
- `spawnNpc(heroId, team?, position?, name?)` - spawn test NPCs
- `damageNpc(npcId, damage)` - damage test enemies
- `killNpc(npcId)` - kill individual NPC
- `killAllNpcs()` - kill all spawned NPCs

## Async Testing Patterns

**Promise-based async operations:**
```typescript
// From fetchLobbies in NetworkContext.tsx
const fetchLobbies = useCallback(async (): Promise<LobbyInfo[]> => {
  try {
    const httpUrl = config.serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    const response = await fetch(`${httpUrl}/lobbies`);
    const data = await response.json();
    const lobbies = data.lobbies || [];
    setAvailableLobbies(lobbies);
    return lobbies;
  } catch (error) {
    console.error('Failed to fetch lobbies:', error);
    return [];
  }
}, [setAvailableLobbies]);
```

**Room connection async patterns:**
```typescript
// From joinGameRoom in NetworkContext.tsx
const joinGameRoom = useCallback(async (gameRoomId: string, playerName: string, team?: string) => {
  if (isJoiningGameRef.current) {
    console.log('[joinGameRoom] Already joining a game room, ignoring duplicate call');
    return;
  }
  isJoiningGameRef.current = true;

  setLoading(true);

  try {
    gameRoomRef.current = await client.joinById(gameRoomId, {
      playerName,
      preferredTeam: team,
      clientId,
    });

    setupGameListeners(gameRoomRef.current, playerName);
    // ... success handling
  } catch (error) {
    console.error('Failed to join game room:', error);
    setLoading(false);
    isJoiningGameRef.current = false;
    throw error;
  }
}, [getClient, setupGameListeners, setLoading, setRoomId, setAppPhase]);
```

## Error Testing

**Runtime validation approach:**
- Console warnings for missing/invalid resources
- Graceful degradation (e.g., sound files return null instead of throwing)
- Network errors caught and logged with fallback states

**Example from `useAudio.ts`:**
```typescript
const loadSound = useCallback(async (name: SoundName): Promise<SoundEffect | null> => {
  // ... setup code ...
  try {
    const response = await fetch(soundDef.path);
    if (!response.ok) {
      console.warn(`[Audio] Sound file not found: ${soundDef.path}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer);

    const effect: SoundEffect = {
      buffer,
      volume: soundDef.volume,
    };

    sharedSounds.set(name, effect);
    return effect;
  } catch (error) {
    console.warn(`[Audio] Failed to load sound: ${name}`, error);
    return null;
  }
}, [initAudio]);
```

## Test Coverage Analysis

**Critical Untested Areas:**

1. **Network Synchronization (`NetworkContext.tsx`)**
   - Room lifecycle (create, join, leave)
   - Message handlers (playerJoined, playerLeft, phaseChange, etc.)
   - Duplicate session detection
   - Reconnection logic with clientId tracking
   - Lines: 557 total, complex event handling

2. **Game State Management (`gameStore.ts`)**
   - `updateGameState()` with Map mutation optimization
   - Player state reconciliation
   - Slice integration (projectiles, glacier)
   - Lines: 509 total, critical business logic

3. **Ability System (`abilityHandlers.ts` in server, ability hooks in client)**
   - Ability execution and cooldown management
   - Projectile spawning and tracking
   - Effect resolution and collision
   - Lines: 498 (gameMessageHandlers)

4. **Physics and Movement (`PlayerController`, physics hooks)**
   - Movement input processing
   - Collision detection
   - Gravity and jumping
   - Movement sound syncing

5. **Audio System (`useAudio.ts`)**
   - Audio context initialization and browser compatibility
   - Singleton pattern enforcement
   - Audio loading and caching
   - Volume/mute state management
   - Looping audio with fade in/out
   - Lines: 780 total, many singleton side effects

6. **UI Components (MainLobby, HeroSelect, HUD, etc.)**
   - Largest components: MainLobby (1411), HUD (922), Lobby (798)
   - Event handling and state transitions
   - Player interaction validation

## Recommended Testing Structure (if implemented)

**Unit test targets (by priority):**
1. `apps/server/src/rooms/abilityHandlers.ts` - core game mechanics
2. `apps/server/src/auth/verify.ts` - signature verification
3. `packages/game-logic/src/heroes/*.ts` - hero definitions and ability logic
4. `apps/client/src/store/gameStore.ts` - state management
5. `apps/client/src/hooks/useAudio.ts` - audio state and lifecycle

**Integration test targets:**
1. Network room creation and joining flow
2. Game lifecycle (lobby → hero select → gameplay → end)
3. Ability execution with server validation
4. Player synchronization across clients
5. Audio playback during game phases

**E2E test targets:**
1. Complete game match flow (2+ players)
2. CTF flag mechanics
3. Lobby creation and player management
4. Reconnection after disconnect
5. Hero ability execution and visual effects

## Manual Testing Checklist

Current approach relies on manual testing:
- Start dev server and client
- Use GameConsole for ability/NPC testing
- Monitor browser console and network tab
- Verify physics simulation visually
- Test audio with different volume settings
- Join multiple lobbies and test synchronization
- Disconnect/reconnect to test reconnection logic

## Coverage Gaps by Feature

**Hero Abilities:**
- No unit tests for ability cooldown calculations
- No tests for ability effect interactions
- Server-side validation untested

**State Synchronization:**
- Client/server state reconciliation untested
- Map optimization in `updateGameState()` untested
- Duplicate player cleanup untested

**Network Protocol:**
- Message ordering untested
- Reconnection with duplicate detection untested
- Room lifecycle edge cases untested

**Audio:**
- Context initialization in different browsers untested
- Singleton pattern enforcement untested
- Audio loading error handling untested
- Fade in/out timing untested

**Physics:**
- Collision detection untested
- Jump mechanics untested
- Slide mechanics untested
- Wall run mechanics untested

---

*Testing analysis: 2026-01-22*
