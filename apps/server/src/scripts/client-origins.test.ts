import assert from 'node:assert/strict';
import {
  getAllowedClientOrigins,
  isCorsOriginAllowed,
  normalizeClientOrigin,
  readClientOriginList,
} from '../config/clientOrigins';

const productionEnv = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
const developmentEnv = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;

assert.equal(normalizeClientOrigin('https://slopheroes.xyz/play?mode=ranked'), 'https://slopheroes.xyz');
assert.equal(normalizeClientOrigin('https://www.slopheroes.xyz/'), 'https://www.slopheroes.xyz');
assert.equal(normalizeClientOrigin('wss://slopheroes.xyz'), null);
assert.equal(normalizeClientOrigin('not a url'), null);

assert.deepEqual(
  readClientOriginList('https://example.com/path, not a url, https://example.com/other'),
  ['https://example.com', 'https://example.com']
);

const productionOrigins = getAllowedClientOrigins(productionEnv);
assert.ok(productionOrigins.includes('https://slopheroes.xyz'));
assert.ok(productionOrigins.includes('https://www.slopheroes.xyz'));
assert.ok(productionOrigins.includes('https://opus-strike-client.fly.dev'));
assert.equal(isCorsOriginAllowed('https://slopheroes.xyz', productionOrigins, productionEnv), true);
assert.equal(isCorsOriginAllowed('https://www.slopheroes.xyz', productionOrigins, productionEnv), true);
assert.equal(isCorsOriginAllowed('https://opus-strike-client.fly.dev', productionOrigins, productionEnv), true);
assert.equal(isCorsOriginAllowed('https://evil.example', productionOrigins, productionEnv), false);

const configuredOrigins = getAllowedClientOrigins({
  NODE_ENV: 'production',
  CLIENT_ORIGIN: 'https://configured.example.com/app',
  ALLOWED_ORIGINS: 'https://extra.example.com/, invalid origin',
} as NodeJS.ProcessEnv);
assert.ok(configuredOrigins.includes('https://configured.example.com'));
assert.ok(configuredOrigins.includes('https://extra.example.com'));

assert.equal(isCorsOriginAllowed('https://any.localhost.example', [], developmentEnv), true);
assert.equal(isCorsOriginAllowed(undefined, productionOrigins, productionEnv), false);

console.log('Client origin config tests passed.');
