# Codebase Concerns

**Analysis Date:** 2026-01-22

## Tech Debt

**TODO Comments for Missing UI Features:**
- Issue: Three TODO comments in network client for unimplemented UI feedback (kill feed, notifications, celebrations)
- Files: `apps/client/src/hooks/useNetworkClient.ts` (lines 65, 70, 75)
- Impact: Events are logged but not shown to players, reducing game feel and awareness
- Fix approach: Implement kill feed component and integrate with existing event handlers

**Excessive Console Logging in Production Code:**
- Issue: 80+ console.log/warn/error calls throughout client code for debugging state sync, player joins, ability usage
- Files: `apps/client/src/contexts/gameMessageHandlers.ts`, `apps/client/src/contexts/NetworkContext.tsx`, `apps/client/src/hooks/usePhysics.ts`, `apps/client/src/contexts/WalletContext.tsx`
- Impact: Performance overhead in production, cluttered browser console, potential information leakage
- Fix approach: Replace with proper logging framework with configurable levels, or wrap in `import.meta.env.DEV` conditionals

**Ghost Player Detection Workarounds:**
- Issue: Multiple defensive checks throughout message handlers to detect and ignore "ghost players" (duplicate sessions with same name but different IDs)
- Files: `apps/client/src/contexts/gameMessageHandlers.ts` (lines 153, 192, 250, 296), `apps/server/src/rooms/GameRoom.ts` (lines 118-150)
- Impact: Indicates fragile session management, periodic cleanup needed (every 10 polls), potential for duplicate player rendering
- Fix approach: Improve server-side session handling to prevent ghost creation, enforce single-session-per-clientId at connection time

**Race Condition Workarounds for Ultimate Charge:**
- Issue: Client-side race condition protection with hardcoded thresholds (50 point jumps, 5 point drops) to prevent charge desync
- Files: `apps/client/src/contexts/gameMessageHandlers.ts` (lines 306-315)
- Impact: Ultimate charge may desync between client/server requiring manual reconciliation logic, magic number thresholds fragile
- Fix approach: Implement proper server authority for ultimate charge with client prediction rollback, or use sequence numbers for state updates

**In-Memory Nonce Storage:**
- Issue: Wallet authentication nonces stored in Map with interval-based cleanup instead of Redis/database
- Files: `apps/server/src/auth/routes.ts` (lines 44-54)
- Impact: Nonces lost on server restart, horizontal scaling impossible (each server has different nonces), 5-minute cleanup interval
- Fix approach: Migrate to Redis with TTL expiry for production deployment, or document single-server limitation

**Hardcoded JWT Secret Default:**
- Issue: JWT secret falls back to hardcoded string if JWT_SECRET env var not set
- Files: `apps/server/src/auth/routes.ts` (line 10)
- Impact: Security vulnerability if deployed without proper env configuration, all tokens compromised if default used
- Fix approach: Fail fast on startup if JWT_SECRET not set in production mode, validate env vars before server starts

**Manual clientId Mapping for Reconnection:**
- Issue: Manual Map-based clientId tracking for duplicate session detection instead of framework feature
- Files: `apps/server/src/rooms/GameRoom.ts` (lines 59-60, 118-150)
- Impact: Complex manual state management, potential for race conditions during reconnection, cleanup logic spread across onJoin/onLeave
- Fix approach: Investigate Colyseus built-in reconnection features or extract to dedicated session manager class

## Known Bugs

**Physics Fallback Resolution on GLB Load Failure:**
- Symptoms: GLB terrain loading errors resolve anyway to let game continue with fallback ground plane
- Files: `apps/client/src/hooks/usePhysics.ts` (line 176)
- Trigger: Network error or invalid GLB file when loading map colliders
- Workaround: Falls back to low ground plane at y=-50, game playable but with wrong terrain
- Impact: Players can fall through map, invisible collision boundaries

**Pointer Lock Exit Handling:**
- Symptoms: ESC key exits pointer lock and opens menu, but logic assumes document.pointerLockElement state
- Files: `apps/client/src/App.tsx` (lines 74-83)
- Trigger: User presses ESC or browser exits pointer lock for other reasons
- Workaround: Event listener on pointerlockchange
- Impact: Potential race condition if state updates before event fires

## Security Considerations

**Wallet Authentication Flow:**
- Risk: Nonce replay attacks if server restarts and Map clears mid-authentication
- Files: `apps/server/src/auth/routes.ts` (lines 44-54, 81-100)
- Current mitigation: 5-minute timestamp check, nonce validation
- Recommendations: Add Redis for persistent nonce storage, implement nonce cleanup on successful auth, add rate limiting per wallet address

