# Codebase Structure

**Analysis Date:** 2026-01-22

## Directory Layout

```
voxel-strike/
├── apps/
│   ├── client/                 # Vite + React + Three.js game client
│   │   ├── src/
│   │   │   ├── components/     # React components organized by domain
│   │   │   ├── contexts/       # React contexts (NetworkContext, WalletContext)
│   │   │   ├── hooks/          # Custom hooks for logic extraction
│   │   │   ├── store/          # Zustand stores (gameStore, visualStore)
│   │   │   ├── config/         # Configuration files
│   │   │   ├── types/          # Local type definitions
│   │   │   ├── utils/          # Utilities (clientId, etc.)
│   │   │   ├── styles/         # CSS and Tailwind
│   │   │   ├── App.tsx         # Root component
│   │   │   └── main.tsx        # React DOM bootstrap
│   │   ├── public/             # Static assets (sounds, maps)
│   │   ├── dist/               # Build output
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── server/                 # Express + Colyseus game server
│       ├── src/
│       │   ├── rooms/          # Colyseus room implementations
│       │   │   ├── schema/     # Colyseus schema definitions
│       │   │   ├── GameRoom.ts
│       │   │   ├── LobbyRoom.ts
│       │   │   └── abilityHandlers.ts
│       │   ├── auth/           # Authentication routes and logic
│       │   ├── db/             # Database client initialization
│       │   └── index.ts        # Server entry point
│       ├── prisma/             # Prisma schema and migrations
│       ├── dist/               # Build output
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   ├── shared/                 # Shared types and constants (consumed by all)
│   │   ├── src/
│   │   │   ├── types/          # Type definitions (hero, ability, player, game)
│   │   │   ├── constants/      # Game config constants
│   │   │   ├── utils/          # Math utilities
│   │   │   └── index.ts        # Main export barrel
│   │   ├── dist/               # Build output
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── physics/                # Rapier physics and movement logic
│   │   ├── src/
│   │   │   ├── movement/       # Movement controllers by type
│   │   │   ├── PhysicsWorld.ts
│   │   │   ├── MovementController.ts
│   │   │   ├── CollisionDetection.ts
│   │   │   └── index.ts
│   │   ├── dist/               # Build output
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── game-logic/             # Hero definitions and game rules
│       ├── src/
│       │   ├── heroes/         # Hero class definitions
│       │   ├── abilities/      # Shared ability logic and effects
│       │   ├── match/          # Match management, spawn, flag rules
│       │   ├── ctf/            # Capture-the-flag game mode
│       │   └── index.ts
│       ├── dist/               # Build output
│       ├── tsconfig.json
│       └── package.json
│
├── pnpm-workspace.yaml         # Monorepo workspace configuration
├── turbo.json                  # Turborepo build orchestration
├── tsconfig.base.json          # Shared TypeScript config
├── package.json                # Workspace scripts (dev, build, lint)
├── .planning/                  # GSD planning directory
├── .gitignore
└── README.md
```

## Directory Purposes

**apps/client/src/components/:**
- Purpose: React UI components organized by feature domain
- Contains: Game UI (HUD, menus, overlays), 3D game objects (players, effects, world)
- Key subdirs: `game/` (3D rendering), `ui/` (2D screens and overlays)

**apps/client/src/contexts/:**
- Purpose: React context providers for cross-component communication
- Contains: NetworkContext (Colyseus rooms, multiplayer ops), WalletContext (Solana auth)

**apps/client/src/hooks/:**
- Purpose: Custom React hooks for logic extraction and reusability
- Contains: useInput (keyboard/mouse), usePhysics (Rapier world), useAudio, player-specific hooks
- Key subdirs: `player/` (movement, abilities, camera), `physics/` (collision helpers)

**apps/client/src/store/:**
- Purpose: Zustand state management with sliced domains
- Contains: gameStore (main reactive store), visualStore (non-reactive visual state), slices (projectiles, glacier)
- Pattern: Each slice exports state interface and actions, composed in index

**apps/client/src/config/:**
- Purpose: Environment and configuration constants
- Contains: environment.ts (server URLs), mapBoundaries.ts (level geometry)

**apps/client/src/styles/:**
- Purpose: Global CSS and Tailwind configuration
- Contains: index.css (global styles), Tailwind directives

**apps/server/src/rooms/:**
- Purpose: Colyseus room implementations for lobby and game state management
- Contains: GameRoom (gameplay), LobbyRoom (pre-game), schema (state definitions), ability handlers
- Pattern: Room<Schema> subclasses with message handlers

**apps/server/src/rooms/schema/:**
- Purpose: Colyseus schema definitions for network serialization
- Contains: GameState, LobbyState, Player, Components, Abilities
- Pattern: @type/@filter decorators for efficient delta compression

**apps/server/src/auth/:**
- Purpose: Authentication endpoints and verification logic
- Contains: routes.ts (Express endpoints), verify.ts (JWT/wallet verification)

**packages/shared/src/types/:**
- Purpose: Type definitions shared across client and server
- Contains: hero.ts, ability.ts, player.ts, game.ts, input.ts, network.ts, vector.ts
- Usage: Imported by all packages for type safety

