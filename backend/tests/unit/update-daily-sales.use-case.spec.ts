import { beforeEach, describe, expect, it } from 'vitest';
import { UpdateDailySalesUseCase } from '../../src/core/application/use-cases/sales/manage-daily-sales.use-case.js';
import { DailySalesEntry } from '../../src/core/domain/entities/daily-sales-entry.entity.js';
import { SalesChannel, SalesPaymentMode } from '../../src/core/domain/enums/sales.enum.js';
import { BusinessRuleError } from '../../src/core/domain/errors/domain-error.js';
import type {
  DailySalesLineData,
  IDailySalesRepository,
} from '../../src/core/domain/repositories/daily-sales.repository.js';
import { FakeAuditLogRepository, fakeLogger } from './fakes.js';

/**
 * Completing a day versus correcting one.
 *
 * The rule these lock down: a reason is required when a figure that was **already recorded**
 * changes, and not when a bucket that was empty is filled in. That distinction is the whole point —
 * the shop records the counter total at close and adds Zomato later once the platform settles, and
 * demanding "why is this changing?" for the second half of a normal evening trains people to type a
 * character to get past the prompt, which is worse for the audit trail than not asking.
 *
 * Worth stating because it is the non-obvious case: **a reduction is a correction**, even to zero.
 * "Zomato was 1,240 and is now nothing" is a claim about a figure somebody already committed to.
 */

const ENTRY_ID = 'entry-1';
const ACTOR = 'user-1';

function line(
  channel: SalesChannel,
  paymentMode: SalesPaymentMode,
  amount: number,
): DailySalesLineData {
  return { channel, paymentMode, amount };
}

const WALK_IN_CASH = (amount: number) => line(SalesChannel.WALK_IN, SalesPaymentMode.CASH, amount);
const WALK_IN_ONLINE = (amount: number) =>
  line(SalesChannel.WALK_IN, SalesPaymentMode.ONLINE, amount);
const ZOMATO = (amount: number) => line(SalesChannel.ZOMATO, SalesPaymentMode.ONLINE, amount);

/** A day holding only the two walk-in buckets — the state right after a close-of-day entry. */
function storedEntry(lines: readonly DailySalesLineData[]): DailySalesEntry {
  return DailySalesEntry.fromPersistence({
    id: ENTRY_ID,
    entryDate: new Date('2026-07-25T00:00:00.000Z'),
    totalAmount: lines.reduce((sum, l) => sum + l.amount, 0),
    notes: null,
    revision: 1,
    recordedById: ACTOR,
    recordedByName: 'Paris Admin',
    createdAt: new Date('2026-07-25T18:00:00.000Z'),
    updatedAt: new Date('2026-07-25T18:00:00.000Z'),
    deletedAt: null,
    lines: lines.map((l, index) => ({
      id: `line-${String(index)}`,
      channel: l.channel,
      paymentMode: l.paymentMode,
      amount: l.amount,
    })),
    revisions: [],
  });
}

/** Records what `update` was called with, so the auto-written revision note can be asserted. */
class RecordingSalesRepository implements Partial<IDailySalesRepository> {
  lastNote: string | undefined;

  constructor(private readonly stored: DailySalesEntry) {}

  findById(): Promise<DailySalesEntry | null> {
    return Promise.resolve(this.stored);
  }

  update(
    _id: string,
    data: { readonly lines: readonly DailySalesLineData[]; readonly note?: string | undefined },
  ): Promise<DailySalesEntry> {
    this.lastNote = data.note;

    return Promise.resolve(storedEntry(data.lines));
  }
}

describe('UpdateDailySalesUseCase — completing versus correcting', () => {
  let repository: RecordingSalesRepository;
  let audit: FakeAuditLogRepository;
  let useCase: UpdateDailySalesUseCase;

  const build = (stored: readonly DailySalesLineData[]): void => {
    repository = new RecordingSalesRepository(storedEntry(stored));
    audit = new FakeAuditLogRepository();
    useCase = new UpdateDailySalesUseCase(
      repository as unknown as IDailySalesRepository,
      audit,
      fakeLogger,
    );
  };

  const run = (amounts: readonly DailySalesLineData[], reason?: string) =>
    useCase.execute({
      id: ENTRY_ID,
      actorId: ACTOR,
      amounts,
      ...(reason === undefined ? {} : { reason }),
      ipAddress: '203.0.113.10',
    });

  beforeEach(() => {
    build([WALK_IN_CASH(400), WALK_IN_ONLINE(1617)]);
  });

  it('adds an aggregator with no reason, because nothing recorded is changing', async () => {
    const entry = await run([WALK_IN_CASH(400), WALK_IN_ONLINE(1617), ZOMATO(1240)]);

    expect(entry.totalAmount).toBe(3257);
  });

  it('writes its own revision note when completing, so the trail is never blank', async () => {
    await run([WALK_IN_CASH(400), WALK_IN_ONLINE(1617), ZOMATO(1240)]);

    expect(repository.lastNote).toBe('Added Zomato');
  });

  it('refuses to change a recorded figure without a reason', async () => {
    await expect(run([WALK_IN_CASH(450), WALK_IN_ONLINE(1617)])).rejects.toThrow(BusinessRuleError);
  });

  it('accepts the same change once a reason is given, and keeps the reason as the note', async () => {
    const entry = await run([WALK_IN_CASH(450), WALK_IN_ONLINE(1617)], 'Drawer recount, 50 short');

    expect(entry.totalAmount).toBe(2067);
    expect(repository.lastNote).toBe('Drawer recount, 50 short');
  });

  it('treats clearing a bucket back to zero as a correction, not a completion', async () => {
    build([WALK_IN_CASH(400), WALK_IN_ONLINE(1617), ZOMATO(1240)]);

    /*
     * Zomato is *absent* from the payload rather than sent as zero, which is how the form submits a
     * cleared bucket. Classifying only the submitted lines would miss this entirely and let a 1,240
     * reduction through unexplained — the case the union of both sides exists for.
     */
    await expect(run([WALK_IN_CASH(400), WALK_IN_ONLINE(1617)])).rejects.toThrow(BusinessRuleError);
  });

  it('still requires a reason when a reason is only whitespace', async () => {
    await expect(run([WALK_IN_CASH(450), WALK_IN_ONLINE(1617)], '   ')).rejects.toThrow(
      BusinessRuleError,
    );
  });

  it('allows filling one bucket while leaving the recorded ones alone', async () => {
    build([WALK_IN_CASH(400)]);

    const entry = await run([WALK_IN_CASH(400), WALK_IN_ONLINE(1617), ZOMATO(1240)]);

    expect(entry.totalAmount).toBe(3257);
    expect(repository.lastNote).toBe('Added Walk-in, Zomato');
  });

  it('records which kind of change it was on the audit entry', async () => {
    await run([WALK_IN_CASH(400), WALK_IN_ONLINE(1617), ZOMATO(1240)]);

    const [logged] = audit.entries;

    expect(logged?.metadata).toMatchObject({ change: 'completing' });
  });
});
