# Architecture

**Analysis Date:** 2026-01-22

## Pattern Overview

**Overall:** Client-Server Multiplayer Game with Monorepo Structure

**Key Characteristics:**
- Turborepo monorepo with shared packages and separate apps (client, server)
- Colyseus room-based synchronization for real-time multiplayer state
- Zustand stores for client-side state management (both reactive and non-reactive)
- Physics-based movement with Rapier.js integration
- Deterministic game loop with fixed tick rate (20Hz)
- Visual state separated from authoritative server state to optimize rendering

## Layers

**Presentation (Client):**
- Purpose: React UI components, Three.js 3D rendering, user interaction
- Location: `apps/client/src/components/`
- Contains: UI screens (lobby, hero select, HUD), 3D game world, visual effects
- Depends on: Game store (Zustand), Network context, Physics hooks
- Used by: App root component, displayed to players

**Game Logic (Shared):**
- Purpose: Hero definitions, ability systems, CTF rules, match management
- Location: `packages/game-logic/src/`
- Contains: Hero classes, ability effects, game mode implementations, spawn managers
- Depends on: Physics package, Shared types
- Used by: Client (for visualization), Server (for validation/simulation)

**Physics & Movement (Shared):**
- Purpose: Player movement, collision detection, physics simulation
- Location: `packages/physics/src/`
- Contains: Movement controllers (base, aerial, parkour, ability), physics world wrapper
- Depends on: Rapier.js, Shared types
- Used by: Both client and server for movement validation

**Shared Types & Constants:**
- Purpose: Type definitions, game constants, shared utilities
- Location: `packages/shared/src/`
- Contains: Types for Player, Hero, Ability, Input; game config constants
- Depends on: None
- Used by: All packages and apps

**Network & Rooms (Server):**
- Purpose: Colyseus room implementations, WebSocket communication
- Location: `apps/server/src/rooms/`
- Contains: GameRoom, LobbyRoom classes with schema definitions
- Depends on: Colyseus, Shared types, Game logic, Physics
- Used by: Game server, accessed by clients via WebSocket

**API & Authentication (Server):**
- Purpose: REST endpoints for lobbies, authentication, health checks
- Location: `apps/server/src/auth/`, `apps/server/src/index.ts`
- Contains: Express routes, JWT/Solana wallet verification
- Depends on: Colyseus matchmaker, Database (Prisma), Solana web3.js
- Used by: Client for authentication, lobby listing

**State Management (Client):**
- Purpose: Client-side game state, input state, UI state
- Location: `apps/client/src/store/`
- Contains: gameStore (Zustand with slices), visualStore (non-reactive), store types
- Depends on: Shared types, Redux-like slicing pattern
- Used by: Components, hooks, contexts for state access and updates

**Network Context (Client):**
- Purpose: Colyseus client, room connection management, message handling
- Location: `apps/client/src/contexts/NetworkContext.tsx`
- Contains: Lobby/game room joining, player operations, message routing
- Depends on: Colyseus.js, Store actions, Game message handlers
- Used by: App, UI components for multiplayer operations

## Data Flow

**Authentication & Lobby Flow:**

1. Client connects → WalletProvider authenticates via Solana wallet
2. User joins MainLobby → NetworkContext fetches lobbies from `/lobbies` endpoint
3. User creates/joins lobby → NetworkContext joins LobbyRoom (Colyseus)
4. LobbyRoom maintains player list, ready states, team assignments
5. Lobby host starts game → LobbyRoom broadcasts game start, creates GameRoom
6. Players join GameRoom → GameRoom initializes physics, game state

**Game Loop & Input:**

1. **Client Input (60fps):** useInput hook captures keyboard/mouse
2. **Input Packaging (20Hz):** PlayerController sends InputState to server via `input` message
3. **Server Processing (20Hz):** GameRoom.tick() receives input, updates player state
4. **Physics Simulation:** Server applies movement, ability effects, collision detection
5. **State Broadcast:** GameRoom broadcasts GameState changes to all clients
6. **Client Sync:** NetworkContext updates gameStore, triggers React re-renders
7. **Visual Update (60fps):** useFrame in PlayerController reads gameStore and visualStore

**Ability Execution Flow:**

1. Player presses ability key → useInput captures action
2. PlayerController sends input to server
3. Server abilityHandlers check cooldown, charges, conditions
4. Server executes ability logic (spawn projectiles, apply effects, damage)
5. Server updates state (cooldowns, charges, position changes)
6. Server broadcasts updated state to all clients
7. Client visualStore interpolates effects
8. Client hero-specific effect components render visual feedback

