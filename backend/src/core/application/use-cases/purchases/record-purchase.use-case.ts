import { InventoryLocation } from '../../../domain/enums/inventory.enum.js';
import { resolveGstTreatment } from '../../../domain/enums/purchase.enum.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../../domain/errors/domain-error.js';
import type { IAuditLogRepository } from '../../../domain/repositories/audit-log.repository.js';
import type { IInventoryItemRepository } from '../../../domain/repositories/inventory-item.repository.js';
import type {
  CreatePurchaseLineData,
  IPurchaseRepository,
} from '../../../domain/repositories/purchase.repository.js';
import type { ISupplierRepository } from '../../../domain/repositories/supplier.repository.js';
import { Gst } from '../../../domain/value-objects/gst.js';
import { InventoryQuantity } from '../../../domain/value-objects/inventory-quantity.js';
import { Money } from '../../../domain/value-objects/money.js';
import type {
  CreatePurchaseInput,
  CreatePurchaseLineInput,
  PurchaseResultDto,
} from '../../dtos/purchase.dto.js';
import { PurchaseMapper } from '../../mappers/purchase.mapper.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';
import { PurchaseAuditAction } from './purchase-audit.js';
import type { PurchaseNotifier } from './purchase-notifier.js';

/** Purchased stock always lands at the base store, which is where transfers draw from. */
const DESTINATION = InventoryLocation.HOME_WAREHOUSE;

/**
 * Records a supplier invoice and adds its stock.
 *
 * The order here matters and is not arbitrary:
 *
 * 1. **Resolve the supplier and the tax treatment.** The treatment is computed once, from
 *    the supplier's state versus the business's, and then applies to every line — an
 *    invoice cannot be part intra-state and part inter-state.
 * 2. **Resolve every line to an inventory item**, creating one where the user supplied
 *    details for something new. Done before any money is touched so a bad line fails
 *    before half an invoice exists.
 * 3. **Price the lines** through `Gst`, which owns the rounding.
 * 4. **Write the purchase and move the stock in one transaction**, in the repository.
 *
 * Nothing is validated against "expected" totals from the client. The server computes the
 * arithmetic and the client displays it; accepting a submitted total and checking it would
 * make the client's rounding authoritative on disagreement, which is exactly backwards.
 */
export class RecordPurchaseUseCase implements IUseCase<CreatePurchaseInput, PurchaseResultDto> {
  constructor(
    private readonly purchases: IPurchaseRepository,
    private readonly suppliers: ISupplierRepository,
    private readonly items: IInventoryItemRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly businessStateCode: string,
    private readonly logger: ILogger,
    private readonly notifier: PurchaseNotifier,
  ) {}

