import { join } from 'node:path';
import { buildMovementParityGateReport, type MovementParityGateOptions } from '../anticheat/trace';

interface CliOptions {
  corpus: MovementParityGateOptions['corpus'];
  outputPath?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { corpus: 'smoke', json: false };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('--corpus=')) {
      const corpus = arg.slice('--corpus='.length);
      if (corpus !== 'smoke' && corpus !== 'full' && corpus !== 'all') {
        throw new Error(`unsupported corpus ${corpus}`);
      }
      options.corpus = corpus;
    } else if (arg.startsWith('--out=')) {
      options.outputPath = arg.slice('--out='.length);
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));
const traceRoot = join(__dirname, 'fixtures', 'anti-cheat-traces');
const report = buildMovementParityGateReport({
  corpus: options.corpus,
  traceRoot,
  outputPath: options.outputPath,
});

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log([
    `anti-cheat movement parity ${report.passed ? 'passed' : 'failed'}`,
    `corpus=${report.corpus}`,
    `traces=${report.traceCount}`,
    `legal=${report.legalTraceCount}`,
    `malicious=${report.maliciousTraceCount}`,
    `maxPositionDrift=${report.maxPositionDrift.toFixed(4)}m`,
    `maxVelocityDrift=${report.maxVelocityDrift.toFixed(4)}m/s`,
    `movementStateMismatches=${report.movementStateMismatches}`,
    `unexpectedCorrections=${report.unexpectedCorrections}`,
  ].join(' '));

  if (report.failures.length > 0) {
    for (const failure of report.failures) {
      console.error(`- ${failure}`);
    }
  }
}

if (!report.passed) {
  process.exitCode = 1;
}
