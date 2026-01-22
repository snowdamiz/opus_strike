# Coding Conventions

**Analysis Date:** 2024-01-22

## Naming Patterns

**Files:**
- PascalCase for components and entry points (e.g., `App.tsx`, `GameCanvas.tsx`)
- camelCase for hooks and utilities (e.g., `useGameStore.ts`, `clientId.ts`)
- kebab-case for directory names (e.g., `hero-svgs/`, `player-abilities/`)
- Index files use `index.ts`/`index.tsx` for re-exports

**Functions:**
- camelCase for all functions (e.g., `updateGameState`, `setAppPhase`)
- Hook functions prefixed with `use` (e.g., `useGameStore`, `useMusic`)
- Action creators use verb-first naming (e.g., `setWalletAddress`, `updatePlayer`)

**Variables:**
- camelCase for local variables and props (e.g., `playerId`, `isLoading`)
- Constants use UPPER_SNAKE_CASE (e.g., `MAX_PLAYERS`, `TICK_RATE`)
- Interface names use PascalCase with descriptive suffixes (e.g., `Player`, `GameStateSync`)

**Types:**
- Interface names use PascalCase (e.g., `Vec3`, `Quaternion`)
- Type aliases use PascalCase (e.g., `GamePhase`, `AppPhase`)
- Generic type parameters use single uppercase letters (e.g., `T`, `K`)

## Code Style

**Formatting:**
- No specific linter configuration detected
- Code appears to use standard TypeScript formatting
- Indentation uses tabs (detected in various files)

**Linting:**
- No ESLint configuration found
- No Prettier configuration found
- TypeScript compiler used for type checking only

## Import Organization

**Order:**
1. React imports (e.g., `import { useEffect, useState } from 'react'`)
2. Third-party library imports (e.g., `import { create } from 'zustand'`)
3. Workspace package imports (e.g., `import type { GameStateSync } from '@voxel-strike/shared'`)
4. Local file imports (e.g., `import { useGameStore } from './store/gameStore'`)

**Path Aliases:**
- `@` alias resolves to `src` directory (configured in `vite.config.ts`)
- Relative imports use consistent `./` prefix for same-level files
- Barrel exports used in shared packages for clean imports

## Error Handling

**Patterns:**
- Try/catch blocks used sparingly, mostly in server-side code
- Error messages use descriptive strings (e.g., 'Failed to list lobbies')
- No centralized error handling pattern detected
- Errors logged to console with `console.error()`

## Logging

**Framework:** `console.log`, `console.error`

**Patterns:**
- Development logging present (e.g., console.log in server startup)
- No logging library detected
- Error logging uses `console.error`
- No structured logging pattern

## Comments

**When to Comment:**
- Complex game logic sections (e.g., state synchronization)
- Server startup and configuration
- Critical game mechanics (e.g., ability systems)
- Architecture explanations

**JSDoc/TSDoc:**
- Minimal usage - mostly function comments
- Type definitions are self-documented
- No extensive API documentation

## Function Design

**Size:**
- Functions range from small (5-10 lines) to medium (30-50 lines)
- Large functions broken into smaller, focused functions
- No extreme function lengths detected

**Parameters:**
- Typically 1-3 parameters
- Optional parameters clearly marked
- Object destructuring used for multiple parameters

**Return Values:**
- Explicit return types in function signatures
- Consistent return patterns (e.g., always return boolean for checks)
- Void return for state setters

## Module Design

**Exports:**
- Barrel exports used extensively in packages
- Type exports prefixed with `export type`
- Re-exports for shared types across packages

**Barrel Files:**
- Consistent use of `index.ts` for package exports
- Clean re-export structure (e.g., `packages/shared/src/index.ts`)
- No circular dependencies detected

---

*Convention analysis: 2024-01-22*