  async execute(input: CreatePurchaseInput): Promise<PurchaseResultDto> {
    if (input.lines.length === 0) {
      throw new BusinessRuleError('An invoice needs at least one line.', {
        lines: ['Add at least one item.'],
      });
    }

    const invoiceNumber = input.invoiceNumber.trim();

    if (invoiceNumber.length === 0) {
      throw new BusinessRuleError('An invoice number is required.', {
        invoiceNumber: ['Enter the supplier’s invoice number.'],
      });
    }

    /*
     * A future invoice date is almost always a typo in the year, and it silently corrupts
     * every date-ranged purchase report. Compared against the end of today rather than
     * now, so an invoice dated "today" is never rejected because of a timezone offset.
     */
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    if (input.invoiceDate.getTime() > endOfToday.getTime()) {
      throw new BusinessRuleError('An invoice cannot be dated in the future.', {
        invoiceDate: ['Enter a date on or before today.'],
      });
    }

    const supplier = await this.suppliers.findById(input.supplierId);

    if (supplier === null || supplier.isDeleted) {
      throw new NotFoundError('Supplier', input.supplierId);
    }

    if (!supplier.canBePurchasedFrom) {
      throw new BusinessRuleError(`"${supplier.name}" is inactive and cannot be purchased from.`, {
        supplierId: ['This supplier is no longer active.'],
      });
    }

    /*
     * Checked before doing any work, purely for the error message: the unique index on
     * (supplier, invoice number) is the real guard, and it is what holds if two requests
     * race. Without this pre-check the user would see a raw constraint violation instead
     * of "you have already recorded this bill" — which is the single most likely mistake
     * here, and the one that would otherwise double-count stock.
     */
    if (await this.purchases.existsByInvoiceNumber(supplier.id, invoiceNumber)) {
      throw new ConflictError(
        `Invoice ${invoiceNumber} from ${supplier.name} has already been recorded.`,
      );
    }

    const treatment = resolveGstTreatment(
      supplier.gstin,
      supplier.stateCode,
      this.businessStateCode,
    );

    const lines = await this.resolveLines(input.lines, treatment);
    const totals = Gst.totals(
      lines.map((line) => ({
        taxableAmount: line.taxableAmount,
        cgstAmount: line.cgstAmount,
        sgstAmount: line.sgstAmount,
        igstAmount: line.igstAmount,
        taxAmount: Money.sum([line.cgstAmount, line.sgstAmount, line.igstAmount]),
        lineTotal: line.lineTotal,
      })),
    );

    const { purchase, effects } = await this.purchases.create({
      invoiceNumber,
      invoiceDate: input.invoiceDate,
      supplierId: supplier.id,
      supplierGstin: supplier.gstin,
      supplierStateCode: supplier.stateCode,
      gstTreatment: treatment,
      subtotal: totals.subtotal,
      totalCgst: totals.totalCgst,
      totalSgst: totals.totalSgst,
      totalIgst: totals.totalIgst,
      totalTax: totals.totalTax,
      totalAmount: totals.totalAmount,
      notes: input.notes?.trim(),
      recordedById: input.actorId,
      lines,
    });

    await this.auditLog.record({
      actorId: input.actorId,
      action: PurchaseAuditAction.RECORDED,
      entityType: 'Purchase',
      entityId: purchase.id,
      ip: input.ipAddress,
      metadata: {
        invoiceNumber: purchase.invoiceNumber,
        supplier: supplier.name,
        gstTreatment: treatment,
        totalAmount: totals.totalAmount,
        // The before/after per item, so the audit entry alone explains what stock moved.
        effects: effects.map((effect) => ({
          item: effect.itemName,
          from: effect.quantityBefore,
          to: effect.quantityAfter,
        })),
      },
    });

    // After the audit entry and outside any transaction: the invoice is already
    // committed, and `purchaseRecorded` swallows its own failures so a bell that cannot
    // be written can never turn a recorded bill into an error.
    await this.notifier.purchaseRecorded({
      purchaseId: purchase.id,
      invoiceNumber: purchase.invoiceNumber,
      supplierName: supplier.name,
      totalAmount: totals.totalAmount,
      lineCount: lines.length,
      actorId: input.actorId,
    });

    this.logger.info('Purchase recorded', {
      purchaseId: purchase.id,
      invoiceNumber: purchase.invoiceNumber,
      supplierId: supplier.id,
      lineCount: lines.length,
      totalAmount: totals.totalAmount,
      actorId: input.actorId,
    });

    return { purchase: PurchaseMapper.toDto(purchase), effects };
  }

  /**
   * Turns submitted lines into priced, item-linked lines.
   *
   * Sequential rather than `Promise.all`, deliberately. Creating items concurrently would
   * let two lines for the same new ingredient both miss the duplicate check and race the
   * unique index — and the duplicate scan below only works against a list built in order.
   */
  private async resolveLines(
    inputs: readonly CreatePurchaseLineInput[],
    treatment: ReturnType<typeof resolveGstTreatment>,
  ): Promise<CreatePurchaseLineData[]> {
    const lines: CreatePurchaseLineData[] = [];
    const seenItemIds = new Set<string>();
    const seenNewNames = new Set<string>();

    for (const [index, line] of inputs.entries()) {
      const field = `lines.${index}`;
      const hasExisting = line.itemId !== undefined && line.itemId.length > 0;
      const hasNew = line.newItem !== undefined;

      // Both or neither is a client bug. Guessing which was meant would either create a
      // duplicate item or silently price the wrong one.
      if (hasExisting === hasNew) {
        throw new BusinessRuleError(
          'Each line must name either an existing item or a new one, not both.',
          { [field]: ['Pick an item, or fill in the details for a new one.'] },
        );
      }

      const resolved = hasExisting
        ? await this.resolveExistingLine(line.itemId ?? '', field)
        : await this.resolveNewLine(line, field, seenNewNames);

      if (resolved.target.kind === 'existing') {
        if (seenItemIds.has(resolved.target.itemId)) {
          throw new BusinessRuleError(
            `"${resolved.itemName}" appears more than once on this invoice. Combine the quantities instead.`,
            { [field]: ['This item is already on the invoice.'] },
          );
        }

        seenItemIds.add(resolved.target.itemId);
      }

      // Validated against the item's own unit, which is why this cannot happen at the HTTP
      // boundary: the validator there does not know that boxes reject fractions.
      const quantity = InventoryQuantity.normalise(
        line.quantity,
        resolved.unit,
        `${field}.quantity`,
      );

      if (quantity === 0) {
        throw new BusinessRuleError('A purchase line needs a quantity.', {
          [`${field}.quantity`]: ['Enter a quantity greater than zero.'],
        });
      }

      const unitRate = Money.normaliseRate(line.unitRate, `${field}.unitRate`);
      const amounts = Gst.line({
        quantity,
        unitRate,
        gstRatePercent: line.gstRatePercent,
        treatment,
      });

      lines.push({
        target: resolved.target,
        itemName: resolved.itemName,
        unit: resolved.unit,
        category: resolved.category,
        quantity,
        unitRate,
        hsnCode: line.hsnCode?.trim(),
        gstRatePercent: Gst.normaliseRate(line.gstRatePercent, treatment),
        taxableAmount: amounts.taxableAmount,
        cgstAmount: amounts.cgstAmount,
        sgstAmount: amounts.sgstAmount,
        igstAmount: amounts.igstAmount,
        lineTotal: amounts.lineTotal,
      });
    }

    return lines;
  }

