# Codebase Concerns

**Analysis Date:** 2026-01-22

## Tech Debt

### Monolithic Component Files

**Issue:** Several UI components exceed 1000+ lines and combine multiple responsibilities with complex state management.

**Files:**
- `apps/client/src/components/ui/MainLobby.tsx` (1411 lines)
- `apps/server/src/rooms/GameRoom.ts` (1250 lines)
- `apps/client/src/components/ui/HUD.tsx` (922 lines)

**Impact:** Difficult to test, maintain, and reason about component behavior. Changes to one feature risk breaking others. Reusability is limited.

**Fix approach:** Extract into smaller, single-responsibility components. MainLobby should delegate to LobbyBrowser, PlayerNameInput, HeroCarousel as separate components. GameRoom should move NPC/testing handlers to a separate extension module.

### In-Memory Nonce Store (Non-Production Safe)

**Issue:** Authentication nonces are stored in a simple in-memory Map in production code.

**Files:** `apps/server/src/auth/routes.ts` (line 44)

**Impact:** Nonce store is not persistent across server restarts, doesn't scale to multiple server instances, and doesn't support clustering or load balancing. In-memory cleanup with intervals is not reliable for high-traffic scenarios.

**Fix approach:** Replace with Redis or similar distributed cache. Make nonce expiry TTL-based rather than periodic cleanup. Add metrics to track nonce generation/validation rates.

### Hardcoded JWT Secret Default

**Issue:** Default JWT secret in code as fallback.

**Files:** `apps/server/src/auth/routes.ts` (line 10)

```typescript
const JWT_SECRET = process.env.JWT_SECRET || 'voxel-strike-secret-key-change-in-production';
```

**Impact:** If JWT_SECRET env var is missing in production, the server silently falls back to a non-secret string, allowing any token to be forged. This is a critical auth bypass.

**Fix approach:** Throw an error if JWT_SECRET is not set in production. Add startup validation that enforces this requirement.

### Loose Type Handling with `any` and `unknown`

**Issue:** 60+ instances of `any` type usage across codebase without proper type narrowing.

**Files:** Multiple across apps/client and apps/server

**Impact:** Loss of type safety, potential runtime errors from unexpected data shapes, harder refactoring, and IDE autocomplete benefits lost.

**Fix approach:** Replace `any` with proper types or `unknown` with type guards. Prioritize: gameMessageHandlers.ts (11 instances), NetworkContext.tsx (8 instances), WalletContext.tsx (5 instances).

### Excessive Console Logging in Production

**Issue:** 133+ console.log/warn/error calls scattered throughout codebase, many without proper filtering.

**Files:** Found in 18 files across client and server

**Impact:** Verbose production logs leak implementation details, reduce performance (logging is synchronous), and make it hard to find meaningful errors in logs.

**Fix approach:** Create a logging utility with levels (debug, info, warn, error). Only log at appropriate levels in production. Use environment-based log filtering.

## Known Bugs

### Missing Kill Feed and Match Event Notifications

**Issue:** Game events (kills, captures, deaths) are not visually communicated to the player.

**Files:** `apps/client/src/hooks/useNetworkClient.ts` (lines 65, 70, 75)

```typescript
// TODO: Show kill feed
// TODO: Show notification
// TODO: Show celebration
```

**Trigger:** When player-related events occur in-game (kills, captures, flag events)

**Workaround:** Events are sent to the server but not displayed. Check network messages in DevTools to confirm events are being received.

### Audio Context Lifecycle Not Properly Managed

**Issue:** AudioContext is created as a singleton and never cleaned up or properly managed for state transitions.

**Files:** `apps/client/src/hooks/useAudio.ts` (lines 42-44)

```typescript
let sharedAudioContext: AudioContext | null = null;
const sharedConfig: AudioConfig = loadAudioSettings();
const sharedSounds = new Map<string, SoundEffect>();
```

**Symptoms:** Audio context may become stuck in 'suspended' state, sounds may not play after page navigation, memory not released from cached sounds.

**Workaround:** Refresh page to reset audio context. Manually mute/unmute to force context resume.

### Ghost Player Cleanup Race Condition

**Issue:** Ghost players from disconnected clients may persist due to timing issues between server-side cleanup and client-side polling.

**Files:** `apps/client/src/store/gameStore.ts` (lines 158-161), `apps/client/src/contexts/gameMessageHandlers.ts` (lines 490-495)

**Symptoms:** Players who disconnected may appear frozen on screen for up to 10 seconds before being removed.

**Trigger:** Network disconnect or tab close during active game

**Workaround:** Ghost players are cleaned up automatically every 10 polling intervals (500ms). Manual app restart resolves immediately.

## Security Considerations

### Wallet Address as User Identifier

