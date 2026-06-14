import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_SERVER_URL = 'https://opus-strike-server.fly.dev';
const DEFAULT_SERVER_APP = 'opus-strike-server';
const DEFAULT_AUTOSCALER_APP = 'opus-strike-server-autoscaler';
const DEFAULT_PROMETHEUS_ADDRESS = 'https://api.fly.io/prometheus/personal';

const REQUIRED_METRICS = [
  'opus_strike_colyseus_local_ccu',
  'opus_strike_colyseus_local_room_count',
  'opus_strike_lobby_participants',
  'opus_strike_visible_lobby_count',
  'opus_strike_fly_replay_registered',
  'opus_strike_redis_up',
  'opus_strike_process_cpu_utilization',
  'opus_strike_process_event_loop_delay_p95_ms',
  'opus_strike_dynamic_capacity_pressure',
  'opus_strike_dynamic_capacity_players_per_machine',
];

const SAFE_INFRA_LABELS = [
  'colyseus_process_id',
  'fly_machine_id',
  'fly_region',
];

interface ParsedArgs {
  serverUrl: string;
  serverApp: string;
  autoscalerApp: string;
  prometheusAddress: string;
  prometheusToken: string | undefined;
  skipPrometheus: boolean;
  skipFlyStatus: boolean;
  skipAutoscalerStatus: boolean;
}

interface MetricSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

interface FlyMachineSummary {
  id: string;
  state: string;
  region: string;
}

function readOption(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);

  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseArgs(args: string[]): ParsedArgs {
  return {
    serverUrl: readOption(args, '--server-url') ?? process.env.AUTOSCALER_SERVER_URL ?? DEFAULT_SERVER_URL,
    serverApp: readOption(args, '--server-app') ?? process.env.AUTOSCALER_SERVER_APP ?? DEFAULT_SERVER_APP,
    autoscalerApp: readOption(args, '--autoscaler-app')
      ?? process.env.AUTOSCALER_APP
      ?? DEFAULT_AUTOSCALER_APP,
    prometheusAddress: readOption(args, '--prometheus-address')
      ?? process.env.FAS_PROMETHEUS_ADDRESS
      ?? DEFAULT_PROMETHEUS_ADDRESS,
    prometheusToken: readOption(args, '--prometheus-token')
      ?? process.env.FAS_PROMETHEUS_TOKEN
      ?? process.env.FLY_ACCESS_TOKEN,
    skipPrometheus: args.includes('--skip-prometheus'),
    skipFlyStatus: args.includes('--skip-fly-status'),
    skipAutoscalerStatus: args.includes('--skip-autoscaler-status'),
  };
}

function normalizeServerUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function parseLabels(raw: string | undefined): Record<string, string> {
  if (!raw) return {};

  const labels: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][a-zA-Z0-9_:]*)="((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    const [, key, escapedValue] = match;
    labels[key] = escapedValue
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  return labels;
}

export function parsePrometheusMetrics(text: string): MetricSample[] {
  const samples: MetricSample[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)$/i.exec(trimmed);
    if (!match) {
      throw new Error(`Invalid Prometheus sample line: ${trimmed}`);
    }

    samples.push({
      name: match[1],
      labels: parseLabels(match[2]),
      value: Number(match[3]),
    });
  }

  return samples;
}

export function verifyServerMetrics(text: string): {
  samples: MetricSample[];
  missingMetrics: string[];
  unsafeLabelNames: string[];
} {
  const samples = parsePrometheusMetrics(text);
  const metricNames = new Set(samples.map((sample) => sample.name));
  const missingMetrics = REQUIRED_METRICS.filter((metric) => !metricNames.has(metric));
  const unsafeLabelNames = Array.from(new Set(
    samples.flatMap((sample) => Object.keys(sample.labels))
      .filter((label) => !SAFE_INFRA_LABELS.includes(label))
  ));

  if (missingMetrics.length > 0) {
    throw new Error(`Missing required metrics: ${missingMetrics.join(', ')}`);
  }

  if (unsafeLabelNames.length > 0) {
    throw new Error(`Unexpected metric labels: ${unsafeLabelNames.join(', ')}`);
  }

  return { samples, missingMetrics, unsafeLabelNames };
}

function readTokenHeader(token: string): string {
  return token.startsWith('Fly') ? token : `Bearer ${token}`;
}

async function fetchText(url: string, options: RequestInit = {}): Promise<string> {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }

  return response.text();
}

async function queryPrometheus(options: {
  address: string;
  token: string;
  query: string;
}): Promise<number> {
  const url = new URL(`${options.address.replace(/\/+$/, '')}/api/v1/query`);
  url.searchParams.set('query', options.query);

  const body = await fetchText(url.toString(), {
    headers: {
      authorization: readTokenHeader(options.token),
    },
  });
  const parsed = JSON.parse(body) as {
    status?: string;
    data?: {
      result?: Array<{ value?: [number, string] }>;
    };
  };

  if (parsed.status !== 'success') {
    throw new Error(`Prometheus query failed: ${body}`);
  }

  const value = parsed.data?.result?.[0]?.value?.[1];
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Prometheus query did not return a numeric scalar: ${body}`);
  }

  return numberValue;
}

async function readFlyMachines(app: string): Promise<FlyMachineSummary[]> {
  const { stdout } = await execFileAsync('fly', ['status', '-a', app, '--json'], {
    maxBuffer: 1024 * 1024 * 4,
  });
  const parsed = JSON.parse(stdout) as {
    Machines?: Array<{ id: string; state: string; region: string }>;
  };

  return (parsed.Machines ?? []).map((machine) => ({
    id: machine.id,
    state: machine.state,
    region: machine.region,
  }));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const metricsUrl = `${normalizeServerUrl(args.serverUrl)}/metrics`;
  const metricsText = await fetchText(metricsUrl);
  const metrics = verifyServerMetrics(metricsText);

  const summary: Record<string, unknown> = {
    metrics: {
      url: metricsUrl,
      sampleCount: metrics.samples.length,
      requiredMetrics: REQUIRED_METRICS,
      labels: SAFE_INFRA_LABELS,
    },
  };

  if (!args.skipFlyStatus) {
    const serverMachines = await readFlyMachines(args.serverApp);
    const runningServerMachines = serverMachines.filter((machine) => machine.state === 'started');
    summary.serverApp = {
      app: args.serverApp,
      createdMachines: serverMachines.length,
      runningMachines: runningServerMachines.length,
      machines: serverMachines,
    };

    if (!args.skipAutoscalerStatus) {
      const autoscalerMachines = await readFlyMachines(args.autoscalerApp);
      summary.autoscalerApp = {
        app: args.autoscalerApp,
        machines: autoscalerMachines,
        singleMachine: autoscalerMachines.length === 1,
      };
    }
  }

  if (!args.skipPrometheus) {
    if (!args.prometheusToken) {
      throw new Error('Set FAS_PROMETHEUS_TOKEN or FLY_ACCESS_TOKEN, or pass --skip-prometheus');
    }

    const demandPlayers = await queryPrometheus({
      address: args.prometheusAddress,
      token: args.prometheusToken,
      query: `(sum(opus_strike_colyseus_local_ccu{app='${args.serverApp}'}) or vector(0)) + (sum(opus_strike_lobby_participants{app='${args.serverApp}'}) or vector(0))`,
    });
    const runningMachines = await queryPrometheus({
      address: args.prometheusAddress,
      token: args.prometheusToken,
      query: `count(fly_instance_up{app='${args.serverApp}'}) or vector(0)`,
    });

    summary.prometheus = {
      address: args.prometheusAddress,
      demandPlayers,
      runningMachines,
    };
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
