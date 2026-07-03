#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  evaluateFindings,
  riskFileStatus,
  scanSqlContent,
} from './check-prisma-migration-safety.mjs';

function testDetectsDestructiveSql() {
  const result = scanSqlContent('ALTER TABLE "User" DROP COLUMN IF EXISTS "legacyName";\n', 'migration.sql');
  assert.equal(result.fatal.length, 1);
  assert.equal(result.fatal[0].ruleId, 'drop-column');
}

function testIgnoresSqlComments() {
  const result = scanSqlContent([
    '-- DROP TABLE "User";',
    '/*',
    'DELETE FROM "User";',
    '*/',
    'CREATE TABLE "Example" ("id" TEXT NOT NULL);',
    '',
  ].join('\n'), 'migration.sql');

  assert.equal(result.fatal.length, 0);
}

function testWarningsDoNotFailEvaluation() {
  const result = scanSqlContent('CREATE INDEX "User_name_idx" ON "User"("name");\n', 'migration.sql');
  assert.equal(result.fatal.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].ruleId, 'plain-create-index');
}

function testRiskFileRequiresSections() {
  const dir = mkdtempSync(path.join(tmpdir(), 'migration-risk-'));
  try {
    const sqlPath = path.join(dir, 'migration.sql');
    writeFileSync(sqlPath, 'DROP TABLE "Legacy";\n');

    let status = riskFileStatus(sqlPath);
    assert.equal(status.ok, false);
    assert.equal(status.reason, 'missing RISK.md');

    writeFileSync(path.join(dir, 'RISK.md'), [
      'Legacy confirmation:',
      'This table is confirmed unused.',
      '',
      'Backup plan:',
      'Take and verify a production backup before deploy.',
      '',
      'Rollback plan:',
      'Restore from backup or apply a forward fix.',
      '',
    ].join('\n'));

    status = riskFileStatus(sqlPath);
    assert.equal(status.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testEvaluateBlocksUnreviewedFatal() {
  const result = evaluateFindings([
    {
      status: 'M',
      file: 'apps/server/prisma/migrations/20260630080000_remove_skin_nft_projection/migration.sql',
    },
  ]);

  assert.ok(result.fatal.length > 0);
  assert.ok(result.unapprovedFatal.length > 0);
}

function testEvaluateAllowsReviewedFatal() {
  const dir = mkdtempSync(path.join(tmpdir(), 'migration-reviewed-'));
  try {
    const sqlPath = path.join(dir, 'migration.sql');
    writeFileSync(sqlPath, 'DROP TABLE "Legacy";\n');
    writeFileSync(path.join(dir, 'RISK.md'), [
      'Legacy confirmation:',
      'The table is confirmed legacy.',
      '',
      'Backup plan:',
      'Take a verified backup before deploy.',
      '',
      'Rollback plan:',
      'Restore the backup if this has to be reverted.',
      '',
    ].join('\n'));

    const result = evaluateFindings([{ status: 'M', file: sqlPath }]);
    assert.equal(result.fatal.length, 1);
    assert.equal(result.unapprovedFatal.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

testDetectsDestructiveSql();
testIgnoresSqlComments();
testWarningsDoNotFailEvaluation();
testRiskFileRequiresSections();
testEvaluateBlocksUnreviewedFatal();
testEvaluateAllowsReviewedFatal();

console.log('check-prisma-migration-safety tests passed');