**Production Server URL Placeholder:**
- Risk: VITE_SERVER_URL defaults to example.com placeholder, requires manual configuration
- Files: `apps/client/src/config/environment.ts` (line 8)
- Current mitigation: None, fails at runtime if not configured
- Recommendations: Add build-time validation for production builds, fail if placeholder value detected

**Cookie Security Configuration:**
- Risk: httpOnly cookies but secure/sameSite only enabled in production NODE_ENV check
- Files: `apps/server/src/auth/routes.ts` (lines 26-31, 36-40)
- Current mitigation: NODE_ENV-based conditional
- Recommendations: Validate NODE_ENV is set correctly in deployment, use separate prod/dev env files

## Performance Bottlenecks

**Large UI Components:**
- Problem: MainLobby.tsx at 1411 lines, HUD.tsx at 922 lines, GameConsole.tsx at 670 lines
- Files: `apps/client/src/components/ui/MainLobby.tsx`, `apps/client/src/components/ui/HUD.tsx`, `apps/client/src/components/ui/GameConsole.tsx`
- Cause: Monolithic components with mixed concerns (logic, rendering, state)
- Improvement path: Split into smaller sub-components, extract logic to custom hooks, use React.memo for expensive renders

**Server Room Complexity:**
- Problem: GameRoom.ts at 1250 lines with mixed responsibilities (input handling, physics, abilities, CTF logic, NPC spawning)
- Files: `apps/server/src/rooms/GameRoom.ts`
- Cause: Single class handles entire game simulation
- Improvement path: Extract systems (CTFManager, AbilityManager, SpawnManager already partially done), use composition pattern

**Excessive any Type Usage:**
- Problem: 50+ uses of `any` type in client code, especially in message handlers and Colyseus schema interactions
- Files: `apps/client/src/contexts/gameMessageHandlers.ts` (lines 45, 51, 112, 116, 128, 167, 292, 466, 469, 481), `apps/client/src/contexts/NetworkContext.tsx`, ability hooks
- Cause: Colyseus schema typing limitations, quick iteration without proper types
- Improvement path: Define proper types for schema objects, use type guards, create type-safe wrappers for Colyseus API

**50ms Polling for State Sync:**
- Problem: Client polls room.state every 50ms for manual sync in addition to message handlers
- Files: `apps/client/src/contexts/gameMessageHandlers.ts` (lines 442-496)
- Cause: Workaround for missed state changes, complement to event-based sync
- Improvement path: Investigate why polling needed, improve event-based sync reliability, increase interval if polling required

## Fragile Areas

**Player State Synchronization:**
- Files: `apps/client/src/contexts/gameMessageHandlers.ts`, `apps/client/src/store/gameStore.ts` (lines 244-348)
- Why fragile: Complex in-place Map mutation to avoid React re-renders, multiple sync sources (schema onChange, playerStates message, polling), ghost player cleanup
- Safe modification: Add comprehensive logging to track state changes, test with multiple clients connecting/disconnecting, use React DevTools to verify re-render count
- Test coverage: No automated tests for sync logic

**Ice Wall Collision System:**
- Files: `apps/client/src/hooks/physics/iceWallColliders.ts`, hooks throughout client for dynamic collider add/remove
- Why fragile: Dynamic Rapier collider creation/destruction, error handling with silent failures, global state for ice wall tracking
- Safe modification: Verify Rapier world is initialized before add/remove, always pair add with remove in cleanup, test collider lifecycle
- Test coverage: No automated tests, relies on runtime error catching

**Ability Press State Tracking:**
- Files: `apps/server/src/rooms/GameRoom.ts` (lines 46, 153)
- Why fragile: Global Map outside room state to detect key press vs hold, manual cleanup on player leave
- Safe modification: Always cleanup in onLeave, consider moving to player state schema
- Test coverage: No automated tests for ability cooldown/press detection

**Visual Store Position Updates:**
- Files: `apps/client/src/store/visualStore.ts`, `apps/client/src/store/gameStore.ts` (lines 300-304, 343-347, 381-385, 398-400)
- Why fragile: Parallel state in visualStore (non-reactive) and gameStore (reactive), position data must be synced to both
- Safe modification: Always update both stores together, never read from one expecting the other updated, document why dual stores needed
- Test coverage: No automated tests, manual verification of interpolation smoothness

## Scaling Limits

**Single Colyseus Server Instance:**
- Current capacity: In-memory nonce storage, no Redis/database for session state
- Limit: Cannot horizontally scale to multiple server instances
- Scaling path: Add Redis for shared state (nonces, sessions), use Colyseus presence API for multi-server coordination

**Client-Side Physics World:**
- Current capacity: Full Rapier physics world with trimesh colliders for entire map
- Limit: Memory and CPU on client, complex maps with many vertices may cause load delays
- Scaling path: Level streaming/chunking for larger maps, simplify collision meshes, use bounding volumes instead of trimesh where possible

