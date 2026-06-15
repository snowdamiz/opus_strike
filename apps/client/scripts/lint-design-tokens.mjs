#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const strictUiExemptions = [
  /^src\/components\/ui\/(?:HUD|HeroIcons|SlideEffects|TeleportEffects|UltimateEffects)\.tsx$/,
];

const tokenSourceFiles = new Set([
  'src/styles/colorTokens.ts',
  'src/styles/index.css',
  'tailwind.config.js',
]);

const literalPattern = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\((?!\s*var\()[^)]+\)/g;
const scannedExtensions = new Set(['.ts', '.tsx', '.css', '.js']);

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.turbo'].includes(entry)) continue;
    const absolute = path.join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      files.push(...listFiles(absolute));
      continue;
    }
    if (scannedExtensions.has(path.extname(entry))) files.push(absolute);
  }
  return files;
}

function toRelative(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function isStrictUiFile(relativePath) {
  if (tokenSourceFiles.has(relativePath)) return false;
  if (strictUiExemptions.some((pattern) => pattern.test(relativePath))) return false;
  if (relativePath === 'src/App.tsx') return true;
  if (relativePath === 'src/store/settingsStore.ts') return true;
  return /^src\/components\/ui\/.+\.(ts|tsx)$/.test(relativePath);
}

function parseHexChannels(value) {
  const hex = value.slice(1).toLowerCase();
  const normalized = hex.length === 3 || hex.length === 4
    ? hex.slice(0, 3).split('').map((char) => char + char).join('')
    : hex.slice(0, 6);

  if (normalized.length !== 6) return null;
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function parseFunctionalChannels(value) {
  const body = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'));
  if (body.includes('var(') || body.includes('${')) return null;
  const numbers = body.match(/-?\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  return numbers?.length === 3 ? numbers : null;
}

function isAllowedNeutralLiteral(value) {
  const channels = value.startsWith('#') ? parseHexChannels(value) : parseFunctionalChannels(value);
  if (!channels) return false;
  const [red, green, blue] = channels;
  return (red === 0 && green === 0 && blue === 0) || (red === 255 && green === 255 && blue === 255);
}

function lintFile(file) {
  const relativePath = toRelative(file);
  if (!isStrictUiFile(relativePath)) return [];

  const issues = [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let inSvg = false;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const enteringSvg = /<svg\b/.test(line);
    const leavingSvg = /<\/svg>/.test(line);
    if (enteringSvg) inSvg = true;

    if (!inSvg && !line.includes('design-token-lint-ignore')) {
      const matches = line.matchAll(literalPattern);
      for (const match of matches) {
        const literal = match[0];
        if (isAllowedNeutralLiteral(literal)) continue;
        issues.push({
          file: relativePath,
          line: lineNumber,
          literal,
          text: line.trim(),
        });
      }
    }

    if (leavingSvg) inSvg = false;
  });

  return issues;
}

const issues = listFiles(root).flatMap(lintFile);

if (issues.length > 0) {
  console.error('\nDesign token lint failed: raw color literals found in strict UI files.\n');
  for (const issue of issues.slice(0, 50)) {
    console.error(`${issue.file}:${issue.line} ${issue.literal}`);
    console.error(`  ${issue.text}`);
  }
  if (issues.length > 50) {
    console.error(`\n...and ${issues.length - 50} more issues.`);
  }
  console.error('\nUse tokens from src/styles/colorTokens.ts, CSS variables from src/styles/index.css, or Tailwind strike/accent/team/ui tokens.');
  console.error('For intentional SVG/effect art, move it to an exempt art/effect file or add a narrowly-scoped token.\n');
  process.exit(1);
}

console.log('Design token lint passed.');
