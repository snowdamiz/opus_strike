#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const unsetKeys = [
  'GAME_TOKEN_MINT',
  'SKIN_SHOP_TOKEN_MINT',
  'SOLANA_RPC_URL',
  'RANKED_TOKEN_HOLD_RPC_URL',
  'WAGER_TREASURY_WALLET',
  'WAGER_SETTLEMENT_SECRET_KEY',
  'WAGER_SETTLEMENT_SIGNER_SECRET',
];

const safeEnv = { ...process.env };
for (const key of unsetKeys) delete safeEnv[key];
Object.assign(safeEnv, {
  SOLANA_CLUSTER: 'localnet',
  SKIN_SHOP_ENABLED: 'false',
  WAGER_SOL_ENABLED: 'false',
  PLAYER_REWARDS_ENABLED: 'false',
});

const launchEnvKeys = [
  'SOLANA_CLUSTER',
  'GAME_TOKEN_MINT',
  'GAME_TOKEN_SYMBOL',
  'SKIN_SHOP_TOKEN_MINT',
  'SKIN_SHOP_TOKEN_SYMBOL',
  'SOLANA_RPC_URL',
  'RANKED_TOKEN_HOLD_RPC_URL',
  'WAGER_TREASURY_WALLET',
  'WAGER_SETTLEMENT_SECRET_KEY',
  'WAGER_SETTLEMENT_SIGNER_SECRET',
  'SKIN_SHOP_ENABLED',
  'WAGER_SOL_ENABLED',
  'PLAYER_REWARDS_ENABLED',
];

const commands = [
  ['pnpm', ['typecheck']],
  ['pnpm', ['build']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:skin-token-payments']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:skin-purchase-lifecycle']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:skin-shop']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:skin-founder']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:ranked-token-hold']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:player-rewards']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:daily-missions']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:wager']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:match-finalization']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:persistence']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:matchmaking']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:matchmaking-settings']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:ranking']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:auth']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:authority']],
  ['pnpm', ['--filter', '@voxel-strike/server', 'test:anticheat']],
  ['pnpm', ['--filter', '@voxel-strike/shared', 'test:model-system']],
  ['pnpm', ['--filter', '@voxel-strike/shared', 'test:model-sockets']],
  ['pnpm', ['--filter', '@voxel-strike/shared', 'test:damage']],
  ['pnpm', ['--filter', '@voxel-strike/physics', 'test:movement']],
  ['pnpm', ['--filter', '@voxel-strike/client', 'test:model-system']],
  ['pnpm', ['--filter', '@voxel-strike/client', 'test:movement']],
  ['pnpm', ['--filter', '@voxel-strike/client', 'test:visual-store']],
];

function assertNoMainnetEnvironment(env) {
  const checkedKeys = [
    'SOLANA_CLUSTER',
    'SOLANA_RPC_URL',
    'RANKED_TOKEN_HOLD_RPC_URL',
  ];
  for (const key of checkedKeys) {
    const value = env[key] ?? '';
    if (/mainnet-beta|mainnet/i.test(value)) {
      throw new Error(`Refusing to run prelaunch no-spend checks with ${key}=${value}`);
    }
  }
}

function envSnapshot(env) {
  return Object.fromEntries(launchEnvKeys.map((key) => {
    const value = env[key];
    if (value === undefined || value === '') return [key, '<unset>'];
    if (/SECRET|PRIVATE|KEYPAIR/i.test(key)) return [key, '<redacted>'];
    return [key, value];
  }));
}

function commandLabel(command, args) {
  return [command, ...args].join(' ');
}

function logFileName(index, command, args) {
  const slug = commandLabel(command, args)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return `${String(index + 1).padStart(2, '0')}-${slug}.log`;
}

assertNoMainnetEnvironment(safeEnv);

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repoRoot, 'prelaunch-evidence', timestamp);
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(
  path.join(evidenceDir, 'env-snapshot.json'),
  `${JSON.stringify(envSnapshot(safeEnv), null, 2)}\n`
);

const failures = [];

for (const [index, [command, args]] of commands.entries()) {
  const label = commandLabel(command, args);
  console.log(`\n[prelaunch ${index + 1}/${commands.length}] ${label}`);

  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: safeEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  process.stdout.write(stdout);
  process.stderr.write(stderr);

  const exitCode = result.status ?? 1;
  const log = [
    `$ ${label}`,
    `cwd: ${repoRoot}`,
    `exitCode: ${exitCode}`,
    '',
    '--- stdout ---',
    stdout,
    '--- stderr ---',
    stderr,
  ].join('\n');
  writeFileSync(path.join(evidenceDir, logFileName(index, command, args)), log);

  if (exitCode !== 0) {
    failures.push({ label, exitCode });
    break;
  }
}

writeFileSync(
  path.join(evidenceDir, 'summary.json'),
  `${JSON.stringify({
    ok: failures.length === 0,
    failures,
    commandCount: commands.length,
    evidenceDir,
  }, null, 2)}\n`
);

if (failures.length > 0) {
  console.error(`\nPrelaunch no-spend checks failed. Evidence: ${evidenceDir}`);
  process.exit(1);
}

console.log(`\nPrelaunch no-spend checks passed. Evidence: ${evidenceDir}`);