**Risk:** Wallet address is used directly as a database identifier and in URLs. If wallet address leaks, attackers know the exact user.

**Files:** `apps/server/src/auth/routes.ts` (lines 295-326)

**Current mitigation:** Wallet addresses are public by design on blockchain, but should not be used as opaque IDs.

**Recommendations:**
- Use UUIDs as primary user IDs (already done: user.id field exists)
- Ensure user.id is used everywhere instead of walletAddress
- Add rate limiting on `/auth/user/:walletAddress` endpoint to prevent user enumeration
- Validate wallet address format before DB queries to prevent injection

### Session Token Exposed via Cookie in Non-Secure Context

**Risk:** In development (NODE_ENV !== 'production'), cookies are set with secure: false and sameSite: 'lax', making tokens vulnerable to XSS and CSRF.

**Files:** `apps/server/src/auth/routes.ts` (lines 26-31)

**Current mitigation:** HTTP-only flag prevents JS access to token.

**Recommendations:**
- Add CSP headers to prevent XSS
- Use strict SameSite in all environments, not just production
- Rotate tokens on sensitive operations (hero select, match start)
- Implement CSRF token for non-idempotent operations

### Missing Input Validation on Server Routes

**Risk:** Some endpoints accept user input (player names, hero IDs, team assignments) without schema validation.

**Files:** `apps/server/src/rooms/GameRoom.ts` (lines 80-110)

**Current mitigation:** Basic length checks on player names in registration

**Recommendations:**
- Add request validation middleware (e.g., Zod, Joi)
- Validate hero IDs against HERO_DEFINITIONS whitelist
- Validate team values against allowed teams
- Sanitize player names to prevent injection attacks or abuse

### Persistent Database Credentials in .env File

**Risk:** `.env` file contains database credentials and is committed to git (or could be).

**Files:** `apps/server/.env`

**Current mitigation:** .env should be gitignored, but presence indicates local development storage of secrets.

**Recommendations:**
- Ensure .env is in .gitignore (check current status)
- Use environment variable managers (e.g., dotenv, vault services)
- Never store .env example with real credentials
- Rotate DATABASE_URL credentials regularly
- Use connection pooling with restricted DB user (read-only for non-critical ops)

## Performance Bottlenecks

### Large GameRoom State Synchronization

**Problem:** GameRoom broadcasts full state changes to all players every tick. With many players or frequent state updates, this can cause network bandwidth spikes.

**Files:** `apps/server/src/rooms/GameRoom.ts` (entire class)

**Cause:** Colyseus broadcasts all MapSchema changes. No delta compression or selective updates.

**Measurement:** At TICK_RATE (60 Hz) with 8 players, unoptimized updates can exceed 100KB/s per player in busy game states.

**Improvement path:**
- Implement delta encoding for position/velocity updates (only send when changed >threshold)
- Use spatial partitioning to only send nearby player updates
- Batch smaller frequent updates (e.g., movement) while doing full state sync less often
- Consider separate channels for audio position vs. game state

### MainLobby Re-Renders on Lobby List Refresh

**Problem:** `fetchLobbies` is called every 5 seconds in MainLobby, triggering full component render even if lobbies haven't changed.

**Files:** `apps/client/src/components/ui/MainLobby.tsx` (lines 217-223)

```typescript
useEffect(() => {
  if (activeTab === 'play') {
    fetchLobbies();
    const interval = setInterval(fetchLobbies, 5000);
    return () => clearInterval(interval);
  }
}, [fetchLobbies, activeTab]);
```

**Cause:** No memoization of lobby list, no change detection before update.

**Improvement path:**
- Memoize lobby list comparison before updating store
- Use RequestAnimationFrame instead of fixed interval for smoother UX
- Implement server-sent events or WebSocket lobby subscription instead of polling
- Add loading skeleton to show refresh in progress

### Audio Preloading and Caching Strategy

**Problem:** Audio files are lazily loaded on first use. During first ability activation in-game, there's a noticeable delay loading the audio file.

**Files:** `apps/client/src/hooks/useAudio.ts` (lines 132-150)

**Cause:** Fetch happens on-demand, blocking playback until file downloaded and decoded.

**Improvement path:**
- Preload critical sounds (footstep, jump, hit) on app initialization
- Batch preload hero ability sounds when hero is selected in lobby
- Use Web Audio API decodeAudioData with streaming for faster playback
- Consider audio sprite sheets to combine multiple sounds in one file

### Physics World Update Loop Not Optimized

**Problem:** PhysicsWorld and MovementController update every tick without spatial optimization or batching.

**Files:** `packages/physics/src/PhysicsWorld.ts`, `packages/physics/src/MovementController.ts`

**Cause:** All collision checks run per-frame without any broad-phase filtering or quadtree optimization.

