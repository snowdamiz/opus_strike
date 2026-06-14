import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

const composeProjects = [
  {
    label: 'root compose services',
    cwd: rootDir,
    file: 'docker-compose.yml',
  },
  {
    label: 'server compose services',
    cwd: resolve(rootDir, 'apps/server'),
    file: 'docker-compose.yml',
  },
];

const processPatterns = [
  {
    label: 'dev orchestration',
    pattern: 'pnpm([^[:space:]]*)?[[:space:]]+(run[[:space:]]+)?dev(:all|:client|:server|:server:distributed:[ab])?([[:space:]]|$)',
  },
  {
    label: 'turbo dev tasks',
    pattern: 'turbo([^[:space:]]*)?[[:space:]]+run[[:space:]]+dev',
  },
  {
    label: 'server watcher',
    pattern: 'tsx([^[:space:]]*)?[[:space:]]+watch[[:space:]]+src/index\\.ts',
  },
  {
    label: 'dev log followers',
    pattern: 'docker[[:space:]]+compose[[:space:]]+logs[[:space:]]+-f[[:space:]]+(postgres|redis)',
  },
  {
    label: 'dev:all runner',
    pattern: 'concurrently([^[:space:]]*)?[[:space:]]+-n[[:space:]]+db,redis,server,client',
  },
  {
    label: 'video studio',
    pattern: 'remotion([^[:space:]]*)?[[:space:]]+studio',
  },
];

const devPorts = [3000, 2567, 2568, 3030, 3031];
const servicePorts = [5432, 55433, 6379, 7880, 7881];
const watchedPorts = [...new Set([...devPorts, ...servicePorts])];

const knownContainers = [
  'voxel-strike-db',
  'voxel-strike-redis',
  'voxel-strike-livekit',
  'opus_strike_db',
  'opus_strike_redis',
  'opus_strike_livekit',
];

function run(label, command, args, options = {}) {
  const rendered = [command, ...args].join(' ');
  console.log(`> ${label}: ${rendered}`);

  if (dryRun) {
    return { status: 0, stdout: '', stderr: '' };
  }

  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    encoding: 'utf8',
    stdio: options.stdio ?? 'inherit',
  });

  if (result.error?.code === 'ENOENT') {
    console.warn(`  skipped: ${command} is not available`);
    return result;
  }

  if (result.status && !options.ignoreExitCode) {
    console.warn(`  exited with code ${result.status}`);
  }

  return result;
}

function capture(command, args) {
  if (dryRun) {
    console.log(`> inspect: ${[command, ...args].join(' ')}`);
    return '';
  }

  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error?.code === 'ENOENT' || result.status) {
    return '';
  }

  return result.stdout;
}

function stopMatchingProcesses() {
  for (const { label, pattern } of processPatterns) {
    run(`stop ${label}`, 'pkill', ['-TERM', '-f', pattern], { ignoreExitCode: true });
  }
}

function listeningPids(port) {
  const output = capture('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']);
  return output.trim().split(/\s+/).filter(Boolean);
}

function stopDevPorts(signal) {
  for (const port of devPorts) {
    const pids = [...new Set(listeningPids(port))];

    if (!pids.length) {
      console.log(`> port ${port}: no listener`);
      continue;
    }

    run(`stop port ${port}`, 'kill', [`-${signal}`, ...pids], { ignoreExitCode: true });
  }
}

function removeKnownContainers() {
  run('remove known project containers', 'docker', ['rm', '-f', ...knownContainers], { ignoreExitCode: true });
}

function stopComposeServices() {
  for (const { label, cwd, file } of composeProjects) {
    if (!existsSync(resolve(cwd, file))) {
      continue;
    }

    run(`stop ${label}`, 'docker', [
      'compose',
      '-f',
      file,
      'down',
      '--remove-orphans',
    ], { cwd, ignoreExitCode: true });
  }
}

function dockerContainersForPort(port) {
  const output = capture('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}']);

  return output
    .trim()
    .split('\n')
    .filter((line) => line.includes(`:${port}->`))
    .map((line) => line.split('\t')[0])
    .filter(Boolean);
}

function portListeners(port) {
  return capture('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
    .trim()
    .split('\n')
    .slice(1)
    .filter(Boolean);
}

function reportRemainingPortListeners() {
  const conflicts = watchedPorts
    .map((port) => ({
      port,
      containers: dockerContainersForPort(port),
      listeners: portListeners(port),
    }))
    .filter(({ containers, listeners }) => containers.length || listeners.length);

  if (!conflicts.length) {
    console.log('No watched project ports are still listening.');
    return;
  }

  console.warn('Some watched ports are still in use by processes outside this stop command:');

  for (const { port, containers, listeners } of conflicts) {
    const owners = containers.length ? ` Docker: ${containers.join(',')}` : '';
    console.warn(`  port ${port}:${owners}`);

    for (const listener of listeners) {
      console.warn(`    ${listener}`);
    }
  }
}

console.log(dryRun ? 'Dry run: stop-all plan' : 'Stopping local Opus Strike services...');
stopMatchingProcesses();
stopDevPorts('TERM');
stopComposeServices();
removeKnownContainers();

if (!dryRun) {
  setTimeout(() => {
    stopDevPorts('KILL');
    reportRemainingPortListeners();
    console.log('Done.');
  }, 1000);
}
