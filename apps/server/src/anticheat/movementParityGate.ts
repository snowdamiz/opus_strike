import { existsSync, readFileSync } from 'node:fs';
import type { AntiCheatMovementParityGateReport } from '@voxel-strike/shared';
import type { MovementAuthorityMode, MovementParityGateStatus } from './types';

function defaultStatus(
  required: boolean,
  requestedMode: MovementAuthorityMode,
  reason: string,
  reportPath: string | null = null
): MovementParityGateStatus {
  return {
    required,
    requestedMode,
    effectiveMode: requestedMode === 'strict' && required ? 'shadow' : requestedMode,
    passed: !required,
    reason,
    reportPath,
    generatedAt: null,
    corpus: null,
    traceCount: 0,
    legalTraceCount: 0,
    maliciousTraceCount: 0,
  };
}

function parseReport(path: string): AntiCheatMovementParityGateReport | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AntiCheatMovementParityGateReport;
  } catch {
    return null;
  }
}

export function getMovementParityGateStatus(input: {
  required: boolean;
  requestedMode: MovementAuthorityMode;
  reportPath?: string;
}): MovementParityGateStatus {
  const reportPath = input.reportPath || process.env.ANTICHEAT_MOVEMENT_PARITY_REPORT_PATH || null;
  if (input.requestedMode !== 'strict') {
    return defaultStatus(input.required, input.requestedMode, 'strict movement not requested', reportPath);
  }
  if (!input.required) {
    return {
      ...defaultStatus(false, input.requestedMode, 'parity gate not required by configuration', reportPath),
      effectiveMode: 'strict',
      passed: true,
    };
  }
  if (!reportPath) {
    return defaultStatus(true, input.requestedMode, 'missing ANTICHEAT_MOVEMENT_PARITY_REPORT_PATH');
  }
  if (!existsSync(reportPath)) {
    return defaultStatus(true, input.requestedMode, 'movement parity report was not found', reportPath);
  }

  const report = parseReport(reportPath);
  if (!report) {
    return defaultStatus(true, input.requestedMode, 'movement parity report could not be parsed', reportPath);
  }
  if (!report.passed) {
    return {
      ...defaultStatus(true, input.requestedMode, 'movement parity report failed', reportPath),
      generatedAt: report.generatedAt,
      corpus: report.corpus,
      traceCount: report.traceCount,
      legalTraceCount: report.legalTraceCount,
      maliciousTraceCount: report.maliciousTraceCount,
    };
  }
  if (report.traceCount <= 0 || report.legalTraceCount <= 0 || report.maliciousTraceCount <= 0) {
    return {
      ...defaultStatus(true, input.requestedMode, 'movement parity report is missing legal or malicious coverage', reportPath),
      generatedAt: report.generatedAt,
      corpus: report.corpus,
      traceCount: report.traceCount,
      legalTraceCount: report.legalTraceCount,
      maliciousTraceCount: report.maliciousTraceCount,
    };
  }

  return {
    required: true,
    requestedMode: input.requestedMode,
    effectiveMode: 'strict',
    passed: true,
    reason: 'movement parity report passed',
    reportPath,
    generatedAt: report.generatedAt,
    corpus: report.corpus,
    traceCount: report.traceCount,
    legalTraceCount: report.legalTraceCount,
    maliciousTraceCount: report.maliciousTraceCount,
  };
}
