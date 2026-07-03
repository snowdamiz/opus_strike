import { spawnSync } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;
const STATUS_LOG_INTERVAL_MS = 10_000;

const args = new Set(process.argv.slice(2));
const noStart = args.has('--no-start') || process.env.DOCKER_AUTO_START === '0';
const timeoutMs = readPositiveInteger(
  process.env.DOCKER_START_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
);

function readPositiveInteger(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function dockerInfo() {
  const result = spawnSync('docker', ['info'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error?.code === 'ENOENT') {
    return {
      ok: false,
      missingCli: true,
      detail: result.error.message,
    };
  }

  return {
    ok: result.status === 0,
    missingCli: false,
    detail: (result.stderr || result.stdout || result.error?.message || '').trim(),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  return `${Math.ceil(ms / 1000)}s`;
}

function printDockerUnavailable(status, heading) {
  console.error('');
  console.error(heading);
  console.error(
    'Local dev needs Docker because it starts Postgres, Redis, and the five-server game cluster.',
  );

  if (status.detail) {
    console.error('');
    console.error('Last docker info output:');
    console.error(status.detail);
  }

  console.error('');
  console.error('Start Docker Desktop, then run `pnpm dev:all` again.');
}

async function waitForDocker() {
  const deadline = Date.now() + timeoutMs;
  let nextStatusLogAt = Date.now() + STATUS_LOG_INTERVAL_MS;
  let lastStatus = dockerInfo();

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    lastStatus = dockerInfo();
    if (lastStatus.ok) {
      console.log('Docker daemon is ready.');
      return true;
    }

    if (Date.now() >= nextStatusLogAt) {
      console.log(
        `Still waiting for Docker daemon (${formatDuration(deadline - Date.now())} left)...`,
      );
      nextStatusLogAt = Date.now() + STATUS_LOG_INTERVAL_MS;
    }
  }

  printDockerUnavailable(
    lastStatus,
    `Docker Desktop did not become ready within ${formatDuration(timeoutMs)}.`,
  );
  return false;
}

async function main() {
  const initialStatus = dockerInfo();

  if (initialStatus.ok) {
    console.log('Docker daemon is ready.');
    return;
  }

  if (initialStatus.missingCli) {
    printDockerUnavailable(initialStatus, 'Docker CLI was not found.');
    process.exitCode = 1;
    return;
  }

  if (noStart || process.platform !== 'darwin') {
    printDockerUnavailable(initialStatus, 'Docker daemon is not reachable.');
    process.exitCode = 1;
    return;
  }

  console.log(
    `Docker daemon is not reachable. Opening Docker Desktop and waiting up to ${formatDuration(timeoutMs)}...`,
  );

  const openResult = spawnSync('open', ['-g', '-a', 'Docker'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
  });

  if (openResult.error?.code === 'ENOENT' || openResult.status !== 0) {
    printDockerUnavailable(
      {
        ...initialStatus,
        detail: (
          openResult.stderr ||
          openResult.error?.message ||
          initialStatus.detail ||
          ''
        ).trim(),
      },
      'Docker Desktop could not be opened automatically.',
    );
    process.exitCode = 1;
    return;
  }

  if (!(await waitForDocker())) {
    process.exitCode = 1;
  }
}

await main();
