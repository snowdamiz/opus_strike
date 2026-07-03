#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = 'apps/server/prisma/migrations';
const ZERO_SHA = /^0{40}$/;

const fatalRules = [
  {
    id: 'drop-database',
    pattern: /\bDROP\s+DATABASE\b/i,
    message: 'drops a database',
  },
  {
    id: 'drop-schema',
    pattern: /\bDROP\s+SCHEMA\b/i,
    message: 'drops a schema',
  },
  {
    id: 'drop-table',
    pattern: /\bDROP\s+TABLE\b/i,
    message: 'drops a table',
  },
  {
    id: 'drop-column',
    pattern: /\bDROP\s+COLUMN\b/i,
    message: 'drops a column',
  },
  {
    id: 'truncate',
    pattern: /\bTRUNCATE\b/i,
    message: 'truncates table data',
  },
  {
    id: 'delete-from',
    pattern: /\bDELETE\s+FROM\b/i,
    message: 'deletes table data',
  },
  {
    id: 'drop-type',
    pattern: /\bDROP\s+TYPE\b/i,
    message: 'drops a database type',
  },
  {
    id: 'alter-type-rename',
    pattern: /\bALTER\s+TYPE\b.*\bRENAME\b/i,
    message: 'rewrites or renames a database type',
  },
  {
    id: 'alter-column-type',
    pattern: /\bALTER\s+COLUMN\b.*\bTYPE\b/i,
    message: 'rewrites a column type',
  },
];

const warningRules = [
  {
    id: 'drop-index',
    pattern: /\bDROP\s+INDEX\b/i,
    message: 'drops an index; confirm query plans and rollback behavior',
  },
  {
    id: 'plain-create-index',
    pattern: /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\b(?!\s+CONCURRENTLY\b)/i,
    message: 'creates an index without CONCURRENTLY; this can lock writes on existing tables',
  },
  {
    id: 'set-not-null',
    pattern: /\bSET\s+NOT\s+NULL\b/i,
    message: 'sets NOT NULL; confirm existing rows and lock impact',
  },
  {
    id: 'not-null-column-without-default',
    pattern: /\bADD\s+COLUMN\b.*\bNOT\s+NULL\b(?!.*\bDEFAULT\b)/i,
    message: 'adds a NOT NULL column without a visible default',
  },
];

const requiredRiskSections = [
  /^legacy confirmation:/im,
  /^backup plan:/im,
  /^rollback plan:/im,
];

function usage() {
  return `Usage: node scripts/check-prisma-migration-safety.mjs [--base <ref>] [--head <ref>] [--all] [--help]

Checks newly added or changed Prisma migration SQL for destructive operations.

By default the script compares MIGRATION_SAFETY_BASE/GITHUB_EVENT_BEFORE to
MIGRATION_SAFETY_HEAD/GITHUB_SHA. If no usable base is available it falls back
to HEAD^..HEAD.

Fatal findings are allowed only when the migration directory contains RISK.md
with these top-level sections:
  Legacy confirmation:
  Backup plan:
  Rollback plan:
`;
}

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseArgs(argv) {
  const parsed = {
    all: false,
    base: process.env.MIGRATION_SAFETY_BASE || process.env.GITHUB_EVENT_BEFORE || '',
    head: process.env.MIGRATION_SAFETY_HEAD || process.env.GITHUB_SHA || 'HEAD',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--all') {
      parsed.all = true;
    } else if (arg === '--base') {
      parsed.base = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--head') {
      parsed.head = argv[index + 1] ?? '';
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function isUsableRef(ref) {
  return Boolean(ref && !ZERO_SHA.test(ref));
}

function refExists(ref) {
  if (!isUsableRef(ref)) return false;
  return runGit(['rev-parse', '--verify', `${ref}^{commit}`], { allowFailure: true }).ok;
}

function fallbackBaseRef(head) {
  const candidate = `${head || 'HEAD'}^`;
  return refExists(candidate) ? candidate : '';
}

function changedMigrationFiles({ all, base, head }) {
  if (all) {
    return runGit(['ls-files', `${migrationsDir}/*/migration.sql`]).stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((file) => ({ status: 'M', file }));
  }

  const resolvedHead = head || 'HEAD';
  const resolvedBase = refExists(base) ? base : fallbackBaseRef(resolvedHead);
  if (!resolvedBase) {
    console.warn('No usable base ref found; skipping migration safety diff.');
    return [];
  }

  return runGit(['diff', '--name-status', resolvedBase, resolvedHead, '--', migrationsDir]).stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, firstPath, secondPath] = line.split(/\t+/);
      return { status, file: secondPath || firstPath };
    })
    .filter(({ file }) => file.endsWith('/migration.sql'));
}

function stripBlockCommentsPreservingLines(input) {
  return input.replace(/\/\*[\s\S]*?\*\//g, (match) => (
    match
      .split('\n')
      .map(() => '')
      .join('\n')
  ));
}

