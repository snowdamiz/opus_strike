# Architecture

**Analysis Date:** 2024-01-22

## Pattern Overview

**Overall:** Distributed Real-Time Multiplayer Architecture with Monorepo Package Structure

**Key Characteristics:**
- Client-Server WebSocket-based real-time multiplayer game
- Monorepo with shared packages and separate apps
- Physics-first 3D voxel-based combat game
- Component-based hero system with abilities
- State synchronization through Colyseus
- React Three Fiber for 3D rendering

## Layers

**Presentation Layer:**
- Purpose: UI rendering and user interaction
- Location: `apps/client/src`
- Contains: React components, hooks, contexts, Three.js/React Three Fiber
- Depends on: State management, Network layer, Game logic packages
- Used by: End users

**Network Layer:**
- Purpose: Real-time communication and state synchronization
- Location: `apps/server/src`, `apps/client/src/hooks`
- Contains: WebSocket handling, state schemas, message handlers
- Depends on: Colyseus framework, State models
- Used by: Client and server applications

**Game Logic Layer:**
- Purpose: Core game mechanics and rules
- Location: `packages/game-logic/src`
- Contains: Hero implementations, abilities, game modes
- Depends on: Physics engine, Shared types/constants
- Used by: Server for authoritative game logic

**Physics Layer:**
- Purpose: Movement, collision, and physics simulation
- Location: `packages/physics/src`
- Contains: Rapier3D integration, movement controllers
- Depends on: Rapier3D physics engine, Shared types
- Used by: Game logic, Client prediction

**Shared Layer:**
- Purpose: Type definitions, constants, utilities
- Location: `packages/shared/src`
- Contains: TypeScript types, game constants, math utilities
- Depends on: No external dependencies
- Used by: All other packages and apps

## Data Flow

**Client to Server Flow:**
1. User input captured via React event handlers
2. Input transformed to standardized format in hooks
3. Sent to server via WebSocket using Colyseus client
4. Server validates input and updates authoritative game state
5. Server broadcasts state updates to all connected clients

**Server to Client Flow:**
1. Server processes game tick and updates GameState
2. State changes pushed to all clients via WebSocket
3. Client receives state and updates Zustand store
4. React Three Fiber renders new positions/rotations
5. UI components update based on state changes

**State Management:**
- Server: Authoritative state maintained in Colyseus Room
- Client: Mirror state via Zustand store
- Shared: Single source of truth for types and constants
- Physics: Local prediction with server reconciliation

## Key Abstractions

**Hero System:**
- Purpose: Character-specific abilities and behaviors
- Examples: `packages/game-logic/src/heroes/`
- Pattern: Base Hero class with specific implementations

**Ability System:**
- Purpose: Shared ability mechanics and effects
- Examples: `packages/game-logic/src/abilities/`
- Pattern: Template method pattern for different ability types

**Physics World:**
- Purpose: 3D physics simulation
- Examples: `packages/physics/src/PhysicsWorld.ts`
- Pattern: Wrapper around Rapier3D physics engine

**Game State Schema:**
- Purpose: Networked game state synchronization
- Examples: `apps/server/src/rooms/schema/`
- Pattern: Colyseus Schema for real-time state sharing

**Movement Controller:**
- Purpose: Player movement and physics interactions
- Examples: `packages/physics/src/movement/`
- Pattern: Strategy pattern for different movement types

## Entry Points

**Client Entry Point:**
- Location: `apps/client/src/main.tsx`
- Triggers: React app initialization, Three.js setup
- Responsibilities: Root component rendering, provider setup

**Server Entry Point:**
- Location: `apps/server/src/index.ts`
- Triggers: Express server, Colyseus WebSocket server
- Responsibilities: Room registration, middleware setup

**Game Room:**
- Location: `apps/server/src/rooms/GameRoom.ts`
- Triggers: When players join game rooms
- Responsibilities: Game loop, state management, player coordination

**Lobby Room:**
- Location: `apps/server/src/rooms/LobbyRoom.ts`
- Triggers: When players wait for games
- Responsibilities: Player matchmaking, lobby state

## Error Handling

**Strategy:** Centralized error handling with graceful degradation

**Patterns:**
- WebSocket disconnection handling with reconnection logic
- Physics world error boundaries
- Schema validation on server state changes
- Client-side error boundaries for React components

## Cross-Cutting Concerns

**Logging:** Console logging with structured formatting
**Validation:** Input validation on server, type validation on client
**Authentication:** JWT-based auth via `/auth` routes
**Performance:** Physics tick rate optimization, delta time-based updates

---

*Architecture analysis: 2024-01-22*
```