  /** The identity a line contributes, whichever kind it is. */
  private async resolveExistingLine(
    itemId: string,
    field: string,
  ): Promise<Pick<CreatePurchaseLineData, 'target' | 'itemName' | 'unit' | 'category'>> {
    const item = await this.requireExistingItem(itemId, field);

    return {
      target: { kind: 'existing', itemId: item.id },
      itemName: item.name,
      unit: item.unit,
      category: item.category,
    };
  }

  /**
   * Validates the details for an item that does not exist yet.
   *
   * Nothing is created here — the repository does that inside the purchase transaction, so
   * a later failure cannot leave the item behind. What this does own is telling the user
   * *before* the write when the name is already taken, since the alternative is a raw
   * unique-constraint violation that names a Postgres index rather than the field.
   */
  private async resolveNewLine(
    line: CreatePurchaseLineInput,
    field: string,
    seenNewNames: Set<string>,
  ): Promise<Pick<CreatePurchaseLineData, 'target' | 'itemName' | 'unit' | 'category'>> {
    const newItem = line.newItem;

    if (newItem === undefined) {
      throw new BusinessRuleError('New item details are missing.', {
        [field]: ['Fill in the new item’s details.'],
      });
    }

    const name = newItem.name.trim();

    if (name.length === 0) {
      throw new BusinessRuleError('A new item needs a name.', {
        [`${field}.newItem.name`]: ['Enter a name.'],
      });
    }

    // Case-insensitive, matching the partial unique index the database enforces.
    const key = name.toLowerCase();

    if (seenNewNames.has(key)) {
      throw new BusinessRuleError(
        `"${name}" is added twice on this invoice. Combine the quantities instead.`,
        { [`${field}.newItem.name`]: ['This item is already on the invoice.'] },
      );
    }

    const clash = await this.items.findByNameAndLocation(name, DESTINATION);

    if (clash !== null) {
      throw new BusinessRuleError(
        `"${clash.name}" already exists at the Home Warehouse. Pick it from the list instead of adding it again.`,
        { [`${field}.newItem.name`]: ['This item already exists — select it from the list.'] },
      );
    }

    seenNewNames.add(key);

    return {
      target: {
        kind: 'new',
        minimumQuantity: InventoryQuantity.normalise(
          newItem.minimumQuantity ?? 0,
          newItem.unit,
          `${field}.newItem.minimumQuantity`,
        ),
      },
      itemName: name,
      unit: newItem.unit,
      category: newItem.category,
    };
  }

  private async requireExistingItem(itemId: string, field: string) {
    const item = await this.items.findById(itemId);

    if (item === null || item.isDeleted) {
      throw new NotFoundError('Inventory item', itemId);
    }

    /*
     * Purchased stock lands at the Home Warehouse, so a line naming a Cart item would add
     * stock in the wrong place. Rejected rather than redirected: the two are separate
     * records even for the same ingredient, and silently picking the other one would
     * credit an item the user did not choose.
     */
    if (item.location !== DESTINATION) {
      throw new BusinessRuleError(
        `"${item.name}" is held at the Cart. Purchases are received into the Home Warehouse.`,
        { [field]: ['Pick a Home Warehouse item.'] },
      );
    }

    if (!item.isActive) {
      throw new BusinessRuleError(`"${item.name}" is inactive and cannot be purchased into.`, {
        [field]: [`${item.name} is inactive.`],
      });
    }

    return item;
  }

}
