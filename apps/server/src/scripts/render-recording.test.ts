import assert from 'node:assert/strict';
import { captureRecordingFrame, shouldAbortRecordingRenderRequest } from './render-recording';

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

  const previousFrame = Buffer.from('previous-frame');
  let evaluatedTimeMs: number | null = null;
  const reusedFrame = await captureRecordingFrame({
    frame: 12,
    recordingTimeMs: 200,
    previousFrame,
    page: {
      evaluate: async (_pageFunction: (...args: any[]) => unknown, arg?: unknown) => {
        evaluatedTimeMs = typeof arg === 'number' ? arg : null;
        return undefined;
      },
      screenshot: async () => {
        throw new Error('page.screenshot: Timeout 45000ms exceeded');
      },
    } as any,
  });
  assert.equal(evaluatedTimeMs, 200);
  assert.equal(reusedFrame, previousFrame);

  await assert.rejects(
    () => captureRecordingFrame({
      frame: 0,
      recordingTimeMs: 0,
      previousFrame: null,
      page: {
        evaluate: async () => undefined,
        screenshot: async () => {
          throw new Error('page.screenshot: Timeout 45000ms exceeded');
        },
      } as any,
    }),
    /Timeout 45000ms exceeded/
  );

  console.log('render recording tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
