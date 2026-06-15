import assert from 'node:assert/strict';
import { quantizeSlideIntensityForStyle } from './SlideEffects';

assert.equal(quantizeSlideIntensityForStyle(-1), 0);
assert.equal(quantizeSlideIntensityForStyle(0.009), 0);
assert.equal(quantizeSlideIntensityForStyle(0.123), 0.1);
assert.equal(quantizeSlideIntensityForStyle(0.126), 0.15);
assert.equal(quantizeSlideIntensityForStyle(2), 1);