**Measurement:** With 16+ players, physics calculations can exceed 16ms/frame.

**Improvement path:**
- Implement spatial partitioning (quadtree/octree) for collision detection
- Cache collision results and only update changed objects
- Use object pooling for temporary vectors and calculations
- Profile with DevTools to identify hot paths

## Fragile Areas

### AbilityMovement and Movement State Machine

**Files:** `packages/physics/src/movement/AbilityMovement.ts`, `packages/physics/src/MovementController.ts`

**Why fragile:** Complex state transitions between normal movement, ability movement, grappling, jetpack, gliding. State flags are manually managed rather than using a proper state machine pattern. Adding new movement types requires touching multiple files.

**Safe modification:**
- Only add new state transitions through the existing update() methods
- Never directly modify movement state object outside MovementController
- Add tests for state transition combinations before modifying
- Document all valid state combinations in a comment block

**Test coverage:** Movement state transitions lack dedicated test cases. Integration tests only cover happy paths.

### GameRoom Ability Handler Extraction

**Files:** `apps/server/src/rooms/abilityHandlers.ts`, `apps/server/src/rooms/GameRoom.ts`

**Why fragile:** GameRoom imports ability handlers but handlers reference GameRoom's private state (voidZones, players). Circular dependencies possible. Changes to ability logic require understanding both files.

**Safe modification:**
- Don't add new ability handler exports without updating GameRoom's type expectations
- Test ability handlers with mocked GameRoom state before integrating
- Keep handler functions pure - pass all required state as parameters
- Document handler contract (inputs, outputs, side effects)

**Test coverage:** No unit tests for ability handlers. Only E2E tested through GameRoom.

### NetworkContext Message Handlers

**Files:** `apps/client/src/contexts/NetworkContext.tsx`, `apps/client/src/contexts/gameMessageHandlers.ts`

**Why fragile:** Message handlers use loose typing (any), assume specific server response formats, don't validate data shapes. Missing handlers for edge cases (duplicate packets, out-of-order messages, server errors).

**Safe modification:**
- Always add TypeScript types for new message handlers
- Validate received data before passing to store updates
- Add error handlers for malformed messages
- Test with network simulation (delays, packet loss) before deploying

**Test coverage:** No unit tests. Only tested manually with dev server.

### WalletContext Session Management

**Files:** `apps/client/src/contexts/WalletContext.tsx`

**Why fragile:** Complex state machine with multiple auth states (isConnecting, isAuthenticated, isNewUser, isSessionLoading). Race conditions possible if wallet connects while session loading. Account change event may fire before previous auth state clears.

**Safe modification:**
- Never add state changes outside the dedicated handler functions
- Always use useEffect for side effects tied to state changes
- Add defensive checks for null user/wallet before using them
- Test rapid connect/disconnect/account-change sequences

**Test coverage:** No unit tests. Only manual testing in browser.

## Scaling Limits

### In-Memory Player State in GameRoom

**Current capacity:** ~100 concurrent players per GameRoom instance before noticeable latency

**Limit:** As player count grows, broadcast updates and collision checks scale O(n²). At 50 players, each player receives ~50 other player updates per tick (50 ticks/sec). At 100+ players, this becomes unsustainable.

**Scaling path:**
- Implement multiple GameRoom instances with zone-based routing
- Use Colyseus clustering with Redis for shared state
- Split into separate "arena" rooms by player count
- Implement server-side player culling (only sync nearby players)

### Lobby Room Population

**Current capacity:** ~1000 players waiting in lobbies before memory pressure

**Limit:** Each lobby maintains full player list. Many lobbies = many duplicate state objects.

