import assert from 'node:assert/strict';
import {
  createStreamerObserverTicket,
  verifyStreamerObserverTicket,
} from '../security/streamerTickets';

const ticket = createStreamerObserverTicket({
  adminUserId: 'admin-a',
  gameRoomId: 'room-a',
  ttlMs: 30_000,
});

const claims = verifyStreamerObserverTicket(ticket, {
  adminUserId: 'admin-a',
  gameRoomId: 'room-a',
});

assert.ok(claims);
assert.equal(claims.adminUserId, 'admin-a');
assert.equal(claims.gameRoomId, 'room-a');

assert.equal(
  verifyStreamerObserverTicket(ticket, {
    adminUserId: 'admin-b',
    gameRoomId: 'room-a',
  }),
  null
);

assert.equal(
  verifyStreamerObserverTicket(ticket, {
    adminUserId: 'admin-a',
    gameRoomId: 'room-b',
  }),
  null
);

const expiredTicket = createStreamerObserverTicket({
  adminUserId: 'admin-a',
  gameRoomId: 'room-a',
  ttlMs: -1,
});

assert.equal(
  verifyStreamerObserverTicket(expiredTicket, {
    adminUserId: 'admin-a',
    gameRoomId: 'room-a',
  }),
  null
);

console.log('streamer ticket tests passed');
