import assert from 'node:assert/strict';
import { getRankedBreakdownRows } from './RankBadge';

const rows = getRankedBreakdownRows({
  rulesVersion: 'ranked_br_v2',
  placement: 3,
  placementPoints: 60,
  combatPoints: 24,
  entryCost: 40,
  qualityMultiplier: 0.75,
  grossPoints: 63,
  earlyLeaver: false,
});

assert.deepEqual(rows, [
  { label: 'Placement', value: '#3', tone: 'neutral' },
  { label: 'Placement RP', value: '+60', tone: 'positive' },
  { label: 'Combat RP', value: '+24', tone: 'positive' },
  { label: 'Lobby quality', value: '75%', tone: 'neutral' },
  { label: 'Earned RP', value: '+63', tone: 'positive' },
  { label: 'Entry cost', value: '-40', tone: 'negative' },
]);

console.log('rank badge tests passed');