**State Management:**

- **Authoritative State:** Server maintains GameState in Colyseus schema
- **Client Replica:** gameStore holds shadow copy of server state
- **Visual State:** visualStore holds per-frame interpolation targets, camera effects
- **UI State:** gameStore holds app phase, lobby info, readiness

## Key Abstractions

**Room Pattern (Colyseus):**
- Purpose: Isolated game instances (lobby, game)
- Examples: `apps/server/src/rooms/GameRoom.ts`, `apps/server/src/rooms/LobbyRoom.ts`
- Pattern: Room<Schema> base class with onCreate, onJoin, onLeave, onMessage handlers

**Hero System:**
- Purpose: Define unique hero abilities, stats, movement
- Examples: `packages/game-logic/src/heroes/` (PhantomHero, BlazeHero, HookshotHero, etc.)
- Pattern: Hero classes with ability definitions, stat scaling, effect triggers

**Store Slicing (Zustand):**
- Purpose: Organize game state by domain (projectiles)
- Examples: `apps/client/src/store/slices/projectiles.ts`
- Pattern: Slice creators export state interface and actions, composed in main store

**Movement Controllers:**
- Purpose: Encapsulate movement physics for different states
- Examples: `packages/physics/src/movement/BaseMovement.ts`, `AerialMovement.ts`, `ParkourMovement.ts`
- Pattern: Controller objects with update(input, deltaTime) methods

**Effect Managers:**
- Purpose: Orchestrate hero-specific visual/audio effects
- Examples: `apps/client/src/components/game/BlazeEffects.tsx`, `PhantomEffects.tsx`
- Pattern: Three.js components that subscribe to game store and render effects

## Entry Points

**Client Bootstrap:**
- Location: `apps/client/src/main.tsx`
- Triggers: Browser loads http://localhost:5173
- Responsibilities: Render React root with providers (WalletProvider, NetworkProvider), polyfill Buffer

**App Root:**
- Location: `apps/client/src/App.tsx`
- Triggers: React component tree initialization
- Responsibilities: Route between app phases (menu, browsing_lobbies, in_lobby, in_game), manage UI overlays

**Game Canvas:**
- Location: `apps/client/src/components/game/GameCanvas.tsx`
- Triggers: App switches to in_game phase
- Responsibilities: Initialize Three.js Canvas, set up lights/sky, render 3D world

**Player Controller:**
- Location: `apps/client/src/components/game/PlayerController.tsx`
- Triggers: Game is playing or pre-game phase
- Responsibilities: Aggregate player input, movement, abilities; sync with server each tick

**Server Entry:**
- Location: `apps/server/src/index.ts`
- Triggers: `pnpm run dev:server`
- Responsibilities: Create Express app, Colyseus server, register rooms, set up auth routes

**GameRoom:**
- Location: `apps/server/src/rooms/GameRoom.ts`
- Triggers: Player joins from LobbyRoom
- Responsibilities: Tick loop, input handling, ability execution, state synchronization

**LobbyRoom:**
- Location: `apps/server/src/rooms/LobbyRoom.ts`
- Triggers: Player creates or joins lobby
- Responsibilities: Player management, team/hero selection, game start coordination

## Error Handling

**Strategy:** Client-side defensive with server validation

**Patterns:**
- Client checks UI state before sending inputs (prevent stale sends)
- Server validates all inputs before executing (prevent cheating)
- Client displays error toast for failed operations (network timeouts, auth failures)
- Server broadcasts chat messages for game state changes (inform players of events)
- Disconnection detection: clientId mapping for reconnection, auto-rejoin on disconnect

## Cross-Cutting Concerns

**Logging:** Console.log in server rooms for development; game phases and room lifecycle

**Validation:**
- Shared input state types ensure client/server speak same language
- Server abilityHandlers validate hero ownership, cooldown, conditions before execution
- Colyseus schema validation prevents invalid state broadcasts

**Authentication:**
- Solana wallet signature verification in WalletContext
- JWT tokens stored in cookies for session persistence
- Auth endpoint validates signature, returns user ID and JWT

**Reconnection:**
- Client generates persistent clientId stored in localStorage
- GameRoom tracks clientId→sessionId mapping to detect duplicate connections
- Old session kicked, new session inherits player state, position preserved
