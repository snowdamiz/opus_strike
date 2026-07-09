import assert from 'node:assert/strict';
import {
  getMobileAccessBlockReason,
  type MobileGameAccessSnapshot,
} from './useMobileGameAccess';

function mobileAccessSnapshot(overrides: Partial<MobileGameAccessSnapshot> = {}): MobileGameAccessSnapshot {
  return {
    isFullscreen: false,
    isLandscape: true,
    isMobile: true,
    isRequestFullscreenSupported: true,
    ...overrides,
  };
}

assert.equal(
  getMobileAccessBlockReason(mobileAccessSnapshot({ isLandscape: false })),
  'portrait',
  'mobile portrait should still require landscape'
);

assert.equal(
  getMobileAccessBlockReason(mobileAccessSnapshot()),
  'fullscreen',
  'fullscreen-capable mobile landscape should request fullscreen before controls unlock'
);

assert.equal(
  getMobileAccessBlockReason(mobileAccessSnapshot({ isRequestFullscreenSupported: false })),
  null,
  'mobile landscape browsers without fullscreen support should not be permanently blocked'
);

assert.equal(
  getMobileAccessBlockReason(mobileAccessSnapshot({ isLandscape: false, isMobile: false })),
  null,
  'desktop layouts should not be blocked by mobile access checks'
);

console.log('mobile game access tests passed');