function sqlLineForScan(line) {
  return line.replace(/--.*$/, '');
}

export function scanSqlContent(content, file) {
  const lines = stripBlockCommentsPreservingLines(content).split('\n');
  const fatal = [];
  const warnings = [];

  for (const [index, rawLine] of lines.entries()) {
    const line = sqlLineForScan(rawLine);
    if (!line.trim()) continue;

    for (const rule of fatalRules) {
      if (rule.pattern.test(line)) {
        fatal.push({
          file,
          line: index + 1,
          ruleId: rule.id,
          message: rule.message,
          source: rawLine.trim(),
        });
      }
    }

    for (const rule of warningRules) {
      if (rule.pattern.test(line)) {
        warnings.push({
          file,
          line: index + 1,
          ruleId: rule.id,
          message: rule.message,
          source: rawLine.trim(),
        });
      }
    }
  }

  return { fatal, warnings };
}

export function riskFileStatus(migrationSqlPath) {
  const riskPath = path.join(path.dirname(path.resolve(repoRoot, migrationSqlPath)), 'RISK.md');
  if (!existsSync(riskPath)) {
    return { ok: false, path: riskPath, reason: 'missing RISK.md' };
  }

  const body = readFileSync(riskPath, 'utf8');
  const missing = requiredRiskSections.filter((pattern) => !pattern.test(body));
  if (missing.length > 0) {
    return {
      ok: false,
      path: riskPath,
      reason: 'RISK.md must include Legacy confirmation:, Backup plan:, and Rollback plan: sections',
    };
  }

  return { ok: true, path: riskPath, reason: '' };
}

function escapeAnnotation(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

function annotate(level, finding) {
  const message = `${finding.ruleId}: ${finding.message}. SQL: ${finding.source}`;
  console.log(`::${level} file=${finding.file},line=${finding.line}::${escapeAnnotation(message)}`);
}

function printFinding(prefix, finding) {
  console.log(`${prefix} ${finding.file}:${finding.line} ${finding.ruleId} - ${finding.message}`);
  console.log(`    ${finding.source}`);
}

export function evaluateFindings(files) {
  const allFatal = [];
  const allWarnings = [];
  const deletedMigrationFiles = [];

  for (const { status, file } of files) {
    if (status.startsWith('D')) {
      deletedMigrationFiles.push(file);
      continue;
    }

    const absolutePath = path.resolve(repoRoot, file);
    if (!existsSync(absolutePath)) continue;

    const result = scanSqlContent(readFileSync(absolutePath, 'utf8'), file);
    allFatal.push(...result.fatal);
    allWarnings.push(...result.warnings);
  }

  const unapprovedFatal = [];
  for (const finding of allFatal) {
    const risk = riskFileStatus(finding.file);
    if (!risk.ok) {
      unapprovedFatal.push({ ...finding, risk });
    }
  }

  return {
    deletedMigrationFiles,
    fatal: allFatal,
    warnings: allWarnings,
    unapprovedFatal,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const files = changedMigrationFiles(options);
  if (files.length === 0) {
    console.log('No added or changed Prisma migration SQL files to check.');
    return;
  }

  console.log(`Checking ${files.length} Prisma migration SQL file(s):`);
  for (const { status, file } of files) {
    console.log(`- ${status} ${file}`);
  }

  const result = evaluateFindings(files);

  for (const finding of result.warnings) {
    annotate('warning', finding);
    printFinding('WARNING', finding);
  }

  const unapprovedKeys = new Set(result.unapprovedFatal.map((finding) => (
    `${finding.file}:${finding.line}:${finding.ruleId}`
  )));

  for (const finding of result.fatal) {
    const key = `${finding.file}:${finding.line}:${finding.ruleId}`;
    if (unapprovedKeys.has(key)) {
      annotate('error', finding);
      printFinding('FATAL', finding);
    } else {
      annotate('warning', finding);
      printFinding('REVIEWED', finding);
    }
  }

  for (const file of result.deletedMigrationFiles) {
    console.log(`::error file=${file}::Deleting a committed Prisma migration is blocked.`);
    console.log(`FATAL ${file} - deleting a committed Prisma migration is blocked`);
  }

  if (result.unapprovedFatal.length > 0 || result.deletedMigrationFiles.length > 0) {
    for (const finding of result.unapprovedFatal) {
      console.log(`Missing review for ${finding.file}:${finding.line}: ${finding.risk.reason}`);
    }
    console.error('\nMigration safety check failed. Add a reviewed RISK.md beside each destructive migration before release.');
    process.exit(1);
  }

  if (result.fatal.length > 0) {
    console.log('Destructive migration SQL found, but each finding has a reviewed RISK.md.');
  } else {
    console.log('No destructive migration SQL found.');
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  main();
}
