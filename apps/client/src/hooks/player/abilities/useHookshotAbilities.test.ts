import assert from 'node:assert/strict';
import type { GrappleLineData } from '../../../store/types';
import { selectCurrentGrappleLine } from './useHookshotAbilities';

function line(overrides: Partial<GrappleLineData> = {}): GrappleLineData {
  return {
    id: 'grapple-1',
    startPosition: { x: 0, y: 1, z: 0 },
    endPosition: { x: 0, y: 7, z: -12 },
    startTime: 1000,
    ownerId: 'local-player',
    state: 'extending',
    launchSide: 1,
    launchYaw: 0,
    ...overrides,
  };
}

{
  const attached = line({ state: 'attached' });
  const selected = selectCurrentGrappleLine([attached], 'grapple-1', 'local-player');

  assert.equal(selected, attached, 'active grapple lookup should read the current store line object');
  assert.equal(selected?.state, 'attached');
}

{
  const selected = selectCurrentGrappleLine([
    line({ id: 'other-player-grapple', ownerId: 'other-player', state: 'attached' }),
    line({ id: 'finished-grapple', state: 'done' }),
    line({ id: 'current-grapple', state: 'extending' }),
  ], null, 'local-player');

  assert.equal(selected?.id, 'current-grapple');
}

console.log('hookshot abilities tests passed');
