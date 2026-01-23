# Codebase Structure

**Analysis Date:** 2026-01-22

## Directory Layout

```
opus_strike/
├── .planning/              # GSD planning documents and codebase analysis
│   ├── codebase/           # Architecture, conventions, testing docs
│   ├── phases/             # Implementation phase plans
│   └── research/           # Technical research documents
├── apps/                   # Application workspaces
│   ├── client/             # Vite + React Three Fiber game client
│   └── server/             # Node.js + Colyseus game server
├── packages/               # Shared libraries (Turborepo workspaces)
│   ├── game-logic/         # Hero definitions, abilities, game modes
│   ├── physics/            # Movement physics and collision detection
│   └── shared/             # Shared types, constants, utilities
├── package.json            # Root package.json (Turborepo workspace)
├── pnpm-workspace.yaml     # PNPM workspace configuration
├── turbo.json              # Turborepo build pipeline configuration
├── tsconfig.base.json      # Base TypeScript configuration
├── docker-compose.yml      # Docker services (PostgreSQL)
└── PLAN.md                 # Project overview and roadmap
```

## Directory Purposes

**`.planning/`:**
- Purpose: GSD command documentation and planning artifacts
- Contains: Architecture docs, phase plans, research notes
- Key files: `codebase/ARCHITECTURE.md`, `codebase/STRUCTURE.md`, `phases/*/plan.md`

**`apps/client/`:**
- Purpose: Browser-based 3D multiplayer game client
- Contains: React components, Three.js rendering, UI, client-side game logic, Zustand stores, custom hooks
- Key files: `src/main.tsx`, `src/App.tsx`, `src/components/game/GameCanvas.tsx`, `src/store/gameStore.ts`

**`apps/client/src/components/`:**
- Purpose: React components for UI and 3D game objects
- Contains: `ui/` (2D overlays), `game/` (3D rendered components), hero-specific effect managers
- Key subdirs: `components/ui/` (HUD, menus), `components/game/` (3D world, player, effects)

**`apps/client/src/hooks/`:**
- Purpose: Reusable React hooks for game logic
- Contains: Input handling, physics, audio, player movement, camera control, abilities
- Key subdirs: `hooks/player/` (movement, camera, physics), `hooks/player/abilities/` (hero-specific)

**`apps/client/src/store/`:**
- Purpose: Zustand state management
- Contains: `gameStore.ts` (main game state), `visualStore.ts` (rendering state), `slices/` (feature modules)
- Key files: `store/gameStore.ts`, `store/visualStore.ts`, `store/slices/projectiles.ts`

**`apps/client/src/contexts/`:**
- Purpose: React context providers for global concerns
- Contains: `NetworkContext.tsx` (Colyseus connection), `WalletContext.tsx` (Solana wallet)
- Key files: `contexts/NetworkContext.tsx`, `contexts/gameMessageHandlers.ts`

**`apps/server/`:**
- Purpose: Authoritative game server
- Contains: Colyseus rooms, Express API, Prisma database client, authentication
- Key files: `src/index.ts`, `src/rooms/GameRoom.ts`, `src/rooms/LobbyRoom.ts`

**`apps/server/src/rooms/`:**
- Purpose: Colyseus room implementations
- Contains: `GameRoom.ts` (active game session), `LobbyRoom.ts` (pre-game matchmaking), `schema/` (networked state)
- Key files: `rooms/GameRoom.ts`, `rooms/abilityHandlers.ts`, `rooms/schema/GameState.ts`

**`apps/server/src/auth/`:**
- Purpose: Solana wallet authentication
- Contains: `verify.ts` (signature verification), `routes.ts` (Express endpoints)
- Key files: `auth/verify.ts`, `auth/routes.ts`

**`apps/server/prisma/`:**
- Purpose: Database schema and migrations
- Contains: Prisma schema definition, migration files
- Key files: `prisma/schema.prisma`

**`packages/shared/`:**
- Purpose: Code shared between client and server (types, constants, utils)
- Contains: TypeScript type definitions, game constants, math utilities
- Key subdirs: `src/types/`, `src/constants/`, `src/utils/`

**`packages/game-logic/`:**
- Purpose: Platform-agnostic game rules and hero definitions
- Contains: Hero classes, ability systems, CTF game mode, match management
- Key subdirs: `src/heroes/`, `src/abilities/`, `src/ctf/`, `src/match/`

**`packages/physics/`:**
- Purpose: Character controller physics using Rapier3D
- Contains: Physics world wrapper, movement systems, collision detection
- Key subdirs: `src/movement/` (movement modules)
- Key files: `src/PhysicsWorld.ts`, `src/MovementController.ts`

## Key File Locations

**Entry Points:**
- `apps/client/index.html`: HTML entry point for client
- `apps/client/src/main.tsx`: React root render
- `apps/client/src/App.tsx`: Top-level app component with phase routing
- `apps/server/src/index.ts`: Server startup and Colyseus initialization

**Configuration:**
- `turbo.json`: Turborepo build pipeline (dev, build, lint, typecheck tasks)
- `tsconfig.base.json`: Base TypeScript config extended by all packages
- `apps/client/vite.config.ts`: Vite bundler configuration
- `apps/client/tailwind.config.js`: TailwindCSS styling configuration
- `apps/server/prisma/schema.prisma`: Database schema

