import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type {
  Purchase,
  PurchaseInvoiceFileProps,
} from '../../../core/domain/entities/purchase.entity.js';
import { InventoryHistoryAction } from '../../../core/domain/enums/inventory.enum.js';
import { ConflictError, NotFoundError } from '../../../core/domain/errors/domain-error.js';
import type {
  CreatePurchaseData,
  IPurchaseRepository,
  PurchaseFilter,
  PurchaseSort,
  PurchaseStockEffect,
  PurchaseSummary,
} from '../../../core/domain/repositories/purchase.repository.js';
import { InventoryQuantity } from '../../../core/domain/value-objects/inventory-quantity.js';
import { createPage, toSkipTake, type Page, type PageRequest } from '../../../shared/pagination.js';
import { decimalToNumber } from '../mappers/inventory-item.prisma-mapper.js';
import { PURCHASE_INCLUDE, PurchasePrismaMapper } from '../mappers/purchase.prisma-mapper.js';

/** Row shape from the locking query in `create`. */
interface LockedItemRow {
  readonly id: string;
  readonly name: string;
  readonly current_quantity: string | number;
}

const UNIQUE_VIOLATION = 'P2002';

/**
 * Raised from Prisma's defaults for the same reason the transfer repository does: this
 * transaction locks one row per line, and a second purchase touching an overlapping item
 * legitimately queues behind it.
 */
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

export class PurchasePrismaRepository implements IPurchaseRepository {
  constructor(private readonly client: PrismaClient) {}

  async findById(id: string): Promise<Purchase | null> {
    const row = await this.client.purchase.findUnique({
      where: { id },
      include: PURCHASE_INCLUDE,
    });

    return row === null ? null : PurchasePrismaMapper.toDomain(row);
  }

  async findMany(
    filter: PurchaseFilter,
    page: PageRequest,
    sort: PurchaseSort,
  ): Promise<Page<Purchase>> {
    const where = this.buildWhere(filter);
    const { skip, take } = toSkipTake(page);

    const [rows, total] = await this.client.$transaction([
      this.client.purchase.findMany({
        where,
        skip,
        take,
        orderBy: this.buildOrderBy(sort),
        include: PURCHASE_INCLUDE,
      }),
      this.client.purchase.count({ where }),
    ]);

    return createPage(PurchasePrismaMapper.toDomainList(rows), total, page);
  }

  async summary(filter: PurchaseFilter): Promise<PurchaseSummary> {
    const where = this.buildWhere(filter);

    const [aggregate, missingInvoiceFiles] = await this.client.$transaction([
      this.client.purchase.aggregate({
        where,
        _count: true,
        _sum: { totalAmount: true, totalTax: true },
      }),
      this.client.purchase.count({ where: { ...where, invoiceStoredName: null } }),
    ]);

    return {
      purchaseCount: aggregate._count,
      // `_sum` is null when nothing matched — zero is the honest answer, not null.
      totalValue: decimalToNumber(aggregate._sum.totalAmount ?? 0),
      totalTax: decimalToNumber(aggregate._sum.totalTax ?? 0),
      missingInvoiceFiles,
    };
  }

  async existsByInvoiceNumber(supplierId: string, invoiceNumber: string): Promise<boolean> {
    const count = await this.client.purchase.count({ where: { supplierId, invoiceNumber } });
    return count > 0;
  }

