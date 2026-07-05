import assert from 'node:assert/strict';
import { readRecordingPlaybackProgress, shouldAbortRecordingRenderRequest } from './render-recording';

async function main(): Promise<void> {
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

  const progress = await readRecordingPlaybackProgress({
    evaluate: async () => ({
      currentTimeMs: 12_500,
      durationMs: 50_000,
      progress: 0.25,
      playbackError: null,
      playbackWarningCount: 2,
    }),
  } as any);
  assert.deepEqual(progress, {
    currentTimeMs: 12_500,
    durationMs: 50_000,
    progress: 0.25,
    playbackError: null,
    playbackWarningCount: 2,
  });

  console.log('render recording tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
