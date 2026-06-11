import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { matchMaker } from 'colyseus';
import {
  Connection,
  Message,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { MatchMode } from '@voxel-strike/shared';
import prisma from '../db';
import { loggers } from '../utils/logger';
import { getColyseusRuntimeConfig } from '../config/colyseus';
import { getSharedRedisClient } from '../config/redis';
import {
  assertPublicKey,
  assertWagerPaymentsConfigured,
  getSettlementKeypair,
  getWagerRuntimeConfig,
  type WagerRuntimeConfig,
} from './config';
import {
  bigintToJson,
  calculateNetRefundLamports,
  calculateWagerPayouts,
  evaluateWagerStartEligibility,
  WAGER_TOKEN,
  type WagerRosterPlayer,
  type WagerStartEligibility,
} from './math';
import { wagerEventBus } from './eventBus';
import { runWithRedisOwnerLock, type RedisOwnerLockClient } from './workerLock';
import {
  createWagerMemo,
  findWagerMemoInParsedTransaction,
  verifyParsedSolPayment,
  type PaymentVerificationFailure,
} from './solana';

type WagerPaymentStatus =
  | 'intent_created'
  | 'submitted'
  | 'confirmed'
  | 'credited'
  | 'refunding'
  | 'refunded'
  | 'settled'
  | 'failed'
  | 'expired';

type WageredLobbyStatus =
  | 'waiting'
  | 'locked'
  | 'in_game'
  | 'review_required'
  | 'settling'
  | 'settled'
  | 'refunding'
  | 'refunded'
  | 'failed';

type TransferKind = 'winner_payout' | 'developer_fee' | 'refund';

const WAGER_BACKGROUND_LOCK_TTL_MS = 45_000;
const WAGER_BACKGROUND_LOCK_HEARTBEAT_MS = 15_000;
const WAGER_TRANSFER_RETRY_GRACE_MS = 60_000;

export interface CreateWagerOptions {
  enabled?: boolean;
  coverChargeLamports?: unknown;
  token?: string;
}

export interface LobbyWagerSnapshot {
  enabled: boolean;
  wageredLobbyId?: string;
  lobbyId?: string;
  matchMode?: MatchMode;
  rankedEntryQuoteId?: string | null;
  status?: WageredLobbyStatus;
  token?: typeof WAGER_TOKEN;
  coverChargeLamports?: string;
  treasuryWallet?: string;
  platformFeeBps?: number;
  potLamports?: string;
  paidPlayerCount?: number;
}

export interface WagerPaymentIntentPayload {
  intentId: string;
  lobbyId: string;
  status: WagerPaymentStatus;
  token: typeof WAGER_TOKEN;
  amountLamports: string;
  treasuryWallet: string;
  walletAddress: string;
  memo: string;
  expiresAt: string;
  cluster: string;
}

export interface WagerPaymentTransactionPayload {
  intentId: string;
  transactionBase64: string;
  lastValidBlockHeight: number;
  cluster: string;
}

export interface PlayerWagerPaymentStatus {
  lobbyPlayerId: string;
  userId: string | null;
  status: WagerPaymentStatus | 'not_required' | 'unpaid';
  walletAddress?: string;
  amountLamports?: string;
  depositSignature?: string;
  refundSignature?: string;
  refundReason?: string | null;
  refundGrossLamports?: string;
  refundOutboundFeeLamports?: string;
  refundNetLamports?: string;
  refundFeeSource?: string | null;
}

export interface LockedWagerPlayer {
  lobbyPlayerId: string;
  userId: string;
  walletAddress: string;
  team: 'red' | 'blue';
  amountLamports: string;
}

export interface LockedWagerContext {
  wageredLobbyId: string;
  lobbyId: string;
  token: typeof WAGER_TOKEN;
  coverChargeLamports: string;
  treasuryWallet: string;
  platformFeeBps: number;
  matchMode: MatchMode;
  rankedEntryQuoteId?: string | null;
  paidPlayers: LockedWagerPlayer[];
}

export interface WagerPaymentStatusChanged {
  lobbyId: string;
  userId: string;
  lobbyPlayerId: string | null;
  status: WagerPaymentStatus;
  amountLamports: string;
  walletAddress: string;
  depositSignature?: string | null;
  refundSignature?: string | null;
  refundReason?: string | null;
  refundGrossLamports?: string | null;
  refundOutboundFeeLamports?: string | null;
  refundNetLamports?: string | null;
  refundFeeSource?: string | null;
  potLamports: string;
}

export interface WagerSettlementSnapshot {
  settlementId: string;
  wageredLobbyId: string;
  status: string;
  totalPotLamports: string;
  developerFeeLamports: string;
  winnerPoolLamports: string;
  winningTeam: string | null;
}

interface TreasuryTransferResult {
  signature: string | null;
  confirmedAt: Date;
}

interface RefundTransferAudit {
  grossLamports: bigint;
  outboundFeeLamports: bigint;
  netLamports: bigint;
  feeSource: 'exact' | 'fallback';
}

interface WagerSettlementPaymentForStats {
  userId: string;
  walletAddress: string;
  teamAtLock: string | null;
  amountLamports: bigint;
  status: string;
}

interface WagerSettlementTransferForStats {
  kind: string;
  recipientWallet: string;
  amountLamports: bigint;
  status: string;
}

export interface WagerUserStatIncrement {
  userId: string;
  data: Prisma.UserUpdateInput;
}

function isCreditedStatus(status: string): boolean {
  return status === 'credited' || status === 'settled';
}

function isValidTeam(team: string | null | undefined): team is 'red' | 'blue' {
  return team === 'red' || team === 'blue';
}

function isSafeLamportNumber(value: bigint): boolean {
  return value <= BigInt(Number.MAX_SAFE_INTEGER);
}

function parseCoverChargeLamports(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  throw new Error('coverChargeLamports must be an integer lamport value');
}

function signatureLooksValid(signature: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(signature);
}

function base64LooksValid(value: string): boolean {
  return value.length > 0 && value.length <= 100_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function decodeUtf8InstructionData(instruction: TransactionInstruction): string {
  return Buffer.from(instruction.data).toString('utf8');
}

export function buildWagerUserStatIncrements(input: {
  payments: WagerSettlementPaymentForStats[];
  transfers: WagerSettlementTransferForStats[];
  winningTeam: string | null;
}): WagerUserStatIncrement[] {
  const winningTeam = isValidTeam(input.winningTeam) ? input.winningTeam : null;
  const payoutByWallet = new Map<string, bigint>();

  for (const transfer of input.transfers) {
    if (transfer.kind !== 'winner_payout' || transfer.status !== 'confirmed') continue;
    payoutByWallet.set(
      transfer.recipientWallet,
      (payoutByWallet.get(transfer.recipientWallet) ?? 0n) + transfer.amountLamports
    );
  }

  return input.payments
    .filter((payment) => isCreditedStatus(payment.status) && isValidTeam(payment.teamAtLock))
    .map((payment) => {
      const payoutLamports = winningTeam ? payoutByWallet.get(payment.walletAddress) ?? 0n : payment.amountLamports;
      const netLamports = payoutLamports - payment.amountLamports;

      return {
        userId: payment.userId,
        data: {
          totalWagerGames: { increment: 1 },
          totalWagerWins: { increment: winningTeam && payment.teamAtLock === winningTeam ? 1 : 0 },
          totalWagerLosses: { increment: winningTeam && payment.teamAtLock !== winningTeam ? 1 : 0 },
          totalWagerDraws: { increment: winningTeam ? 0 : 1 },
          totalWageredLamports: { increment: payment.amountLamports },
          totalWagerWonLamports: { increment: netLamports > 0n ? netLamports : 0n },
          totalWagerLostLamports: { increment: netLamports < 0n ? -netLamports : 0n },
        },
      };
    });
}

export class WagerService extends EventEmitter {
  private connection: Connection | null = null;
  private backgroundStarted = false;
  private backgroundTimers: ReturnType<typeof setInterval>[] = [];

  getConfig(): WagerRuntimeConfig {
    return getWagerRuntimeConfig();
  }

  private getConnection(): Connection {
    const config = this.getConfig();
    assertWagerPaymentsConfigured(config);
    if (!this.connection || this.connection.rpcEndpoint !== config.rpcUrl) {
      this.connection = new Connection(config.rpcUrl, 'confirmed');
    }
    return this.connection;
  }

  normalizeCreateOptions(options: CreateWagerOptions | undefined): { enabled: false } | {
    enabled: true;
    coverChargeLamports: bigint;
    token: typeof WAGER_TOKEN;
    treasuryWallet: string;
    platformFeeBps: number;
  } {
    if (!options?.enabled) return { enabled: false };
    const config = this.getConfig();
    assertWagerPaymentsConfigured(config);

    const token = options.token || WAGER_TOKEN;
    if (token !== WAGER_TOKEN) {
      throw new Error('Only native SOL wagers are supported');
    }

    const coverChargeLamports = parseCoverChargeLamports(options.coverChargeLamports);
    if (coverChargeLamports <= 0n) return { enabled: false };
    if (coverChargeLamports < config.minCoverChargeLamports || coverChargeLamports > config.maxCoverChargeLamports) {
      throw new Error(
        `Cover charge must be between ${config.minCoverChargeLamports.toString()} and ${config.maxCoverChargeLamports.toString()} lamports`
      );
    }
    if (!isSafeLamportNumber(coverChargeLamports)) {
      throw new Error('Cover charge is too large for lobby metadata');
    }

    return {
      enabled: true,
      coverChargeLamports,
      token: WAGER_TOKEN,
      treasuryWallet: config.treasuryWallet,
      platformFeeBps: config.platformFeeBps,
    };
  }

  async createWageredLobby(input: {
    lobbyId: string;
    createdByUserId: string;
    matchMode?: MatchMode;
    rankedEntryQuoteId?: string | null;
    options?: CreateWagerOptions;
  }): Promise<LobbyWagerSnapshot> {
    const normalized = this.normalizeCreateOptions(input.options);
    if (!normalized.enabled) return { enabled: false };

    const row = await prisma.wageredLobby.create({
      data: {
        lobbyId: input.lobbyId,
        matchMode: input.matchMode ?? 'custom_wager',
        rankedEntryQuoteId: input.rankedEntryQuoteId ?? null,
        status: 'waiting',
        token: normalized.token,
        coverChargeLamports: normalized.coverChargeLamports,
        treasuryWallet: normalized.treasuryWallet,
        platformFeeBps: normalized.platformFeeBps,
        createdByUserId: input.createdByUserId,
      },
    });

    return this.serializeLobbySnapshot(row, 0n, 0);
  }

  async getLobbySnapshot(lobbyId: string): Promise<LobbyWagerSnapshot> {
    const row = await prisma.wageredLobby.findUnique({
      where: { lobbyId },
      include: { payments: true },
    });
    if (!row) return { enabled: false };

    const credited = row.payments.filter((payment) => isCreditedStatus(payment.status));
    const pot = credited.reduce((sum, payment) => sum + payment.amountLamports, 0n);
    return this.serializeLobbySnapshot(row, pot, credited.length);
  }

  async getLobbyMetadata(lobbyId: string): Promise<Record<string, unknown>> {
    const snapshot = await this.getLobbySnapshot(lobbyId);
    if (!snapshot.enabled) {
      return {
        wagerEnabled: false,
      };
    }

    return {
      wagerEnabled: true,
      matchMode: snapshot.matchMode,
      rankedEntryQuoteId: snapshot.rankedEntryQuoteId,
      wagerStatus: snapshot.status,
      wagerToken: snapshot.token,
      wagerCoverChargeLamports: snapshot.coverChargeLamports,
      wagerPotLamports: snapshot.potLamports,
      wagerPaidPlayerCount: snapshot.paidPlayerCount,
      wagerTreasuryWallet: snapshot.treasuryWallet,
    };
  }

  async getPlayerPaymentStatuses(lobbyId: string, roster: WagerRosterPlayer[]): Promise<PlayerWagerPaymentStatus[]> {
    const snapshot = await this.getLobbySnapshot(lobbyId);
    if (!snapshot.enabled) {
      return roster.map((player) => ({
        lobbyPlayerId: player.lobbyPlayerId,
        userId: player.userId,
        status: 'not_required',
      }));
    }

    const userIds = roster
      .map((player) => player.userId)
      .filter((userId): userId is string => Boolean(userId && !userId.startsWith('guest:')));
    const wageredLobby = await prisma.wageredLobby.findUnique({
      where: { lobbyId },
      select: { id: true },
    });
    if (!wageredLobby || userIds.length === 0) {
      return roster.map((player) => ({
        lobbyPlayerId: player.lobbyPlayerId,
        userId: player.userId,
        status: player.isBot ? 'not_required' : 'unpaid',
      }));
    }

    const payments = await prisma.wagerPayment.findMany({
      where: {
        wageredLobbyId: wageredLobby.id,
        userId: { in: userIds },
      },
    });
    const byUserId = new Map(payments.map((payment) => [payment.userId, payment]));

    return roster.map((player) => {
      if (player.isBot) {
        return { lobbyPlayerId: player.lobbyPlayerId, userId: player.userId, status: 'not_required' };
      }
      const payment = player.userId ? byUserId.get(player.userId) : null;
      if (!payment || payment.status === 'expired' || payment.status === 'failed') {
        return { lobbyPlayerId: player.lobbyPlayerId, userId: player.userId, status: 'unpaid' };
      }
      return {
        lobbyPlayerId: player.lobbyPlayerId,
        userId: player.userId,
        status: payment.status as WagerPaymentStatus,
        walletAddress: payment.walletAddress,
        amountLamports: bigintToJson(payment.amountLamports),
        depositSignature: payment.depositSignature ?? undefined,
        refundSignature: payment.refundSignature ?? undefined,
        refundReason: payment.refundReason,
        refundGrossLamports: payment.refundGrossLamports === null ? undefined : bigintToJson(payment.refundGrossLamports),
        refundOutboundFeeLamports: payment.refundOutboundFeeLamports === null ? undefined : bigintToJson(payment.refundOutboundFeeLamports),
        refundNetLamports: payment.refundNetLamports === null ? undefined : bigintToJson(payment.refundNetLamports),
        refundFeeSource: payment.refundFeeSource,
      };
    });
  }

  async createPaymentIntent(input: {
    lobbyId: string;
    userId: string;
    walletAddress: string;
    lobbyPlayerId?: string | null;
    rankedEntryQuoteId?: string | null;
  }): Promise<WagerPaymentIntentPayload> {
    const config = this.getConfig();
    assertWagerPaymentsConfigured(config);
    assertPublicKey(input.walletAddress, 'walletAddress');
    if (input.userId.startsWith('guest:')) {
      throw new Error('Sign in with a Solana wallet before paying');
    }

    const wageredLobby = await prisma.wageredLobby.findUnique({ where: { lobbyId: input.lobbyId } });
    if (!wageredLobby) {
      throw new Error('Lobby is not wagered');
    }
    if (wageredLobby.status !== 'waiting' && wageredLobby.status !== 'locked') {
      throw new Error('This wager is no longer accepting payments');
    }
    if (wageredLobby.matchMode === 'ranked') {
      if (!input.rankedEntryQuoteId) {
        throw new Error('Ranked payment requires a ranked entry quote');
      }
      const quote = await prisma.rankedEntryQuote.findUnique({
        where: { id: input.rankedEntryQuoteId },
      });
      if (!quote || quote.userId !== input.userId) {
        throw new Error('Ranked entry quote not found');
      }
      if (quote.expiresAt.getTime() <= Date.now()) {
        throw new Error('Ranked entry quote has expired');
      }
      if (quote.coverChargeLamports !== wageredLobby.coverChargeLamports) {
        throw new Error('Ranked entry quote amount does not match this queue');
      }
    }

    const now = new Date();
    const active = await prisma.wagerPayment.findUnique({
      where: {
        wageredLobbyId_userId: {
          wageredLobbyId: wageredLobby.id,
          userId: input.userId,
        },
      },
    });

    if (
      active
      && active.status !== 'failed'
      && active.status !== 'expired'
      && active.status !== 'refunded'
      && active.intentExpiresAt.getTime() > now.getTime()
    ) {
      if (input.lobbyPlayerId && active.lobbyPlayerId !== input.lobbyPlayerId) {
        await prisma.wagerPayment.update({
          where: { id: active.id },
          data: { lobbyPlayerId: input.lobbyPlayerId },
        });
        active.lobbyPlayerId = input.lobbyPlayerId;
      }
      return this.serializePaymentIntent(active, wageredLobby.lobbyId, config);
    }

    const intentId = active?.id ?? randomUUID();
    const expiresAt = new Date(now.getTime() + config.intentTtlMs);
    const memo = createWagerMemo(intentId);

    const payment = active
      ? await prisma.wagerPayment.update({
        where: { id: active.id },
        data: {
          lobbyPlayerId: input.lobbyPlayerId ?? active.lobbyPlayerId,
          rankedEntryQuoteId: input.rankedEntryQuoteId ?? active.rankedEntryQuoteId,
          walletAddress: input.walletAddress,
          amountLamports: wageredLobby.coverChargeLamports,
          surplusLamports: 0n,
          memo,
          intentExpiresAt: expiresAt,
          status: 'intent_created',
          depositSignature: null,
          refundSignature: null,
          refundReason: null,
          refundGrossLamports: null,
          refundOutboundFeeLamports: null,
          refundNetLamports: null,
          refundFeeSource: null,
          lastError: null,
          creditedAt: null,
          refundedAt: null,
          settledAt: null,
          teamAtLock: null,
        },
      })
      : await prisma.wagerPayment.create({
        data: {
          id: intentId,
          wageredLobbyId: wageredLobby.id,
          lobbyPlayerId: input.lobbyPlayerId ?? null,
          userId: input.userId,
          walletAddress: input.walletAddress,
          rankedEntryQuoteId: input.rankedEntryQuoteId ?? null,
          amountLamports: wageredLobby.coverChargeLamports,
          memo,
          intentExpiresAt: expiresAt,
          status: 'intent_created',
        },
      });

    await this.emitPaymentStatusChanged(wageredLobby.lobbyId, payment.id);
    return this.serializePaymentIntent(payment, wageredLobby.lobbyId, config);
  }

  async submitPaymentSignature(input: {
    intentId: string;
    userId: string;
    signature: string;
  }): Promise<WagerPaymentIntentPayload> {
    if (!signatureLooksValid(input.signature)) {
      throw new Error('Invalid Solana transaction signature');
    }

    const payment = await prisma.wagerPayment.findUnique({
      where: { id: input.intentId },
      include: { wageredLobby: true },
    });
    if (!payment || payment.userId !== input.userId) {
      throw new Error('Payment intent not found');
    }
    if (payment.status === 'credited' || payment.status === 'settled') {
      return this.serializePaymentIntent(payment, payment.wageredLobby.lobbyId, this.getConfig());
    }

    const duplicate = await prisma.wagerPayment.findFirst({
      where: {
        depositSignature: input.signature,
        id: { not: payment.id },
      },
    });
    if (duplicate) {
      throw new Error('Transaction signature has already been used');
    }

    await prisma.wagerPayment.update({
      where: { id: payment.id },
      data: {
        depositSignature: input.signature,
        status: 'submitted',
        lastError: null,
      },
    });

    await this.verifySubmittedPayment(payment.id, { keepSubmittedWhenNotFound: true });
    const updated = await prisma.wagerPayment.findUniqueOrThrow({
      where: { id: payment.id },
      include: { wageredLobby: true },
    });
    return this.serializePaymentIntent(updated, updated.wageredLobby.lobbyId, this.getConfig());
  }

  async buildPaymentTransaction(input: {
    intentId: string;
    userId: string;
  }): Promise<WagerPaymentTransactionPayload> {
    const config = this.getConfig();
    assertWagerPaymentsConfigured(config);

    const payment = await prisma.wagerPayment.findUnique({
      where: { id: input.intentId },
      include: { wageredLobby: true },
    });
    if (!payment || payment.userId !== input.userId) {
      throw new Error('Payment intent not found');
    }
    if (payment.status === 'credited' || payment.status === 'settled') {
      throw new Error('Payment has already been credited');
    }
    if (payment.intentExpiresAt.getTime() <= Date.now()) {
      throw new Error('Payment intent has expired');
    }

    const latest = await this.getConnection().getLatestBlockhash('confirmed');
    const transaction = new Transaction({
      feePayer: new PublicKey(payment.walletAddress),
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }).add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(payment.walletAddress),
        toPubkey: new PublicKey(payment.wageredLobby.treasuryWallet),
        lamports: Number(payment.amountLamports),
      }),
      new TransactionInstruction({
        programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        keys: [],
        data: Buffer.from(payment.memo, 'utf8'),
      })
    );

    return {
      intentId: payment.id,
      transactionBase64: transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }).toString('base64'),
      lastValidBlockHeight: latest.lastValidBlockHeight,
      cluster: config.cluster,
    };
  }

  async submitSignedPaymentTransaction(input: {
    intentId: string;
    userId: string;
    signedTransactionBase64: string;
  }): Promise<WagerPaymentIntentPayload> {
    if (!base64LooksValid(input.signedTransactionBase64)) {
      throw new Error('Invalid signed transaction payload');
    }

    const payment = await prisma.wagerPayment.findUnique({
      where: { id: input.intentId },
      include: { wageredLobby: true },
    });
    if (!payment || payment.userId !== input.userId) {
      throw new Error('Payment intent not found');
    }
    if (payment.status === 'credited' || payment.status === 'settled') {
      return this.serializePaymentIntent(payment, payment.wageredLobby.lobbyId, this.getConfig());
    }
    if (payment.intentExpiresAt.getTime() <= Date.now()) {
      throw new Error('Payment intent has expired');
    }

    let transaction: Transaction;
    try {
      transaction = Transaction.from(Buffer.from(input.signedTransactionBase64, 'base64'));
    } catch {
      throw new Error('Signed transaction could not be decoded');
    }

    this.assertSignedPaymentTransactionMatchesIntent(transaction, payment);
    const signature = await this.getConnection().sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    return this.submitPaymentSignature({
      intentId: input.intentId,
      userId: input.userId,
      signature,
    });
  }

  async verifySubmittedPayment(
    paymentId: string,
    options: { keepSubmittedWhenNotFound?: boolean } = {}
  ): Promise<void> {
    const config = this.getConfig();
    assertWagerPaymentsConfigured(config);
    const payment = await prisma.wagerPayment.findUnique({
      where: { id: paymentId },
      include: { wageredLobby: true },
    });
    if (!payment?.depositSignature) return;
    if (payment.status === 'credited' || payment.status === 'settled') return;

    const transaction = await this.getConnection().getParsedTransaction(payment.depositSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    const result = verifyParsedSolPayment(transaction, {
      senderWallet: payment.walletAddress,
      treasuryWallet: payment.wageredLobby.treasuryWallet,
      amountLamports: payment.amountLamports,
      memo: payment.memo,
      createdAt: payment.createdAt,
      expiresAt: payment.intentExpiresAt,
      expiryGraceMs: config.intentExpiryGraceMs,
    });

    if (!result.ok) {
      const reason = result.reason ?? 'unparseable_transaction';
      if (reason === 'transaction_not_found' && options.keepSubmittedWhenNotFound) {
        await prisma.wagerPayment.update({
          where: { id: payment.id },
          data: { status: 'submitted', lastError: reason },
        });
        await this.emitPaymentStatusChanged(payment.wageredLobby.lobbyId, payment.id);
        return;
      }

      await prisma.wagerPayment.update({
        where: { id: payment.id },
        data: {
          status: this.verificationFailureToPaymentStatus(reason),
          lastError: result.detail ? `${reason}:${result.detail}` : reason,
        },
      });
      await this.emitPaymentStatusChanged(payment.wageredLobby.lobbyId, payment.id);
      return;
    }

    let refundReason = payment.refundReason;
    if (!refundReason && payment.rankedEntryQuoteId && payment.wageredLobby.status !== 'in_game') {
      const quote = await prisma.rankedEntryQuote.findUnique({
        where: { id: payment.rankedEntryQuoteId },
        select: { expiresAt: true },
      });
      if (!quote || quote.expiresAt.getTime() <= Date.now()) {
        refundReason = 'ranked_quote_expired';
      }
    }

    const credited = await prisma.wagerPayment.update({
      where: { id: payment.id },
      data: {
        status: 'credited',
        surplusLamports: result.payment?.surplusLamports ?? 0n,
        creditedAt: new Date(),
        refundReason,
        lastError: null,
      },
    });
    await this.emitPaymentStatusChanged(payment.wageredLobby.lobbyId, payment.id);
    if (credited.refundReason) {
      await this.refundSinglePayment(payment.id, credited.refundReason);
    }
  }

  async getStartEligibility(lobbyId: string, roster: WagerRosterPlayer[]): Promise<WagerStartEligibility> {
    const wageredLobby = await prisma.wageredLobby.findUnique({
      where: { lobbyId },
      include: { payments: true },
    });
    if (!wageredLobby) {
      return { canStart: true, unpaidPlayers: [], paidHumanCountByTeam: { red: 0, blue: 0 }, reasons: [] };
    }

    const creditedUserIds = new Set(
      wageredLobby.payments
        .filter((payment) => payment.status === 'credited' || payment.status === 'settled')
        .map((payment) => payment.userId)
    );
    return evaluateWagerStartEligibility(roster, creditedUserIds);
  }

  async lockLobbyRoster(lobbyId: string, roster: WagerRosterPlayer[]): Promise<LockedWagerContext | null> {
    const wageredLobby = await prisma.wageredLobby.findUnique({
      where: { lobbyId },
      include: { payments: true },
    });
    if (!wageredLobby) return null;

    const eligibility = await this.getStartEligibility(lobbyId, roster);
    if (!eligibility.canStart) {
      throw new Error(`Cannot start wagered lobby: ${eligibility.reasons.join(',')}`);
    }

    const teamByUserId = new Map<string, { team: 'red' | 'blue'; lobbyPlayerId: string }>();
    for (const player of roster) {
      if (!player.userId || !isValidTeam(player.team) || player.isBot) continue;
      teamByUserId.set(player.userId, { team: player.team, lobbyPlayerId: player.lobbyPlayerId });
    }

    const paidPlayers: LockedWagerPlayer[] = [];
    await prisma.$transaction(async (tx) => {
      await tx.wageredLobby.update({
        where: { id: wageredLobby.id },
        data: {
          status: 'locked',
          lockedAt: new Date(),
        },
      });

      for (const payment of wageredLobby.payments) {
        if (payment.status !== 'credited') continue;
        const rosterPlayer = teamByUserId.get(payment.userId);
        if (!rosterPlayer) continue;
        await tx.wagerPayment.update({
          where: { id: payment.id },
          data: {
            lobbyPlayerId: rosterPlayer.lobbyPlayerId,
            teamAtLock: rosterPlayer.team,
          },
        });
        paidPlayers.push({
          lobbyPlayerId: rosterPlayer.lobbyPlayerId,
          userId: payment.userId,
          walletAddress: payment.walletAddress,
          team: rosterPlayer.team,
          amountLamports: bigintToJson(payment.amountLamports),
        });
      }
    });

    return {
      wageredLobbyId: wageredLobby.id,
      lobbyId: wageredLobby.lobbyId,
      token: WAGER_TOKEN,
      coverChargeLamports: bigintToJson(wageredLobby.coverChargeLamports),
      treasuryWallet: wageredLobby.treasuryWallet,
      platformFeeBps: wageredLobby.platformFeeBps,
      matchMode: wageredLobby.matchMode as MatchMode,
      rankedEntryQuoteId: wageredLobby.rankedEntryQuoteId,
      paidPlayers,
    };
  }

  async unlockLobbyAfterStartFailure(lobbyId: string): Promise<void> {
    await prisma.wageredLobby.updateMany({
      where: {
        lobbyId,
        status: 'locked',
        gameRoomId: null,
      },
      data: {
        status: 'waiting',
        lockedAt: null,
      },
    });
  }

  async markLobbyInGame(lobbyId: string, gameRoomId: string): Promise<void> {
    await prisma.wageredLobby.updateMany({
      where: { lobbyId },
      data: {
        gameRoomId,
        status: 'in_game',
      },
    });
  }

  async attachMatchId(wageredLobbyId: string, matchId: string): Promise<void> {
    await prisma.wageredLobby.updateMany({
      where: { id: wageredLobbyId },
      data: { matchId },
    });
  }

  async refundPlayerBeforeGame(lobbyId: string, userId: string, reason: string): Promise<void> {
    const payment = await prisma.wagerPayment.findFirst({
      where: {
        userId,
        status: { in: ['submitted', 'confirmed', 'credited', 'refunding'] },
        wageredLobby: {
          lobbyId,
          status: { in: ['waiting', 'locked'] },
        },
      },
      include: { wageredLobby: true },
    });
    if (!payment) return;

    if (payment.status === 'submitted' || payment.status === 'confirmed') {
      await prisma.wagerPayment.update({
        where: { id: payment.id },
        data: {
          refundReason: reason,
          lastError: reason,
        },
      });
      await this.emitPaymentStatusChanged(payment.wageredLobby.lobbyId, payment.id);
      return;
    }

    loggers.room.info('Refunding pre-game wager payment', {
      lobbyId,
      userId,
      paymentId: payment.id,
      reason,
    });
    await this.refundSinglePayment(payment.id, reason);
  }

  async refundLobbyBeforeGame(lobbyId: string, reason: string): Promise<void> {
    const wageredLobby = await prisma.wageredLobby.findUnique({
      where: { lobbyId },
      include: { payments: true },
    });
    if (!wageredLobby) return;
    if (wageredLobby.gameRoomId || wageredLobby.status === 'in_game' || wageredLobby.status === 'settling' || wageredLobby.status === 'settled') {
      return;
    }

    await prisma.wageredLobby.update({
      where: { id: wageredLobby.id },
      data: { status: 'refunding' },
    });

    for (const payment of wageredLobby.payments) {
      if (payment.status === 'submitted' || payment.status === 'confirmed') {
        await prisma.wagerPayment.update({
          where: { id: payment.id },
          data: {
            refundReason: reason,
            lastError: reason,
          },
        });
        await this.emitPaymentStatusChanged(wageredLobby.lobbyId, payment.id);
        continue;
      }
      if (payment.status !== 'credited' && payment.status !== 'refunding') continue;
      await this.refundSinglePayment(payment.id, reason);
    }

    await prisma.wageredLobby.update({
      where: { id: wageredLobby.id },
      data: { status: 'refunded', settledAt: new Date() },
    });
  }

  async settleWageredLobby(input: {
    wageredLobbyId: string;
    matchId: string | null;
    winningTeam: 'red' | 'blue' | null;
  }): Promise<WagerSettlementSnapshot | null> {
    const wageredLobby = await prisma.wageredLobby.findUnique({
      where: { id: input.wageredLobbyId },
    });
    if (!wageredLobby) return null;

    const existingSettlement = await prisma.wagerSettlement.findUnique({
      where: { wageredLobbyId: wageredLobby.id },
    });
    if (existingSettlement?.status === 'complete') {
      return this.serializeSettlement(existingSettlement);
    }

    const settlement = await prisma.wagerSettlement.upsert({
      where: { wageredLobbyId: wageredLobby.id },
      create: {
        wageredLobbyId: wageredLobby.id,
        matchId: input.matchId,
        winningTeam: input.winningTeam,
        status: 'pending',
      },
      update: {
        matchId: input.matchId,
        winningTeam: input.winningTeam,
      },
    });

    await prisma.wageredLobby.update({
      where: { id: wageredLobby.id },
      data: { status: input.winningTeam ? 'settling' : 'refunding', matchId: input.matchId },
    });

    await this.processSettlement(settlement.id);
    const updated = await prisma.wagerSettlement.findUnique({ where: { id: settlement.id } });
    return updated ? this.serializeSettlement(updated) : null;
  }

  async retrySettlement(settlementId: string): Promise<WagerSettlementSnapshot> {
    await this.processSettlement(settlementId);
    const settlement = await prisma.wagerSettlement.findUniqueOrThrow({ where: { id: settlementId } });
    return this.serializeSettlement(settlement);
  }

  startBackgroundJobs(): void {
    if (this.backgroundStarted) return;
    this.backgroundStarted = true;

    const run = () => {
      this.runBackgroundJobWithLock('pass', () => this.runBackgroundOnce()).catch((error) => {
        loggers.room.error('Wager background job failed', error);
      });
    };

    this.backgroundTimers.push(setInterval(run, 30_000));
    this.backgroundTimers.push(setInterval(() => {
      this.runBackgroundJobWithLock('treasury-balance', () => this.checkTreasuryBalance()).catch((error) => {
        loggers.room.error('Wager treasury balance check failed', error);
      });
    }, 120_000));
    run();
  }

  stopBackgroundJobs(): void {
    for (const timer of this.backgroundTimers) clearInterval(timer);
    this.backgroundTimers = [];
    this.backgroundStarted = false;
  }

  private async runBackgroundJobWithLock(jobName: string, fn: () => Promise<void>): Promise<void> {
    const colyseusConfig = getColyseusRuntimeConfig();
    if (!colyseusConfig.distributed) {
      await fn();
      return;
    }

    const redis = getSharedRedisClient(colyseusConfig);
    if (!redis) {
      throw new Error('Distributed wager background jobs require Redis');
    }

    const lockKey = `wager:background:${jobName}:lock`;
    const ownerToken = `${matchMaker.processId || process.pid}:${process.pid}:${randomUUID()}`;
    const result = await runWithRedisOwnerLock(redis as RedisOwnerLockClient, {
      key: lockKey,
      ttlMs: WAGER_BACKGROUND_LOCK_TTL_MS,
      heartbeatMs: WAGER_BACKGROUND_LOCK_HEARTBEAT_MS,
      ownerToken,
      onAcquired: () => {
        loggers.room.debug('Wager background lock acquired', {
          jobName,
          lockKey,
          processId: matchMaker.processId,
          pid: process.pid,
        });
      },
      onSkipped: () => {
        loggers.room.debug('Wager background lock skipped', {
          jobName,
          lockKey,
          processId: matchMaker.processId,
          pid: process.pid,
        });
      },
      onExtended: () => {
        loggers.room.debug('Wager background lock renewed', {
          jobName,
          lockKey,
          processId: matchMaker.processId,
          pid: process.pid,
        });
      },
      onExtendFailed: () => {
        loggers.room.warn('Wager background lock renewal failed', {
          jobName,
          lockKey,
          processId: matchMaker.processId,
          pid: process.pid,
        });
      },
      onReleased: () => {
        loggers.room.debug('Wager background lock released', {
          jobName,
          lockKey,
          processId: matchMaker.processId,
          pid: process.pid,
        });
      },
    }, fn);

    if (!result.acquired) return;
  }

  async runBackgroundOnce(): Promise<void> {
    await this.expireOldIntents();
    await this.confirmSubmittedDeposits();
    await this.retryFailedRefunds();
    await this.retrySettlements();
    await this.reconcileRecentTreasuryDeposits();
  }

  private serializeLobbySnapshot(
    row: {
      id: string;
      lobbyId: string;
      matchMode?: string;
      rankedEntryQuoteId?: string | null;
      status: string;
      token: string;
      coverChargeLamports: bigint;
      treasuryWallet: string;
      platformFeeBps: number;
    },
    potLamports: bigint,
    paidPlayerCount: number
  ): LobbyWagerSnapshot {
    return {
      enabled: true,
      wageredLobbyId: row.id,
      lobbyId: row.lobbyId,
      matchMode: (row.matchMode ?? 'custom_wager') as MatchMode,
      rankedEntryQuoteId: row.rankedEntryQuoteId ?? null,
      status: row.status as WageredLobbyStatus,
      token: WAGER_TOKEN,
      coverChargeLamports: bigintToJson(row.coverChargeLamports),
      treasuryWallet: row.treasuryWallet,
      platformFeeBps: row.platformFeeBps,
      potLamports: bigintToJson(potLamports),
      paidPlayerCount,
    };
  }

  private serializePaymentIntent(
    payment: {
      id: string;
      status: string;
      amountLamports: bigint;
      walletAddress: string;
      memo: string;
      intentExpiresAt: Date;
      wageredLobby?: { lobbyId: string };
    },
    lobbyId: string,
    config: WagerRuntimeConfig
  ): WagerPaymentIntentPayload {
    return {
      intentId: payment.id,
      lobbyId,
      status: payment.status as WagerPaymentStatus,
      token: WAGER_TOKEN,
      amountLamports: bigintToJson(payment.amountLamports),
      treasuryWallet: config.treasuryWallet,
      walletAddress: payment.walletAddress,
      memo: payment.memo,
      expiresAt: payment.intentExpiresAt.toISOString(),
      cluster: config.cluster,
    };
  }

  private assertSignedPaymentTransactionMatchesIntent(
    transaction: Transaction,
    payment: {
      walletAddress: string;
      amountLamports: bigint;
      memo: string;
      wageredLobby: { treasuryWallet: string };
    }
  ): void {
    if (transaction.feePayer?.toBase58() !== payment.walletAddress) {
      throw new Error('Signed transaction fee payer does not match payment wallet');
    }
    if (!transaction.recentBlockhash) {
      throw new Error('Signed transaction is missing a recent blockhash');
    }

    const payerSignature = transaction.signatures.find((entry) => entry.publicKey.toBase58() === payment.walletAddress);
    if (!payerSignature?.signature) {
      throw new Error('Signed transaction is missing the payer signature');
    }

    if (transaction.instructions.length !== 2) {
      throw new Error('Signed transaction must contain only the wager transfer and memo');
    }

    const [transferInstruction, memoInstruction] = transaction.instructions;
    if (!transferInstruction || !memoInstruction) {
      throw new Error('Signed transaction is incomplete');
    }

    let transfer;
    try {
      transfer = SystemInstruction.decodeTransfer(transferInstruction);
    } catch {
      throw new Error('Signed transaction transfer instruction is invalid');
    }
    if (transfer.fromPubkey.toBase58() !== payment.walletAddress) {
      throw new Error('Signed transaction source wallet does not match payment wallet');
    }
    if (transfer.toPubkey.toBase58() !== payment.wageredLobby.treasuryWallet) {
      throw new Error('Signed transaction recipient does not match wager treasury');
    }
    if (BigInt(transfer.lamports) !== payment.amountLamports) {
      throw new Error('Signed transaction amount does not match wager intent');
    }

    if (memoInstruction.programId.toBase58() !== 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') {
      throw new Error('Signed transaction memo instruction is invalid');
    }
    if (decodeUtf8InstructionData(memoInstruction) !== payment.memo) {
      throw new Error('Signed transaction memo does not match wager intent');
    }
  }

  private serializeSettlement(settlement: {
    id: string;
    wageredLobbyId: string;
    status: string;
    totalPotLamports: bigint;
    developerFeeLamports: bigint;
    winnerPoolLamports: bigint;
    winningTeam: string | null;
  }): WagerSettlementSnapshot {
    return {
      settlementId: settlement.id,
      wageredLobbyId: settlement.wageredLobbyId,
      status: settlement.status,
      totalPotLamports: bigintToJson(settlement.totalPotLamports),
      developerFeeLamports: bigintToJson(settlement.developerFeeLamports),
      winnerPoolLamports: bigintToJson(settlement.winnerPoolLamports),
      winningTeam: settlement.winningTeam,
    };
  }

  private verificationFailureToPaymentStatus(reason: PaymentVerificationFailure): WagerPaymentStatus {
    if (reason === 'expired_intent' || reason === 'transaction_before_intent') return 'expired';
    return 'failed';
  }

  private async emitPaymentStatusChanged(lobbyId: string, paymentId: string): Promise<void> {
    const payment = await prisma.wagerPayment.findUnique({
      where: { id: paymentId },
      include: { wageredLobby: { include: { payments: true } } },
    });
    if (!payment) return;

    const potLamports = payment.wageredLobby.payments
      .filter((candidate) => isCreditedStatus(candidate.status))
      .reduce((sum, candidate) => sum + candidate.amountLamports, 0n);

    const payload = {
      lobbyId,
      userId: payment.userId,
      lobbyPlayerId: payment.lobbyPlayerId,
      status: payment.status,
      amountLamports: bigintToJson(payment.amountLamports),
      walletAddress: payment.walletAddress,
      depositSignature: payment.depositSignature,
      refundSignature: payment.refundSignature,
      refundReason: payment.refundReason,
      refundGrossLamports: payment.refundGrossLamports?.toString() ?? null,
      refundOutboundFeeLamports: payment.refundOutboundFeeLamports?.toString() ?? null,
      refundNetLamports: payment.refundNetLamports?.toString() ?? null,
      refundFeeSource: payment.refundFeeSource,
      potLamports: bigintToJson(potLamports),
    } satisfies WagerPaymentStatusChanged;

    this.emit('paymentStatusChanged', payload);
    await wagerEventBus.publishPaymentStatusChanged(payload).catch((error) => {
      loggers.room.error('Failed to publish wager payment status event', {
        lobbyId,
        paymentId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async estimateRefundTransferAudit(input: {
    recipientWallet: string;
    grossLamports: bigint;
  }): Promise<RefundTransferAudit> {
    if (input.grossLamports <= 0n) {
      return {
        grossLamports: input.grossLamports,
        outboundFeeLamports: 0n,
        netLamports: 0n,
        feeSource: 'exact',
      };
    }
    assertPublicKey(input.recipientWallet, 'recipientWallet');
    const config = this.getConfig();
    assertWagerPaymentsConfigured(config);
    if (input.recipientWallet === config.treasuryWallet) {
      return {
        grossLamports: input.grossLamports,
        outboundFeeLamports: 0n,
        netLamports: input.grossLamports,
        feeSource: 'exact',
      };
    }
    if (!isSafeLamportNumber(input.grossLamports)) {
      throw new Error('Refund amount exceeds safe lamport range');
    }

    const signer = getSettlementKeypair();
    if (!signer) {
      throw new Error('WAGER_SETTLEMENT_SECRET_KEY is required for payouts and refunds');
    }
    if (signer.publicKey.toBase58() !== config.treasuryWallet) {
      throw new Error('Settlement signer public key must match WAGER_TREASURY_WALLET');
    }

    let outboundFeeLamports = config.refundFeeFallbackLamports;
    let feeSource: RefundTransferAudit['feeSource'] = 'fallback';
    try {
      const latest = await this.getConnection().getLatestBlockhash('confirmed');
      const message: Message = new Transaction({
        feePayer: signer.publicKey,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      }).add(SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: new PublicKey(input.recipientWallet),
        lamports: Number(input.grossLamports),
      })).compileMessage();
      const fee = await this.getConnection().getFeeForMessage(message, 'confirmed');
      if (typeof fee.value === 'number' && Number.isSafeInteger(fee.value) && fee.value >= 0) {
        outboundFeeLamports = BigInt(fee.value);
        feeSource = 'exact';
      }
    } catch (error) {
      loggers.room.warn('Falling back to configured wager refund fee estimate', {
        recipientWallet: input.recipientWallet,
        grossLamports: input.grossLamports.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const netLamports = calculateNetRefundLamports(input.grossLamports, outboundFeeLamports);

    return {
      grossLamports: input.grossLamports,
      outboundFeeLamports,
      netLamports,
      feeSource,
    };
  }

  private async refundSinglePayment(paymentId: string, reason: string): Promise<void> {
    const payment = await prisma.wagerPayment.findUnique({
      where: { id: paymentId },
      include: { wageredLobby: true },
    });
    if (!payment || payment.status === 'refunded') return;
    if (payment.status !== 'credited' && payment.status !== 'refunding') return;
    if (
      payment.status === 'refunding'
      && !payment.refundSignature
      && payment.updatedAt.getTime() > Date.now() - WAGER_TRANSFER_RETRY_GRACE_MS
    ) {
      loggers.room.debug('Skipping recently claimed wager refund', {
        paymentId: payment.id,
        lobbyId: payment.wageredLobby.lobbyId,
      });
      return;
    }

    let audit: RefundTransferAudit;
    try {
      audit = payment.refundGrossLamports !== null
        && payment.refundOutboundFeeLamports !== null
        && payment.refundNetLamports !== null
        && (payment.refundFeeSource === 'exact' || payment.refundFeeSource === 'fallback')
        ? {
          grossLamports: payment.refundGrossLamports,
          outboundFeeLamports: payment.refundOutboundFeeLamports,
          netLamports: payment.refundNetLamports,
          feeSource: payment.refundFeeSource,
        }
        : await this.estimateRefundTransferAudit({
          recipientWallet: payment.walletAddress,
          grossLamports: payment.amountLamports,
        });
    } catch (error) {
      const failedClaim = await prisma.wagerPayment.updateMany({
        where: { id: payment.id, status: payment.status, updatedAt: payment.updatedAt },
        data: {
          status: 'refunding',
          refundReason: reason,
          refundGrossLamports: payment.amountLamports,
          refundOutboundFeeLamports: null,
          refundNetLamports: null,
          refundFeeSource: null,
          lastError: `${reason}:${error instanceof Error ? error.message : String(error)}`,
        },
      });
      if (failedClaim.count > 0) {
        await this.emitPaymentStatusChanged(payment.wageredLobby.lobbyId, payment.id);
      }
      throw error;
    }

    const claim = await prisma.wagerPayment.updateMany({
      where: { id: payment.id, status: payment.status, updatedAt: payment.updatedAt },
      data: {
        status: 'refunding',
        refundReason: reason,
        refundGrossLamports: audit.grossLamports,
        refundOutboundFeeLamports: audit.outboundFeeLamports,
        refundNetLamports: audit.netLamports,
        refundFeeSource: audit.feeSource,
        lastError: null,
      },
    });
    if (claim.count === 0) {
      loggers.room.debug('Wager refund claim lost to another worker', {
        paymentId: payment.id,
        lobbyId: payment.wageredLobby.lobbyId,
      });
      return;
    }
    await this.emitPaymentStatusChanged(payment.wageredLobby.lobbyId, payment.id);

    try {
      const result = await this.sendTreasuryTransfer({
        recipientWallet: payment.walletAddress,
        amountLamports: audit.netLamports,
        existingSignature: payment.refundSignature,
        onSubmitted: async (signature) => {
          await prisma.wagerPayment.update({
            where: { id: payment.id },
            data: { refundSignature: signature },
          });
        },
      });

      await prisma.wagerPayment.updateMany({
        where: { id: payment.id, status: 'refunding' },
        data: {
          status: 'refunded',
          refundSignature: result.signature,
          refundReason: reason,
          refundGrossLamports: audit.grossLamports,
          refundOutboundFeeLamports: audit.outboundFeeLamports,
          refundNetLamports: audit.netLamports,
          refundFeeSource: audit.feeSource,
          refundedAt: result.confirmedAt,
          lastError: null,
        },
      });
    } catch (error) {
      await prisma.wagerPayment.updateMany({
        where: { id: payment.id, status: 'refunding' },
        data: {
          status: 'refunding',
          lastError: `${reason}:${error instanceof Error ? error.message : String(error)}`,
        },
      });
      throw error;
    } finally {
      await this.emitPaymentStatusChanged(payment.wageredLobby.lobbyId, payment.id);
    }
  }

  private async prepareSettlement(settlementId: string): Promise<void> {
    const settlement = await prisma.wagerSettlement.findUnique({
      where: { id: settlementId },
      include: {
        wageredLobby: {
          include: {
            payments: true,
          },
        },
      },
    });
    if (!settlement) throw new Error('Settlement not found');
    if (settlement.status === 'complete') return;

    const lockedPayments = settlement.wageredLobby.payments.filter((payment) => (
      (payment.status === 'credited' || payment.status === 'settled')
      && isValidTeam(payment.teamAtLock)
    ));
    const totalPotLamports = lockedPayments.reduce((sum, payment) => sum + payment.amountLamports, 0n);
    const winningTeam = isValidTeam(settlement.winningTeam) ? settlement.winningTeam : null;
    const refundAudits = new Map<string, RefundTransferAudit>();
    if (!winningTeam) {
      for (const payment of lockedPayments) {
        refundAudits.set(payment.id, await this.estimateRefundTransferAudit({
          recipientWallet: payment.walletAddress,
          grossLamports: payment.amountLamports,
        }));
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.wagerSettlement.update({
        where: { id: settlement.id },
        data: {
          totalPotLamports,
          status: 'processing',
          attemptCount: { increment: 1 },
          lastError: null,
        },
      });

      if (!winningTeam) {
        for (const payment of lockedPayments) {
          const audit = refundAudits.get(payment.id);
          if (!audit) {
            throw new Error('Missing refund audit data for settlement refund');
          }
          await tx.wagerSettlementTransfer.upsert({
            where: {
              settlementId_kind_recipientWallet: {
                settlementId: settlement.id,
                kind: 'refund',
                recipientWallet: payment.walletAddress,
              },
            },
            create: {
              settlementId: settlement.id,
              idempotencyKey: `${settlement.id}:refund:${payment.userId}`,
              kind: 'refund',
              recipientWallet: payment.walletAddress,
              amountLamports: audit.netLamports,
              refundReason: 'settlement_refund',
              refundGrossLamports: audit.grossLamports,
              refundOutboundFeeLamports: audit.outboundFeeLamports,
              refundNetLamports: audit.netLamports,
              refundFeeSource: audit.feeSource,
              status: audit.netLamports > 0n ? 'pending' : 'confirmed',
              confirmedAt: audit.netLamports > 0n ? null : new Date(),
            },
            update: {
              amountLamports: audit.netLamports,
              refundReason: 'settlement_refund',
              refundGrossLamports: audit.grossLamports,
              refundOutboundFeeLamports: audit.outboundFeeLamports,
              refundNetLamports: audit.netLamports,
              refundFeeSource: audit.feeSource,
            },
          });
        }
        return;
      }

      const winners = lockedPayments.filter((payment) => payment.teamAtLock === winningTeam);
      if (winners.length === 0) {
        throw new Error('No paid winners found for settlement');
      }

      const payouts = calculateWagerPayouts(
        totalPotLamports,
        winners.length,
        settlement.wageredLobby.platformFeeBps
      );

      await tx.wagerSettlement.update({
        where: { id: settlement.id },
        data: {
          totalPotLamports: payouts.totalPotLamports,
          developerFeeLamports: payouts.developerTotalLamports,
          winnerPoolLamports: payouts.winnerPoolLamports,
        },
      });

      for (const winner of winners) {
        await tx.wagerSettlementTransfer.upsert({
          where: {
            settlementId_kind_recipientWallet: {
              settlementId: settlement.id,
              kind: 'winner_payout',
              recipientWallet: winner.walletAddress,
            },
          },
          create: {
            settlementId: settlement.id,
            idempotencyKey: `${settlement.id}:winner:${winner.userId}`,
            kind: 'winner_payout',
            recipientWallet: winner.walletAddress,
            amountLamports: payouts.winnerShareLamports,
            status: payouts.winnerShareLamports > 0n ? 'pending' : 'confirmed',
            confirmedAt: payouts.winnerShareLamports > 0n ? null : new Date(),
          },
          update: {
            amountLamports: payouts.winnerShareLamports,
          },
        });
      }

      await tx.wagerSettlementTransfer.upsert({
        where: {
          settlementId_kind_recipientWallet: {
            settlementId: settlement.id,
            kind: 'developer_fee',
            recipientWallet: settlement.wageredLobby.treasuryWallet,
          },
        },
        create: {
          settlementId: settlement.id,
          idempotencyKey: `${settlement.id}:developer:${settlement.wageredLobby.treasuryWallet}`,
          kind: 'developer_fee',
          recipientWallet: settlement.wageredLobby.treasuryWallet,
          amountLamports: payouts.developerTotalLamports,
          status: 'confirmed',
          confirmedAt: new Date(),
        },
        update: {
          amountLamports: payouts.developerTotalLamports,
          status: 'confirmed',
          confirmedAt: new Date(),
        },
      });
    });
  }

  private async processSettlement(settlementId: string): Promise<void> {
    try {
      await this.prepareSettlement(settlementId);
      const settlement = await prisma.wagerSettlement.findUniqueOrThrow({
        where: { id: settlementId },
        include: {
          transfers: true,
          wageredLobby: {
            include: { payments: true },
          },
        },
      });

      for (const transfer of settlement.transfers) {
        if (transfer.status === 'confirmed') continue;
        if (transfer.amountLamports <= 0n) {
          await prisma.wagerSettlementTransfer.updateMany({
            where: { id: transfer.id, status: transfer.status, updatedAt: transfer.updatedAt },
            data: { status: 'confirmed', confirmedAt: new Date(), lastError: null },
          });
          continue;
        }
        if (
          transfer.status === 'submitted'
          && !transfer.signature
          && transfer.updatedAt.getTime() > Date.now() - WAGER_TRANSFER_RETRY_GRACE_MS
        ) {
          loggers.room.debug('Skipping recently claimed wager settlement transfer', {
            settlementId,
            transferId: transfer.id,
            kind: transfer.kind,
          });
          continue;
        }

        const claim = await prisma.wagerSettlementTransfer.updateMany({
          where: { id: transfer.id, status: transfer.status, updatedAt: transfer.updatedAt },
          data: { status: 'submitted', lastError: null },
        });
        if (claim.count === 0) {
          loggers.room.debug('Wager settlement transfer claim lost to another worker', {
            settlementId,
            transferId: transfer.id,
            kind: transfer.kind,
          });
          continue;
        }

        try {
          const result = await this.sendTreasuryTransfer({
            recipientWallet: transfer.recipientWallet,
            amountLamports: transfer.amountLamports,
            existingSignature: transfer.signature,
            onSubmitted: async (signature) => {
              await prisma.wagerSettlementTransfer.update({
                where: { id: transfer.id },
                data: { signature, status: 'submitted', lastError: null },
              });
            },
          });

          await prisma.wagerSettlementTransfer.updateMany({
            where: { id: transfer.id, status: 'submitted' },
            data: {
              signature: result.signature,
              status: 'confirmed',
              confirmedAt: result.confirmedAt,
              lastError: null,
            },
          });
        } catch (error) {
          await prisma.wagerSettlementTransfer.updateMany({
            where: { id: transfer.id, status: 'submitted' },
            data: {
              status: 'failed',
              lastError: error instanceof Error ? error.message : String(error),
            },
          }).catch(() => undefined);
          throw error;
        }
      }

      await this.completeSettlement(settlementId);
    } catch (error) {
      await prisma.wagerSettlement.update({
        where: { id: settlementId },
        data: {
          status: 'failed',
          lastError: error instanceof Error ? error.message : String(error),
        },
      }).catch(() => undefined);
      throw error;
    }
  }

  private async completeSettlement(settlementId: string): Promise<void> {
    const settlement = await prisma.wagerSettlement.findUniqueOrThrow({
      where: { id: settlementId },
      include: {
        transfers: true,
        wageredLobby: {
          include: { payments: true },
        },
      },
    });

    if (settlement.status === 'complete') return;
    if (settlement.transfers.some((transfer) => transfer.status !== 'confirmed')) return;

    const now = new Date();
    const isRefundSettlement = !isValidTeam(settlement.winningTeam);
    const refundTransferByWallet = new Map(
      settlement.transfers
        .filter((transfer) => transfer.kind === 'refund')
        .map((transfer) => [transfer.recipientWallet, transfer])
    );
    const userStatIncrements = buildWagerUserStatIncrements({
      payments: settlement.wageredLobby.payments,
      transfers: settlement.transfers,
      winningTeam: settlement.winningTeam,
    });

    await prisma.$transaction(async (tx) => {
      for (const payment of settlement.wageredLobby.payments) {
        if (payment.status !== 'credited' && payment.status !== 'settled') continue;
        const refundTransfer = refundTransferByWallet.get(payment.walletAddress);
        await tx.wagerPayment.update({
          where: { id: payment.id },
          data: isRefundSettlement
            ? {
              status: 'refunded',
              refundSignature: refundTransfer?.signature ?? payment.refundSignature,
              refundReason: refundTransfer?.refundReason ?? 'settlement_refund',
              refundGrossLamports: refundTransfer?.refundGrossLamports ?? payment.amountLamports,
              refundOutboundFeeLamports: refundTransfer?.refundOutboundFeeLamports ?? null,
              refundNetLamports: refundTransfer?.refundNetLamports ?? refundTransfer?.amountLamports ?? null,
              refundFeeSource: refundTransfer?.refundFeeSource ?? null,
              refundedAt: now,
            }
            : { status: 'settled', settledAt: now },
        });
      }

      for (const increment of userStatIncrements) {
        await tx.user.update({
          where: { id: increment.userId },
          data: increment.data,
        });
      }

      await tx.wagerSettlement.update({
        where: { id: settlement.id },
        data: {
          status: 'complete',
          completedAt: now,
          lastError: null,
        },
      });

      await tx.wageredLobby.update({
        where: { id: settlement.wageredLobbyId },
        data: {
          status: isRefundSettlement ? 'refunded' : 'settled',
          settledAt: now,
        },
      });
    });
  }

  private async sendTreasuryTransfer(input: {
    recipientWallet: string;
    amountLamports: bigint;
    existingSignature?: string | null;
    onSubmitted: (signature: string) => Promise<void>;
  }): Promise<TreasuryTransferResult> {
    if (input.amountLamports <= 0n) {
      return { signature: null, confirmedAt: new Date() };
    }
    assertPublicKey(input.recipientWallet, 'recipientWallet');
    const config = this.getConfig();
    assertWagerPaymentsConfigured(config);

    if (input.recipientWallet === config.treasuryWallet) {
      return { signature: null, confirmedAt: new Date() };
    }
    if (!isSafeLamportNumber(input.amountLamports)) {
      throw new Error('Transfer amount exceeds safe lamport range');
    }

    const signer = getSettlementKeypair();
    if (!signer) {
      throw new Error('WAGER_SETTLEMENT_SECRET_KEY is required for payouts and refunds');
    }
    if (signer.publicKey.toBase58() !== config.treasuryWallet) {
      throw new Error('Settlement signer public key must match WAGER_TREASURY_WALLET');
    }

    const connection = this.getConnection();
    if (input.existingSignature) {
      const existing = await connection.getSignatureStatuses([input.existingSignature], { searchTransactionHistory: true });
      const status = existing.value[0];
      if (status?.err) {
        loggers.room.warn('Existing wager transfer signature failed; sending replacement', input.existingSignature);
      } else if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        return { signature: input.existingSignature, confirmedAt: new Date() };
      } else if (status) {
        throw new Error(`Transfer ${input.existingSignature} is still ${status.confirmationStatus ?? 'pending'}`);
      } else {
        throw new Error(`Transfer ${input.existingSignature} has unknown status; manual review required before replacement`);
      }
    }

    const latest = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({
      feePayer: signer.publicKey,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }).add(SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: new PublicKey(input.recipientWallet),
      lamports: Number(input.amountLamports),
    }));
    transaction.sign(signer);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    await input.onSubmitted(signature);

    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }, 'confirmed');
    if (confirmation.value.err) {
      throw new Error(`Transfer ${signature} failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    return { signature, confirmedAt: new Date() };
  }

  private async expireOldIntents(): Promise<void> {
    const expired = await prisma.wagerPayment.findMany({
      where: {
        status: 'intent_created',
        intentExpiresAt: { lt: new Date() },
      },
      select: { id: true, wageredLobby: { select: { lobbyId: true } } },
      take: 100,
    });
    if (expired.length === 0) return;

    await prisma.wagerPayment.updateMany({
      where: { id: { in: expired.map((payment) => payment.id) } },
      data: { status: 'expired', lastError: 'intent_expired' },
    });

    for (const payment of expired) {
      await this.emitPaymentStatusChanged(payment.wageredLobby.lobbyId, payment.id);
    }
  }

  private async confirmSubmittedDeposits(): Promise<void> {
    const submitted = await prisma.wagerPayment.findMany({
      where: { status: 'submitted', depositSignature: { not: null } },
      select: { id: true },
      take: 50,
    });
    for (const payment of submitted) {
      await this.verifySubmittedPayment(payment.id, { keepSubmittedWhenNotFound: true }).catch((error) => {
        loggers.room.warn('Failed to confirm wager deposit', payment.id, error);
      });
    }
  }

  private async retryFailedRefunds(): Promise<void> {
    const refunding = await prisma.wagerPayment.findMany({
      where: { status: 'refunding' },
      select: { id: true },
      take: 25,
    });
    for (const payment of refunding) {
      await this.refundSinglePayment(payment.id, 'retry').catch((error) => {
        loggers.room.warn('Failed to retry wager refund', payment.id, error);
      });
    }
  }

  private async retrySettlements(): Promise<void> {
    const config = this.getConfig();
    const settlements = await prisma.wagerSettlement.findMany({
      where: {
        status: { in: ['pending', 'failed', 'processing'] },
        attemptCount: { lt: config.settlementMaxAttempts },
        updatedAt: { lt: new Date(Date.now() - config.settlementRetryMs) },
      },
      select: { id: true },
      take: 10,
    });
    for (const settlement of settlements) {
      await this.processSettlement(settlement.id).catch((error) => {
        loggers.room.warn('Failed to retry wager settlement', settlement.id, error);
      });
    }
  }

  private async reconcileRecentTreasuryDeposits(): Promise<void> {
    const config = this.getConfig();
    if (!config.enabled || !config.rpcUrl || !config.treasuryWallet) return;

    const connection = this.getConnection();
    const signatures = await connection.getSignaturesForAddress(new PublicKey(config.treasuryWallet), { limit: 50 });
    for (const signatureInfo of signatures) {
      const existing = await prisma.wagerPayment.findUnique({
        where: { depositSignature: signatureInfo.signature },
        select: { id: true },
      });
      if (existing) continue;

      const transaction = await connection.getParsedTransaction(signatureInfo.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      const memo = findWagerMemoInParsedTransaction(transaction);
      if (!memo) continue;

      const intentId = memo.slice(createWagerMemo('').length);
      const payment = await prisma.wagerPayment.findUnique({ where: { id: intentId } });
      if (!payment) {
        loggers.room.warn('Found unmatched wager deposit memo', {
          signature: signatureInfo.signature,
          memo,
        });
        continue;
      }

      await prisma.wagerPayment.update({
        where: { id: payment.id },
        data: {
          depositSignature: signatureInfo.signature,
          status: 'submitted',
        },
      });
      await this.verifySubmittedPayment(payment.id, { keepSubmittedWhenNotFound: true });
    }
  }

  private async checkTreasuryBalance(): Promise<void> {
    const config = this.getConfig();
    if (!config.enabled || !config.rpcUrl || !config.treasuryWallet) return;
    const balance = BigInt(await this.getConnection().getBalance(new PublicKey(config.treasuryWallet), 'confirmed'));
    if (balance < config.treasuryLowBalanceLamports) {
      loggers.room.warn('Wager treasury balance is low', {
        treasuryWallet: config.treasuryWallet,
        balanceLamports: balance.toString(),
        thresholdLamports: config.treasuryLowBalanceLamports.toString(),
      });
    }
  }
}

export const wagerService = new WagerService();
