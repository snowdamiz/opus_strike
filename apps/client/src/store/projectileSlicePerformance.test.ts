import assert from 'node:assert/strict';
import { useGameStore } from './gameStore';
import { projectileInitialState } from './slices/projectiles';
import type { RocketData } from './types';

function rocket(id: string, startTime: number): RocketData {
  return {
    id,
    position: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: 0, z: -18 },
    startTime,
    ownerId: 'player-a',
    ownerTeam: 'red',
  };
}

function resetProjectiles(): void {
  useGameStore.setState({ ...projectileInitialState });
}

resetProjectiles();
useGameStore.getState().addRocket(rocket('fresh', Date.now()));

let rocketReferenceChanges = 0;
const unsubscribe = useGameStore.subscribe((state, previousState) => {
  if (state.rockets !== previousState.rockets) {
    rocketReferenceChanges++;
  }
});

const activeReference = useGameStore.getState().rockets;
useGameStore.getState().clearExpiredRockets();
assert.equal(useGameStore.getState().rockets, activeReference);
assert.equal(rocketReferenceChanges, 0);

useGameStore.getState().removeRocket('missing');
assert.equal(useGameStore.getState().rockets, activeReference);
assert.equal(rocketReferenceChanges, 0);

useGameStore.getState().removeRockets(['missing-a', 'missing-b']);
assert.equal(useGameStore.getState().rockets, activeReference);
assert.equal(rocketReferenceChanges, 0);

useGameStore.setState({ rockets: [rocket('expired', Date.now() - 4000)] });
rocketReferenceChanges = 0;
const expiredReference = useGameStore.getState().rockets;
useGameStore.getState().clearExpiredRockets();
assert.notEqual(useGameStore.getState().rockets, expiredReference);
assert.equal(useGameStore.getState().rockets.length, 0);
assert.equal(rocketReferenceChanges, 1);

unsubscribe();
resetProjectiles();

useGameStore.getState().addRocket(rocket('batched-fresh', Date.now()));
let batchedRocketReferenceChanges = 0;
const unsubscribeBatched = useGameStore.subscribe((state, previousState) => {
  if (state.rockets !== previousState.rockets) {
    batchedRocketReferenceChanges++;
  }
});

const batchedActiveReference = useGameStore.getState().rockets;
useGameStore.getState().clearExpiredProjectiles();
assert.equal(useGameStore.getState().rockets, batchedActiveReference);
assert.equal(batchedRocketReferenceChanges, 0);

useGameStore.setState({ rockets: [rocket('batched-expired', Date.now() - 4000)] });
batchedRocketReferenceChanges = 0;
const batchedExpiredReference = useGameStore.getState().rockets;
useGameStore.getState().clearExpiredProjectiles();
assert.notEqual(useGameStore.getState().rockets, batchedExpiredReference);
assert.equal(useGameStore.getState().rockets.length, 0);
assert.equal(batchedRocketReferenceChanges, 1);

unsubscribeBatched();
resetProjectiles();

console.log('projectile slice performance tests passed');
