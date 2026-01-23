# Architecture

**Analysis Date:** 2026-01-22

## Pattern Overview

**Overall:** Client-Server Architecture with Real-time Multiplayer (Colyseus)

**Key Characteristics:**
- Turborepo monorepo with shared packages for code reuse
- Client-authoritative prediction with server reconciliation
- WebSocket-based real-time state synchronization via Colyseus
- Physics simulation on both client (visual) and server (authoritative)
- Component-based visual rendering with React Three Fiber

## Layers

**Client Application:**
- Purpose: Renders 3D game world, handles input, predicts movement, displays UI
- Location: `apps/client/`
- Contains: React components, Three.js/R3F rendering, client physics, UI, state management
- Depends on: `@voxel-strike/shared`, `@voxel-strike/game-logic`, `@voxel-strike/physics`, `@react-three/fiber`, `zustand`, `colyseus.js`
- Used by: End users via browser

**Server Application:**
- Purpose: Authoritative game state, physics simulation, matchmaking, authentication
- Location: `apps/server/`
- Contains: Colyseus rooms, server-side game logic, Prisma database client, auth handlers
- Depends on: `@voxel-strike/shared`, `@voxel-strike/game-logic`, `@voxel-strike/physics`, `colyseus`, `express`, `prisma`
- Used by: Client connects via WebSocket

**Shared Package:**
- Purpose: Type definitions, constants, and utilities used by both client and server
- Location: `packages/shared/`
- Contains: TypeScript types, game constants, math utilities
- Depends on: Nothing (pure TypeScript)
- Used by: All other packages and apps

**Game Logic Package:**
- Purpose: Hero definitions, ability systems, game mode logic (CTF), match management
- Location: `packages/game-logic/`
- Contains: Hero classes, ability systems, CTF flag management, spawn management
- Depends on: `@voxel-strike/shared`, `@voxel-strike/physics`
- Used by: Both client and server for consistent game rules

**Physics Package:**
- Purpose: Character movement physics, collision detection, Rapier3D integration
- Location: `packages/physics/`
- Contains: Physics world wrapper, movement controllers, collision detection
- Depends on: `@dimforge/rapier3d-compat`, `@voxel-strike/shared`
- Used by: Both client and server for movement simulation

## Data Flow

**Player Input Flow:**

1. User input captured in `apps/client/src/hooks/useInput.ts`
2. `PlayerController.tsx` processes input with client-side prediction
3. Input sent to server via `NetworkContext.tsx` → WebSocket
4. Server `GameRoom.ts` receives input, updates authoritative state
5. Server broadcasts state changes via Colyseus schema
6. Client receives updates in `NetworkContext.tsx` message handlers
7. Client reconciles predicted state with server state in `gameStore.ts`

**Game State Synchronization Flow:**

1. Server maintains authoritative `GameState` (Colyseus Schema)
2. Client polls state at 60Hz (`setupPollingSync` in `gameMessageHandlers.ts`)
3. Server state synced to client `gameStore` (Zustand)
4. Visual state separated in `visualStore` for smooth interpolation
5. React Three Fiber renders from visual state each frame

**Ability Execution Flow:**

1. Player presses ability key (detected in `PlayerController.tsx`)
2. Hero-specific hook handles client-side effects (`hooks/player/abilities/`)
3. Ability command sent to server via `sendInput`
4. Server validates ability in `GameRoom.ts` → `abilityHandlers.ts`
5. Server executes ability, updates game state
6. State changes broadcast to all clients
7. Clients render visual effects based on state updates

**State Management:**
- Client uses Zustand for global state (`gameStore.ts` - 508 lines)
- Separated visual state (`visualStore.ts`) for rendering interpolation
- Store organized with slices pattern (`slices/projectiles.ts`, `slices/glacier.ts`)
- Server uses Colyseus Schema for networked state synchronization

## Key Abstractions