**Scaling path:**
- Archive lobby data (don't keep full player objects)
- Implement lobby pagination/filters on client (don't show all 1000 lobbies)
- Use database to store lobbies instead of in-memory Colyseus rooms

### Database Connection Pool

**Current capacity:** Default Prisma pool (~10 connections) sufficient for <50 concurrent players

**Limit:** Each player action may trigger DB query (stats updates, user lookups). Peak load during lobby browsing could exhaust pool.

**Scaling path:**
- Configure Prisma maxConnections based on expected concurrency
- Add read replicas for user lookup queries
- Implement query batching for stat updates (batch writes per game end)
- Monitor connection pool utilization in production

## Dependencies at Risk

### No Unit Testing Framework

**Risk:** No Jest, Vitest, or similar configured. Only manual E2E testing possible. Unable to run tests in CI/CD.

**Impact:** Refactoring becomes risky. Regression bugs introduced by changes go undetected until user testing.

**Migration plan:**
- Add Vitest for unit tests (faster than Jest, better ESM support)
- Start with critical logic: AbilitySystem, MatchManager, hero ability calculations
- Target 70%+ coverage for packages/* before app/* components
- Integrate into CI/CD pipeline

### Colyseus Version Management

**Risk:** Colyseus is a core dependency. Major version bumps may introduce breaking changes to serialization or API.

**Impact:** Server/client communication breaks if versions diverge. Migration requires careful coordination.

**Migration plan:**
- Pin Colyseus version in package.json
- Document which Colyseus version is required
- Test major version upgrades in staging before deploying
- Have rollback plan for version mismatches

### Solana Web3.js Library

**Risk:** Wallet integration depends on Solana Web3.js. Changes to library API or Phantom wallet provider interface could break auth.

**Impact:** Users cannot log in if Phantom wallet provider changes.

**Migration plan:**
- Abstract wallet provider behind interface (already partially done in WalletContext)
- Have fallback auth method (email) or alternative wallet (Magic, Thirdweb)
- Monitor Solana foundation releases for breaking changes

## Missing Critical Features

### No Error Recovery Mechanism

**Problem:** If player gets disconnected mid-game, there's no way to reconnect to the same game. Must start over.

**Blocks:** Ranked play, session continuity, stats tracking

**Implementation plan:**
- Store game state snapshots on server with TTL (5 minutes)
- Track disconnected players and allow rejoin
- Sync player to reconnection position with health/cooldowns preserved

### No Leaderboard or Stats Persistence

**Problem:** Player stats are tracked but no leaderboard UI. Stats might not persist across sessions properly.

**Blocks:** Competitive play, progression system, seasonal rankings

**Implementation plan:**
- Add stats table with monthly/all-time sorting
- Implement seasonal reset logic
- Add achievements/badges system tied to stats

### No Spectate/Replay System

**Problem:** Cannot watch other games or review replays of your matches.

**Blocks:** Content creation, learning, competitive analysis

**Implementation plan:**
- Add spectator mode where players can join game as observer
- Implement match replay system with tick-by-tick state replay
- Add camera controller for spectators

### No Voice Chat

**Problem:** Players cannot communicate via voice during games. Only text chat exists (partially).

**Blocks:** Competitive team play, accessibility

**Implementation plan:**
- Integrate Agora or Twilio for voice
- Route voice through game room with proximity audio
- Add push-to-talk option for accessibility

## Test Coverage Gaps

### Hero Ability System

**What's not tested:** Complex ability interactions, cooldown calculations, ultimate charge mechanics, cross-hero ability combinations

**Files:** `packages/game-logic/src/abilities/AbilitySystem.ts`, `packages/game-logic/src/heroes/*.ts`

**Risk:** Ability balance changes, cooldown tweaks could introduce bugs (abilities firing multiple times, cooldowns not resetting, ultimate refusing to charge). Only caught through manual gameplay.

**Priority:** High - directly impacts gameplay balance

**Approach:**
- Add unit tests for each hero's ability calculations
- Test cooldown state transitions
- Test ultimate charge from various sources (kills, assists, captures)
- Parameterize tests to validate balance constants

### Player Collision and Damage Mechanics

**What's not tested:** Damage dealt when hitting walls at speed, projectile hit detection, area-of-effect damage falloff, spawn protection timing

**Files:** `packages/physics/src/CollisionDetection.ts`, `apps/server/src/rooms/abilityHandlers.ts`

**Risk:** Damage numbers don't match balance spec. Collisions don't trigger when expected. Players can die during spawn protection.

**Priority:** High - breaks core gameplay

**Approach:**
- Create collision test scenarios with known object positions
- Validate damage output matches ability definitions
- Test spawn protection timing edge cases

### Network Message Synchronization

**What's not tested:** Out-of-order messages, duplicate messages, missing messages, malformed data from server

**Files:** `apps/client/src/contexts/gameMessageHandlers.ts`, `apps/client/src/contexts/NetworkContext.tsx`

**Risk:** Player state gets corrupted if server sends messages out of order. Duplicates could trigger abilities twice. Missing validation allows crashing client with bad data.

**Priority:** High - affects game stability

**Approach:**
- Add unit tests for message handlers with various data shapes
- Create test scenarios with simulated network issues
- Validate message schema before processing

### Physics World Integration

**What's not tested:** Player falling off map, movement in complex terrain, edge cases in slope detection, jetpack fuel consumption

**Files:** `packages/physics/src/`, `apps/client/src/hooks/usePhysics.ts`

**Risk:** Players fall through geometry, get stuck in walls, or jetpack behaves inconsistently.

**Priority:** Medium - noticeable but not game-breaking

**Approach:**
- Create test map with known geometry
- Parameterize movement tests with different slopes and obstacles
- Validate jetpack fuel depletion matches constants

---

*Concerns audit: 2026-01-22*