**Core Logic:**
- `apps/client/src/components/game/PlayerController.tsx`: Main player controller (orchestrates movement, camera, abilities)
- `apps/client/src/store/gameStore.ts`: Central game state (Zustand, 508 lines)
- `apps/server/src/rooms/GameRoom.ts`: Server-side game room with tick loop
- `packages/game-logic/src/heroes/HeroBase.ts`: Base class for all heroes

**Testing:**
- Not detected (no test files found in standard locations)

## Naming Conventions

**Files:**
- React components: PascalCase with `.tsx` extension (`PlayerController.tsx`, `GameCanvas.tsx`)
- TypeScript modules: camelCase with `.ts` extension (`useInput.ts`, `gameStore.ts`)
- Type definitions: lowercase with `.d.ts` or within `.ts` files (`types/hero.ts`)
- Directories: lowercase or kebab-case (`game-logic`, `components`, `hooks`)

**Functions:**
- React components: PascalCase (`PlayerController`, `GameCanvas`)
- Hooks: camelCase starting with `use` (`useMovement`, `useCamera`, `useInput`)
- Regular functions: camelCase (`syncPlayerFromSchema`, `setupPollingSync`)
- Handlers: camelCase with `handle` prefix (`handleInput`, `handleHeroSelect`)

**Variables:**
- Local variables: camelCase (`playerBody`, `inputState`, `isPointerLocked`)
- Constants: UPPER_SNAKE_CASE (`TICK_RATE`, `PLAYER_HEIGHT`, `GRAVITY`)
- React refs: camelCase with `Ref` suffix (`clientRef`, `lobbyRoomRef`, `playerBodyRef`)

**Types:**
- Interfaces: PascalCase (`GameState`, `Player`, `AbilityContext`, `NetworkContextType`)
- Type aliases: PascalCase (`HeroId`, `Team`, `Vec3`)
- Enums: PascalCase with UPPER_SNAKE_CASE values (not widely used, prefer union types)

## Where to Add New Code

**New Hero:**
- Hero class: `packages/game-logic/src/heroes/NewHero.ts`
- Hero constants: `packages/shared/src/constants/heroes.ts`
- Client ability hooks: `apps/client/src/hooks/player/abilities/useNewHeroAbilities.ts`
- Visual effects: `apps/client/src/components/game/NewHeroEffects.tsx`
- Export from: `packages/game-logic/src/index.ts`

**New Ability:**
- Ability definition: Add to `ABILITY_DEFINITIONS` in `packages/shared/src/constants/heroes.ts`
- Server handler: Add case to `apps/server/src/rooms/abilityHandlers.ts` → `executeAbility`
- Client handler: Add to appropriate hero ability hook in `apps/client/src/hooks/player/abilities/`
- Visual effects: Update corresponding `*Effects.tsx` manager in `apps/client/src/components/game/`

**New UI Component:**
- 2D overlay: `apps/client/src/components/ui/NewComponent.tsx`
- 3D game element: `apps/client/src/components/game/NewGameObject.tsx`
- Import in: `apps/client/src/App.tsx` or `apps/client/src/components/game/GameCanvas.tsx`

**New Game Mode:**
- Game mode logic: `packages/game-logic/src/modes/NewMode.ts`
- Server integration: Instantiate in `apps/server/src/rooms/GameRoom.ts`
- Export from: `packages/game-logic/src/index.ts`

**New Shared Type:**
- Type definition: `packages/shared/src/types/newtype.ts`
- Export from: `packages/shared/src/index.ts`

**New Hook:**
- Player-related: `apps/client/src/hooks/player/useNewHook.ts`
- General purpose: `apps/client/src/hooks/useNewHook.ts`
- Export from: `apps/client/src/hooks/player/index.ts` (if in player subdirectory)

**New Store Slice:**
- Slice definition: `apps/client/src/store/slices/newFeature.ts`
- Import and compose: `apps/client/src/store/gameStore.ts`

**Utilities:**
- Shared helpers: `packages/shared/src/utils/newUtil.ts`
- Client-only helpers: `apps/client/src/utils/newUtil.ts`
- Server-only helpers: `apps/server/src/utils/newUtil.ts`

## Special Directories

**`apps/client/public/`:**
- Purpose: Static assets served by Vite
- Generated: No
- Committed: Yes
- Contains: `maps/` (map data), `sounds/` (audio files), images

**`apps/client/dist/`:**
- Purpose: Vite build output (production bundle)
- Generated: Yes (via `npm run build`)
- Committed: No (in .gitignore)

**`apps/server/dist/`:**
- Purpose: TypeScript compilation output
- Generated: Yes (via `npm run build`)
- Committed: No (in .gitignore)

**`packages/*/dist/`:**
- Purpose: Compiled TypeScript for each package
- Generated: Yes (via Turborepo `turbo run build`)
- Committed: No (in .gitignore)

**`node_modules/`:**
- Purpose: PNPM dependency installation (hoisted to root and per-workspace)
- Generated: Yes (via `pnpm install`)
- Committed: No (in .gitignore)

**`.turbo/`:**
- Purpose: Turborepo build cache for faster rebuilds
- Generated: Yes (automatically during builds)
- Committed: No (in .gitignore)

**`apps/server/prisma/migrations/`:**
- Purpose: Database migration history (when generated)
- Generated: Yes (via `prisma migrate dev`)
- Committed: Yes (tracks schema changes)

**`apps/client/src/components/game/effects/instanced/`:**
- Purpose: Optimized instanced rendering components (recent addition for performance)
- Generated: No
- Committed: Yes
- Contains: `InstancedRockets.tsx` (instanced rocket rendering)

---

*Structure analysis: 2026-01-22*