**Hero System:**
- Purpose: Defines playable characters with unique abilities
- Examples: `packages/game-logic/src/heroes/PhantomHero.ts`, `packages/game-logic/src/heroes/BlazeHero.ts`, `packages/game-logic/src/heroes/GlacierHero.ts`
- Pattern: Class-based inheritance from `HeroBase.ts`, each hero defines stats and ability metadata

**Room Pattern (Colyseus):**
- Purpose: Manages multiplayer sessions with synchronized state
- Examples: `apps/server/src/rooms/GameRoom.ts`, `apps/server/src/rooms/LobbyRoom.ts`
- Pattern: Colyseus Room lifecycle (`onCreate`, `onJoin`, `onLeave`, `onMessage`), tick-based simulation

**Component Hooks:**
- Purpose: Encapsulate reusable game logic for React components
- Examples: `apps/client/src/hooks/player/useMovement.ts`, `apps/client/src/hooks/player/useCamera.ts`, `apps/client/src/hooks/player/abilities/useBlazeAbilities.ts`
- Pattern: Custom React hooks that return state and control functions

**Schema Definitions:**
- Purpose: Network-serializable state synchronized between client and server
- Examples: `apps/server/src/rooms/schema/GameState.ts`, `apps/server/src/rooms/schema/Player.ts`, `apps/server/src/rooms/schema/Components.ts`
- Pattern: Colyseus `@colyseus/schema` decorators for automatic serialization

**Visual Effects Manager:**
- Purpose: Coordinate 3D visual effects for hero abilities
- Examples: `apps/client/src/components/game/PhantomEffects.tsx`, `apps/client/src/components/game/BlazeEffects.tsx`
- Pattern: Manager components that subscribe to game store and spawn/update effect instances

## Entry Points

**Client Entry:**
- Location: `apps/client/index.html` → `apps/client/src/main.tsx` → `apps/client/src/App.tsx`
- Triggers: Browser loads page
- Responsibilities: Initialize React, set up providers (Wallet, Network), render app phase (menu/lobby/game)

**Server Entry:**
- Location: `apps/server/src/index.ts`
- Triggers: Node process starts (`npm run dev` or `node dist/index.js`)
- Responsibilities: Create Express server, initialize Colyseus game server, register room types, start HTTP server on port 2567

**Game Loop (Client):**
- Location: `apps/client/src/components/game/PlayerController.tsx` (`useFrame` hook)
- Triggers: React Three Fiber frame callback (60fps)
- Responsibilities: Update camera, process movement, update physics, handle abilities, send input to server

**Game Loop (Server):**
- Location: `apps/server/src/rooms/GameRoom.ts` (`tick()` method, called from `setInterval`)
- Triggers: Server tick interval (60Hz = 16.67ms)
- Responsibilities: Process inputs, update physics, execute abilities, update game state, detect collisions/damage

## Error Handling

**Strategy:** Defensive programming with try-catch blocks in critical paths, console logging for debugging

**Patterns:**
- Network errors: Logged in `NetworkContext.tsx`, user sees loading screens or disconnected state
- Physics errors: Rapier physics failures logged but don't crash game, players may fall through world
- Ability validation: Server rejects invalid abilities silently, client cooldowns prevent most issues
- State reconciliation: Client prediction errors corrected when server state arrives

## Cross-Cutting Concerns

**Logging:** Console logs throughout (removed in production build via Vite esbuild.drop). Debug console available in-game (backtick key) at `apps/client/src/components/ui/GameConsole.tsx`

**Validation:**
- Server validates all player inputs before applying
- Ability cooldowns enforced on both client (UX) and server (authority)
- Team balance checked in lobby before game start

**Authentication:**
- Solana wallet signature verification (`apps/server/src/auth/verify.ts`)
- JWT tokens issued via Express routes (`apps/server/src/auth/routes.ts`)
- Cookies used for session persistence

---

*Architecture analysis: 2026-01-22*
