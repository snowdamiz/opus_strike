# Codebase Structure

**Analysis Date:** 2024-01-22

## Directory Layout

```
voxel-strike/
├── apps/                              # Client and server applications
│   ├── client/                       # React client app
│   │   ├── public/                  # Static assets
│   │   │   ├── maps/                # Level maps and assets
│   │   │   └── sounds/              # Audio files
│   │   └── src/                     # Client source code
│   │       ├── components/          # React components
│   │       ├── contexts/           # React contexts (Wallet, Network)
│   │       ├── hooks/               # Custom hooks
│   │       ├── store/               # Zustand state management
│   │       ├── types/               # Client-specific types
│   │       ├── utils/               # Client utilities
│   │       └── styles/             # CSS/Tailwind styles
│   └── server/                       # Node.js server app
│       ├── src/                     # Server source code
│       │   ├── auth/               # Authentication routes
│       │   ├── db/                  # Database client
│       │   └── rooms/              # Colyseus rooms
│       │       ├── schema/        # Network state schemas
│       │       ├── GameRoom.ts    # Game logic room
│       │       └── LobbyRoom.ts   # Lobby/room listing
│       └── prisma/                  # Database schema
├── packages/                         # Shared packages
│   ├── game-logic/                  # Core game mechanics
│   │   ├── src/
│   │   │   ├── heroes/             # Character implementations
│   │   │   ├── abilities/          # Ability system
│   │   │   ├── ctf/                # Capture the flag game mode
│   │   │   └── match/              # Match management
│   ├── physics/                     # Physics simulation
│   │   ├── src/
│   │   │   ├── movement/          # Movement controllers
│   │   │   └── PhysicsWorld.ts     # Physics engine wrapper
│   └── shared/                      # Shared types and constants
│       ├── src/
│       │   ├── types/             # TypeScript type definitions
│       │   ├── constants/         # Game constants
│       │   └── utils/              # Shared utilities
├── .planning/                       # Planning documents
└── docker-compose.yml               # PostgreSQL service
```

## Directory Purposes

**apps/client:**
- Purpose: React-based 3D game client
- Contains: UI components, Three.js integration, state management
- Key files: `src/App.tsx`, `src/components/`, `src/store/`

**apps/server:**
- Purpose: Node.js game server with WebSocket support
- Contains: Room management, game logic, REST API
- Key files: `src/index.ts`, `src/rooms/GameRoom.ts`, `src/auth/`

**packages/game-logic:**
- Purpose: Core game mechanics and hero abilities
- Contains: Hero implementations, ability system, game modes
- Key files: `src/heroes/`, `src/abilities/`, `src/ctf/`

**packages/physics:**
- Purpose: 3D physics simulation and movement
- Contains: Rapier3D integration, movement controllers
- Key files: `src/PhysicsWorld.ts`, `src/movement/`

**packages/shared:**
- Purpose: Type definitions and shared constants
- Contains: TypeScript types, game constants, math utilities
- Key files: `src/types/`, `src/constants/`

## Key File Locations

**Entry Points:**
- `apps/client/src/main.tsx`: React app entry point
- `apps/server/src/index.ts`: Node.js server entry point

**Configuration:**
- `package.json`: Root package and workspace config
- `turbo.json`: Turborepo build configuration
- `tsconfig.base.json`: TypeScript base configuration
- `docker-compose.yml`: PostgreSQL database setup

**Core Logic:**
- `packages/game-logic/src/`: Game mechanics and heroes
- `packages/physics/src/`: Physics simulation
- `apps/server/src/rooms/`: Game room implementations

**Testing:**
- No dedicated test directories detected

## Naming Conventions

**Files:**
- PascalCase for components and classes: `GameRoom.ts`, `HeroBase.ts`
- camelCase for functions and utilities: `movementController.ts`, `gameUtils.ts`
- kebab-case for CSS: `index.css`, `game-ui.css`

**Directories:**
- kebab-case for directories: `game-logic`, `physics`, `hero-svgs`
- camelCase for subdirectories: `physics/src/movement`

## Where to Add New Code

**New Hero:**
- Implementation: `packages/game-logic/src/heroes/[HeroName]Hero.ts`
- Type definition: `packages/shared/src/types/hero.ts`
- Ability integration: `packages/game-logic/src/abilities/AbilitySystem.ts`

**New Ability:**
- Logic: `packages/game-logic/src/abilities/AbilityNameAbility.ts`
- Network schema: `apps/server/src/rooms/schema/Components.ts`
- Client effects: `apps/client/src/components/game/[hero]/`

**New Game Mode:**
- Implementation: `packages/game-logic/src/[mode]/`
- Server room: `apps/server/src/rooms/GameRoom.ts`
- UI components: `apps/client/src/components/ui/`

**New Physics Feature:**
- Movement: `packages/physics/src/movement/MovementType.ts`
- Integration: `packages/physics/src/MovementController.ts`
- Client prediction: `apps/client/src/hooks/physics/`

**New UI Component:**
- Implementation: `apps/client/src/components/ui/[ComponentName].tsx`
- Types: `apps/client/src/types/`
- Styles: `apps/client/src/styles/`

## Special Directories

**packages/physics:**
- Purpose: Physics simulation package
- Generated: No
- Committed: Yes

**apps/server/prisma:**
- Purpose: Database schema and migrations
- Generated: Yes (Prisma generates client)
- Committed: Yes

**apps/client/public:**
- Purpose: Static assets (maps, sounds, images)
- Generated: No
- Committed: Yes

---

*Structure analysis: 2024-01-22*
```