**packages/shared/src/constants/:**
- Purpose: Game configuration and balance constants
- Contains: game.ts (gameplay config), physics.ts (movement params), heroes.ts (hero stats)
- Usage: Determines game mechanics, client and server must match exactly

**packages/physics/src/movement/:**
- Purpose: Encapsulated movement controllers for different locomotion types
- Contains: BaseMovement, AerialMovement, ParkourMovement, AbilityMovement
- Pattern: Controllers update position/velocity based on input and deltaTime

**packages/game-logic/src/heroes/:**
- Purpose: Hero class definitions with ability specs and stat scaling
- Contains: HeroBase, PhantomHero, BlazeHero, GlacierHero, etc.
- Pattern: Extend HeroBase with hero-specific ability definitions and passive effects

## Key File Locations

**Entry Points:**
- `apps/client/src/main.tsx`: Client bootstrap, React DOM render
- `apps/client/src/App.tsx`: Root app component, phase routing
- `apps/server/src/index.ts`: Server bootstrap, Express/Colyseus setup

**Configuration:**
- `apps/client/src/config/environment.ts`: Server URL, API endpoints
- `packages/shared/src/constants/game.ts`: Game config (max players, score to win, tick rate)
- `apps/server/src/rooms/abilityHandlers.ts`: Ability execution and cooldown logic

**Core Logic:**
- `apps/client/src/store/gameStore.ts`: Main client state store with all actions
- `apps/server/src/rooms/GameRoom.ts`: Server game loop, input processing, state broadcasting
- `packages/physics/src/PhysicsWorld.ts`: Rapier world initialization and collision queries

**Testing:**
- No dedicated test files currently; test infrastructure not detected

**Networking:**
- `apps/client/src/contexts/NetworkContext.tsx`: Colyseus client, room joining, message sending
- `apps/client/src/contexts/gameMessageHandlers.ts`: Server state sync handlers

## Naming Conventions

**Files:**
- Components: PascalCase (e.g., `PlayerController.tsx`, `GameCanvas.tsx`)
- Hooks: camelCase prefix `use` (e.g., `useInput.ts`, `usePhysics.ts`)
- Utilities: camelCase (e.g., `clientId.ts`, `math.ts`)
- Types: snake_case for type files (e.g., `game.ts`, `ability.ts`) containing multiple exported types
- Schemas: PascalCase (e.g., `GameState.ts`, `LobbyState.ts`)

**Directories:**
- Feature domains: kebab-case when multi-word (e.g., `game-logic`, `ws-transport`)
- Functional grouping: lowercase plural (e.g., `components`, `hooks`, `types`, `constants`)

**Exports:**
- Barrel files (`index.ts`) in directories export everything needed by consumers
- Game store slices export separate state interface and action creator
- Shared package exports all types and constants via main `index.ts`

## Where to Add New Code

**New Feature (Hero, Ability):**
- Hero class: `packages/game-logic/src/heroes/NewHero.ts`
- Ability effects: `packages/game-logic/src/abilities/`
- Client rendering: `apps/client/src/components/game/NewHeroEffects.tsx`
- Client hooks: `apps/client/src/hooks/player/abilities/useNewHeroAbilities.ts`
- Server handlers: Extend `apps/server/src/rooms/abilityHandlers.ts`

**New Component/Module:**
- UI component: `apps/client/src/components/ui/NewScreen.tsx`
- Game object: `apps/client/src/components/game/NewGameObject.tsx`
- Add to barrel exports in `components/ui/index.ts` or `components/game/index.ts`

**Utilities:**
- Math helpers: `packages/shared/src/utils/`
- Physics helpers: `packages/physics/src/`
- Client helpers: `apps/client/src/utils/`

**Constants & Types:**
- Game constants: `packages/shared/src/constants/`
- Type definitions: `packages/shared/src/types/`
- Local types: `apps/client/src/types/` (use sparingly, prefer shared)

**New Room/Network Feature:**
- Colyseus schema: `apps/server/src/rooms/schema/NewSchema.ts`
- Room handler: Extend existing room or create new in `apps/server/src/rooms/NewRoom.ts`
- Client handler: `apps/client/src/contexts/gameMessageHandlers.ts` add setup function

## Special Directories

**apps/client/public/:**
- Purpose: Static assets served directly (sounds, map images)
- Generated: No
- Committed: Yes (assets)

**apps/client/dist/:**
- Purpose: Production build output
- Generated: Yes (during `pnpm build`)
- Committed: No

**apps/server/prisma/:**
- Purpose: Database schema and migrations
- Generated: No (manually edited)
- Committed: Yes (schema.prisma)

**packages/*/dist/:**
- Purpose: Compiled TypeScript outputs (.js, .d.ts)
- Generated: Yes (during `pnpm build`)
- Committed: No

**.turbo/:**
- Purpose: Turborepo cache
- Generated: Yes
- Committed: No

**node_modules/:**
- Purpose: Dependencies
- Generated: Yes (during `pnpm install`)
- Committed: No

## Build Outputs

**Client:** `apps/client/dist/` - Vite SPA output (HTML + JS bundles + assets)

**Server:** `apps/server/dist/` - Compiled Node.js code

**Packages:** `packages/*/dist/` - Compiled library outputs (.js + .d.ts)

All build outputs are in `.gitignore` and regenerated from source.
