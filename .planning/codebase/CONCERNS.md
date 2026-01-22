# Codebase Concerns

**Analysis Date:** 2024-11-22

## Tech Debt

**Large UI Components:**
- Issue: MainLobby.tsx (1,411 lines) violates single responsibility principle
- Files: `[apps/client/src/components/ui/MainLobby.tsx]`
- Impact: Difficult to maintain, test, and reason about
- Fix approach: Break into smaller focused components: LobbyActions, HeroDisplay, AuthForm, SettingsPanel

**Game Room Monolith:**
- Issue: GameRoom.ts (1,250 lines) handles multiple concerns (state, networking, abilities, NPCs)
- Files: `[apps/server/src/rooms/GameRoom.ts]`
- Impact: Hard to debug and extend individual features
- Fix approach: Extract managers for abilities, NPCs, and combat into separate classes

**Missing Error Boundaries:**
- Issue: No error boundaries in React component tree
- Files: `[apps/client/src/` throughout the hierarchy]`
- Impact: Uncaught errors crash the entire client application
- Fix approach: Add ErrorBoundary components around critical sections like game view and lobby

**TODO Implementation Gaps:**
- Issue: Multiple placeholder implementations with TODO comments
- Files: `[apps/client/src/hooks/useNetworkClient.ts:65-75]`
- Impact: Missing features (kill feed, notifications, celebrations)
- Fix approach: Implement missing features or replace with appropriate null states

## Known Bugs

**Disconnect Handling:**
- Issue: Clients may receive stale state after disconnect/reconnect
- Files: `[apps/server/src/rooms/GameRoom.ts:58-60]`
- Trigger: Rapid disconnect/reconnect cycles
- Workaround: Manual refresh required

**Memory Leaks in Effects:**
- Issue: Some useEffect hooks don't clean up subscriptions
- Files: `[apps/client/src/hooks/useAudio.ts:780]`
- Symptoms: Memory usage grows over time in long sessions
- Trigger: Multiple game joins without clean disconnect

**Physics Collision Edge Cases:**
- Issue: Character clips through walls at high speeds
- Files: `[packages/physics/src/CollisionDetection.ts]`
- Trigger: High-speed movement combined with ability usage
- Workaround: Limit maximum velocity

## Security Considerations

**Excessive Console Logging:**
- Risk: Sensitive game state exposed in server logs
- Files: `[apps/server/src/rooms/GameRoom.ts:65-125]`
- Current mitigation: Basic console.log statements
- Recommendations: Replace with structured logging, remove debug output in production

**Session Validation:**
- Risk: Potential for session hijacking withClientId reuse
- Files: `[apps/server/src/rooms/LobbyRoom.ts:59-68]`
- Current mitigation: Basic duplicate detection
- Recommendations: Implement proper session token rotation

**Input Validation:**
- Risk: Malicious client could send invalid ability inputs
- Files: `[apps/server/src/rooms/abilityHandlers.ts]`
- Current mitigation: Basic cooldown/charge checks
- Recommendations: Add server-side validation for all player inputs

## Performance Bottlenecks

**Large React Components:**
- Problem: MainLobby.tsx re-renders entire subtree on state change
- Files: `[apps/client/src/components/ui/MainLobby.tsx]`
- Cause: Single large component with many state dependencies
- Improvement path: Component splitting with React.memo and selective state updates

**Physics Engine Overhead:**
- Problem: Physics calculations run at fixed tick rate regardless of game state
- Files: `[packages/physics/src/PhysicsWorld.ts]`
- Cause: Continuous expensive collision detection
- Improvement path: Adaptive tick rate based on game complexity

**Memory Usage in Effects:**
- Problem: Multiple useEffect hooks create unnecessary subscriptions
- Files: `[apps/client/src/hooks/usePhysics.ts:705]`
- Cause: Over-subscription to game state updates
- Improvement path: Merge related subscriptions and implement LOD for distant objects

## Fragile Areas

**Hero Ability Implementation:**
- Files: Multiple hero components under `[apps/client/src/components/game/]`
- Why fragile: Tight coupling between hero-specific logic and global systems
- Safe modification: Create hero-specific abstraction layers with interfaces
- Test coverage: Partial, needs integration tests for hero interactions

**Network State Management:**
- Files: `[apps/client/src/contexts/NetworkContext.tsx:557]`
- Why fragile: Complex state synchronization between client and server
- Safe modification: Implement state machine with clear transition rules
- Test coverage: Low, needs network simulation tests

**Game Mode Logic:**
- Files: `[packages/game-logic/src/match/MatchManager.ts:520]`
- Why fragile: Game mode logic mixed with core game mechanics
- Safe modification: Extract game mode implementations into strategy pattern
- Test coverage: Basic, needs comprehensive game flow testing

## Scaling Limits

**Room Player Count:**
- Current capacity: ~20-25 players before performance degradation
- Limit: Physics calculations become CPU bound
- Scaling path: Implement server-authoritative movement prediction

**Memory per Room:**
- Current capacity: ~100MB per game room
- Limit: Unbounded NPC spawning
- Scaling path: NPC pooling and instance reuse

**Network Message Frequency:**
- Current capacity: 60 ticks/second for all players
- Limit: Network bandwidth with many players
- Scaling path: Compress state updates and prioritize critical data

## Dependencies at Risk

**colyseus:**
- Risk: Heavy dependency on Colyseus architecture
- Impact: Major rewrite needed if switching networking solution
- Migration plan: Abstract networking layer behind interface

**React Three Fiber:**
- Risk: Performance issues with complex 3D scenes
- Impact: May need to switch to lower-level rendering for scalability
- Migration plan: Progressive migration to custom renderer

## Missing Critical Features

**Anti-Cheat System:**
- Problem: No client-side validation beyond basic checks
- Blocks: Competitive play and fair gameplay
- Priority: High

**Reconnection System:**
- Problem: Players must refresh after disconnect
- Blocks: Reliable online experience
- Priority: High

**Spectator Mode:**
- Problem: No way to watch games as spectator
- Blocks: Esports and content creation
- Priority: Medium

## Test Coverage Gaps

**Physics Integration:**
- What's not tested: Complex ability-physics interactions
- Files: `[packages/physics/src/]`
- Risk: Ability movement could cause physics exploits
- Priority: High

**Network Resilience:**
- What's not tested: Lag, packet loss, and reconnection scenarios
- Files: `[apps/client/src/contexts/NetworkContext.tsx]`
- Risk: Poor user experience on unstable connections
- Priority: High

**Memory Management:**
- What's not tested: Long session memory leaks
- Files: `[apps/client/src/hooks/` and effects]`
- Risk: Client crashes after extended play
- Priority: Medium

---

*Concerns audit: 2024-11-22*