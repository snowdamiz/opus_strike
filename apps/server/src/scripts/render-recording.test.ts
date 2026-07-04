import assert from 'node:assert/strict';
import { shouldAbortRecordingRenderRequest } from './render-recording';

function main(): void {
  assert.equal(
    shouldAbortRecordingRenderRequest({
      resourceType: 'stylesheet',
      url: 'https://fonts.googleapis.com/css2?family=Rajdhani&display=swap',
    }),
    true
  );
  assert.equal(
    shouldAbortRecordingRenderRequest({
      resourceType: 'font',
      url: 'https://fonts.gstatic.com/s/orbitron/v34/font.woff2',
    }),
    true
  );
  assert.equal(
    shouldAbortRecordingRenderRequest({
      resourceType: 'font',
      url: 'https://cdn.example.test/assets/display.woff2',
    }),
    true
  );
  assert.equal(
    shouldAbortRecordingRenderRequest({
      resourceType: 'stylesheet',
      url: 'http://127.0.0.1:5173/assets/index.css',
    }),
    false
  );
  assert.equal(
    shouldAbortRecordingRenderRequest({
      resourceType: 'fetch',
      url: 'http://127.0.0.1:5173/__recording/events.ndjson',
    }),
    false
  );
  assert.equal(
    shouldAbortRecordingRenderRequest({
      resourceType: 'font',
      url: 'data:font/woff2;base64,d09GMgABAAAAA',
    }),
    false
  );

  console.log('render recording tests passed');
}

main();