**Zustand Map-Based Player Storage:**
- Current capacity: Map<string, Player> with in-place mutation to avoid re-renders
- Limit: All player data in single store, grows linearly with player count
- Scaling path: Already optimized with in-place mutation, consider partitioning by visibility/proximity for very large player counts (100+)

## Dependencies at Risk

**Rapier.js WASM Compatibility:**
- Risk: Using @dimforge/rapier3d-compat instead of native rapier3d for Node.js compatibility
- Impact: Slight performance penalty vs native WASM, both client and server use compat version
- Migration plan: Not urgent, compat version stable and maintained, consider native version if Node.js compatibility no longer needed

**Zustand Version 5.0:**
- Risk: Project shows zustand@5.0.0 in client package.json but research docs reference v4 patterns
- Impact: Potential API differences, verify selector patterns compatible with v5
- Migration plan: Review Zustand v5 migration guide, test selector pattern behavior

**Colyseus 0.15.x:**
- Risk: Version 0.15 is current, active development, but some features experimental
- Impact: API stability generally good, check changelog for breaking changes
- Migration plan: Pin to minor version, test updates in development before production

## Missing Critical Features

**No Automated Testing:**
- Problem: Zero test files in application code (only node_modules tests found)
- Blocks: Refactoring safety, regression detection, deployment confidence
- Impact: High risk when modifying complex areas (state sync, physics, abilities)
- Priority: High - Add integration tests for multiplayer sync, unit tests for game logic

**No Proper Logging Framework:**
- Problem: console.log throughout, no structured logging, no log levels
- Blocks: Production debugging, error monitoring, performance analysis
- Impact: Cannot diagnose production issues, no metrics or alerts
- Priority: Medium - Add before production deployment

**No Error Boundaries:**
- Problem: React error boundaries not implemented for game components
- Blocks: Graceful error recovery, error reporting
- Impact: Single component error crashes entire game UI
- Priority: Medium - Add around major sections (Game, UI, Lobby)

**No Performance Monitoring in Production:**
- Problem: r3f-perf installed as dev dependency only, no production FPS/performance tracking
- Blocks: Production performance regression detection, user experience metrics
- Impact: Cannot detect client-side performance issues in the wild
- Priority: Low - Add lightweight FPS tracking to error reporting

## Test Coverage Gaps

**Multiplayer State Synchronization:**
- What's not tested: Player join/leave, ghost player cleanup, position sync, state reconciliation
- Files: `apps/client/src/contexts/gameMessageHandlers.ts`, `apps/client/src/contexts/NetworkContext.tsx`, `apps/server/src/rooms/GameRoom.ts`
- Risk: Race conditions, desync bugs, memory leaks from incomplete cleanup
- Priority: High - Core gameplay relies on sync correctness

**Ability System:**
- What's not tested: Cooldown tracking, ability execution, client-server validation, projectile lifecycle
- Files: `apps/client/src/hooks/player/abilities/*.ts`, `apps/server/src/rooms/abilityHandlers.ts`
- Risk: Exploits (ability spam), desync (cooldown mismatch), crashes (null references)
- Priority: High - Competitive integrity depends on ability fairness

**Physics Collision Detection:**
- What's not tested: Rapier raycast edge cases, trimesh collider creation, dynamic collider add/remove
- Files: `apps/client/src/hooks/usePhysics.ts`, `apps/client/src/hooks/physics/*.ts`
- Risk: Players falling through world, collision detection failures, memory leaks from collider orphans
- Priority: High - Game breaking if physics fails

**Wallet Authentication Flow:**
- What's not tested: Nonce generation/validation, signature verification, session management, JWT creation
- Files: `apps/server/src/auth/routes.ts`, `apps/server/src/auth/verify.ts`, `apps/client/src/contexts/WalletContext.tsx`
- Risk: Authentication bypass, session hijacking, nonce replay
- Priority: High - Security critical

**Store State Mutations:**
- What's not tested: In-place Map mutations, ghost cleanup, visual store sync, selector behavior
- Files: `apps/client/src/store/gameStore.ts`, `apps/client/src/store/visualStore.ts`
- Risk: State corruption, memory leaks, React re-render cascade, desync between stores
- Priority: Medium - Performance and correctness issues

**CTF Game Logic:**
- What's not tested: Flag pickup/drop/capture, scoring, team assignment, spawn logic
- Files: `apps/server/src/rooms/GameRoom.ts`, `packages/game-logic/src/ctf/*.ts`
- Risk: Incorrect scoring, flag duplication, spawn camping exploits
- Priority: Medium - Core game mode correctness

---

*Concerns audit: 2026-01-22*