  /**
   * Records the invoice and adds its stock in one transaction.
   *
   * The sequence, and why each step is where it is:
   *
   * 1. **Lock every affected item row with `SELECT … FOR UPDATE`, ordered by id.** A
   *    consistent lock order is what stops two purchases touching overlapping items in
   *    different orders from deadlocking. Locking is what stops a concurrent purchase or
   *    stock adjustment from reading the same "before" value and losing one of the two
   *    increases — the classic read-modify-write race, which on stock means silently
   *    missing inventory.
   * 2. **Increase each item and write its history inside the same transaction**, so a
   *    rollback cannot leave the quantity and its audit trail disagreeing.
   * 3. **Create the purchase and its lines last.** If anything above failed, no invoice
   *    exists to explain stock that never moved.
   */
  async create(data: CreatePurchaseData): Promise<{
    purchase: Purchase;
    effects: readonly PurchaseStockEffect[];
  }> {
    try {
      return await this.client.$transaction(async (tx) => {
        /*
         * New items first, inside this transaction, so a failure below rolls them back
         * with everything else. Created at zero quantity — the stock increase below is
         * what fills them, and seeding the quantity here would double-count.
         *
         * The CREATED history entry matches what the manual create path writes, so an
         * item born from a purchase has the same opening record as any other.
         */
        const resolvedIds = new Map<number, string>();

        for (const [index, line] of data.lines.entries()) {
          if (line.target.kind === 'existing') {
            resolvedIds.set(index, line.target.itemId);
            continue;
          }

          const created = await tx.inventoryItem.create({
            data: {
              name: line.itemName,
              category: line.category,
              unit: line.unit,
              location: 'HOME_WAREHOUSE',
              currentQuantity: 0,
              minimumQuantity: line.target.minimumQuantity,
              status: 'ACTIVE',
              createdById: data.recordedById,
            },
          });

          await tx.inventoryItemHistory.create({
            data: {
              itemId: created.id,
              action: InventoryHistoryAction.CREATED,
              quantityBefore: null,
              quantityAfter: 0,
              note: `Added while recording purchase ${data.invoiceNumber}`,
              actorId: data.recordedById,
            },
          });

          resolvedIds.set(index, created.id);
        }

        const lineItemIds = data.lines.map((_line, index) => {
          const id = resolvedIds.get(index);

          if (id === undefined) {
            throw new NotFoundError('Inventory item', `line ${index}`);
          }

          return id;
        });

        const itemIds = [...new Set(lineItemIds)].sort();

        const locked = await tx.$queryRaw<LockedItemRow[]>`
          SELECT id::text AS id, name, current_quantity
          FROM inventory_items
          WHERE id = ANY(${itemIds}::uuid[]) AND deleted_at IS NULL
          ORDER BY id
          FOR UPDATE
        `;

        const current = new Map(
          locked.map((row) => [
            row.id,
            { name: row.name, quantity: decimalToNumber(row.current_quantity) },
          ]),
        );

        const effects: PurchaseStockEffect[] = [];

        for (const [index, line] of data.lines.entries()) {
          const itemId = lineItemIds[index] ?? '';
          const item = current.get(itemId);

          /*
           * Only reachable if the item was deleted between the use case resolving it and
           * this lock — a genuine race rather than bad input, so it fails the whole
           * purchase rather than skipping the line. A half-recorded invoice would be
           * worse than none.
           */
          if (item === undefined) {
            throw new NotFoundError('Inventory item', itemId);
          }

          // Routed through the domain so the unit rules and rounding match every other
          // path that changes a quantity.
          const nextQuantity = InventoryQuantity.applyDelta(item.quantity, line.quantity, line.unit);

          /*
           * The purchase also refreshes what the item costs.
           *
           * `purchasePrice` is "latest known cost", and an invoice is the most
           * authoritative statement of that there is — leaving it for someone to type in
           * by hand means the stock valuation stays at zero for items the business demonstrably
           * bought. Latest cost rather than a weighted average: the average would need every
           * historical receipt weighted by quantity remaining, which is a costing method to
           * choose deliberately, not to arrive at by accident.
           *
           * The scales match exactly — `unitRate` and `purchasePrice` are both
           * `Decimal(14, 4)` — so nothing rounds on the way across.
           */
          await tx.inventoryItem.update({
            where: { id: itemId },
            data: { currentQuantity: nextQuantity, purchasePrice: line.unitRate },
          });

          await tx.inventoryItemHistory.create({
            data: {
              itemId,
              action: InventoryHistoryAction.PURCHASED,
              quantityBefore: item.quantity,
              quantityAfter: nextQuantity,
              note: `Purchase ${data.invoiceNumber}`,
              actorId: data.recordedById,
            },
          });

          effects.push({
            itemId,
            itemName: line.itemName,
            unit: line.unit,
            quantityBefore: item.quantity,
            quantityAfter: nextQuantity,
          });
        }

        const created = await tx.purchase.create({
          data: {
            invoiceNumber: data.invoiceNumber,
            invoiceDate: data.invoiceDate,
            supplierId: data.supplierId,
            supplierGstin: data.supplierGstin,
            supplierStateCode: data.supplierStateCode,
            gstTreatment: data.gstTreatment,
            subtotal: data.subtotal,
            totalCgst: data.totalCgst,
            totalSgst: data.totalSgst,
            totalIgst: data.totalIgst,
            totalTax: data.totalTax,
            totalAmount: data.totalAmount,
            notes: data.notes ?? null,
            recordedById: data.recordedById,
            lines: {
              create: data.lines.map((line, index) => ({
                itemId: lineItemIds[index] ?? '',
                itemName: line.itemName,
                unit: line.unit,
                category: line.category,
                quantity: line.quantity,
                unitRate: line.unitRate,
                hsnCode: line.hsnCode ?? null,
                gstRatePercent: line.gstRatePercent,
                taxableAmount: line.taxableAmount,
                cgstAmount: line.cgstAmount,
                sgstAmount: line.sgstAmount,
                igstAmount: line.igstAmount,
                lineTotal: line.lineTotal,
              })),
            },
          },
          include: PURCHASE_INCLUDE,
        });

        return { purchase: PurchasePrismaMapper.toDomain(created), effects };
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      /*
       * The unique index on (supplier, invoice number) is the real duplicate guard — the
       * use case's pre-check is only there for a better message, and two concurrent
       * requests can both pass it. Reaching here means the second one lost the race, and
       * its whole transaction has rolled back, so no stock was double-counted.
       */
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new ConflictError(
          `Invoice ${data.invoiceNumber} has already been recorded for this supplier.`,
        );
      }

      throw error;
    }
  }

  async attachInvoiceFile(id: string, file: PurchaseInvoiceFileProps): Promise<string | null> {
    return this.client.$transaction(async (tx) => {
      /*
       * Locked so two uploads racing cannot both read "no previous file" and leave one
       * set of bytes orphaned on disk with nothing referencing it.
       */
      const rows = await tx.$queryRaw<{ invoice_stored_name: string | null }[]>`
        SELECT invoice_stored_name FROM purchases WHERE id = ${id}::uuid FOR UPDATE
      `;

      const existing = rows[0];

      if (existing === undefined) {
        throw new NotFoundError('Purchase', id);
      }

      await tx.purchase.update({
        where: { id },
        data: {
          invoiceFileName: file.fileName,
          invoiceStoredName: file.storedName,
          invoiceMimeType: file.mimeType,
          invoiceSizeBytes: file.sizeBytes,
          invoiceChecksum: file.checksum,
          invoiceUploadedAt: file.uploadedAt,
        },
      });

      // Read before the update, which is the only moment it is still available.
      return existing.invoice_stored_name;
    }, TRANSACTION_OPTIONS);
  }

  private buildWhere(filter: PurchaseFilter): Prisma.PurchaseWhereInput {
    const where: Prisma.PurchaseWhereInput = {};

    if (filter.supplierId !== undefined) {
      where.supplierId = filter.supplierId;
    }

    if (filter.gstTreatment !== undefined) {
      where.gstTreatment = filter.gstTreatment;
    }

    if (filter.hasInvoiceFile !== undefined) {
      where.invoiceStoredName = filter.hasInvoiceFile ? { not: null } : null;
    }

    if (filter.fromDate !== undefined || filter.toDate !== undefined) {
      where.invoiceDate = {
        ...(filter.fromDate !== undefined && { gte: filter.fromDate }),
        ...(filter.toDate !== undefined && { lte: filter.toDate }),
      };
    }

    if (filter.search !== undefined && filter.search.length > 0) {
      // Invoice number and supplier name are the two things anyone searches purchase
      // history by — "that bill from Metro" or "INV-4471".
      where.OR = [
        { invoiceNumber: { contains: filter.search, mode: 'insensitive' } },
        { supplier: { name: { contains: filter.search, mode: 'insensitive' } } },
      ];
    }

    return where;
  }

  private buildOrderBy(sort: PurchaseSort): Prisma.PurchaseOrderByWithRelationInput[] {
    // Supplier name is a relation, not a column, so it needs the nested form.
    const primary: Prisma.PurchaseOrderByWithRelationInput =
      sort.field === 'supplierName'
        ? { supplier: { name: sort.direction } }
        : { [sort.field]: sort.direction };

    // `id` as a tiebreaker: without a deterministic total order, two invoices on the same
    // date can swap between pages and one of them is never shown.
    return [primary, { id: 'asc' }];
  }
}
