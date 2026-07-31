import {
  INVENTORY_CATEGORY_LABELS,
  INVENTORY_HISTORY_ACTION_LABELS,
  INVENTORY_UNIT_ABBREVIATIONS,
  isInventoryCategory,
  isInventoryUnit,
} from '../../../domain/enums/inventory.enum.js';
import { Role } from '../../../domain/enums/role.enum.js';
import { SALES_CHANNEL_LABELS, isSalesChannel } from '../../../domain/enums/sales.enum.js';
import type { IDashboardRepository } from '../../../domain/repositories/dashboard.repository.js';
import type { IInventoryItemHistoryRepository } from '../../../domain/repositories/inventory-item-history.repository.js';
import type {
  DashboardDto,
  DashboardTaskDto,
  GetDashboardInput,
  LowStockItemDto,
  RecentActivityDto,
  TopIngredientDto,
} from '../../dtos/dashboard.dto.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/** How many recent movements the activity feed shows. */
const ACTIVITY_LIMIT = 8;

function abbreviation(unit: string): string {
  return isInventoryUnit(unit) ? INVENTORY_UNIT_ABBREVIATIONS[unit] : unit.toLowerCase();
}

function categoryLabel(category: string): string {
  return isInventoryCategory(category) ? INVENTORY_CATEGORY_LABELS[category] : category;
}

function channelLabel(channel: string): string {
  return isSalesChannel(channel) ? SALES_CHANNEL_LABELS[channel] : channel;
}

/**
 * Assembles the dashboard for whoever is asking.
 *
 * **The payload is shaped by role, not just hidden by it.** An admin's figures — stock
 * valuation, spend, write-downs — are simply absent from a Store Manager's response rather
 * than sent and hidden by the client. A number that reaches the browser has been
 * disclosed, whatever the template does with it.
 */
export class GetDashboardUseCase implements IUseCase<GetDashboardInput, DashboardDto> {
  constructor(
    private readonly dashboard: IDashboardRepository,
    private readonly history: IInventoryItemHistoryRepository,
  ) {}

  async execute(input: GetDashboardInput): Promise<DashboardDto> {
    const [aggregates, recent] = await Promise.all([
      this.dashboard.aggregate(input.forDate, input.windowDays),
      this.history.findRecent(ACTIVITY_LIMIT),
    ]);

    const isAdmin = input.role === Role.ADMIN;

    const lowStockItems: LowStockItemDto[] = aggregates.lowStock.items.map((row) => ({
      id: row.id,
      name: row.name,
      unit: row.unit,
      unitAbbreviation: abbreviation(row.unit),
      currentQuantity: row.currentQuantity,
      minimumQuantity: row.minimumQuantity,
      isOutOfStock: row.currentQuantity <= 0,
    }));

    const recentActivity: RecentActivityDto[] = recent.map((entry) => ({
      id: entry.id,
      itemName: entry.itemName ?? 'Unknown item',
      action: entry.action,
      actionLabel: INVENTORY_HISTORY_ACTION_LABELS[entry.action],
      quantityBefore: entry.quantityBefore,
      quantityAfter: entry.quantityAfter,
      delta:
        entry.quantityBefore !== null && entry.quantityAfter !== null
          ? Math.round((entry.quantityAfter - entry.quantityBefore) * 1000) / 1000
          : null,
      note: entry.note,
      actorName: entry.actorName,
      createdAt: entry.createdAt.toISOString(),
    }));

    const base = {
      role: input.role,
      forDate: input.forDate.toISOString().slice(0, 10),
      generatedAt: new Date().toISOString(),
      windowDays: input.windowDays,

      lowStock: {
        needsRestocking: aggregates.lowStock.needsRestocking,
        outOfStock: aggregates.lowStock.outOfStock,
        items: lowStockItems,
      },
      pendingRequests: {
        awaitingApproval: aggregates.pendingRequests.awaitingApproval,
        awaitingReceipt: aggregates.pendingRequests.awaitingReceipt,
        total:
          aggregates.pendingRequests.awaitingApproval + aggregates.pendingRequests.awaitingReceipt,
      },
      tasks: this.buildTasks(aggregates, isAdmin),
      recentActivity,
      charts: {
        stockMovement: aggregates.stockMovement,
        purchaseSpend: aggregates.purchaseSpend,
        valueByCategory: aggregates.valueByCategory.map((row) => ({
          category: row.category,
          label: categoryLabel(row.category),
          value: row.value,
        })),
        lowStockByCategory: aggregates.lowStockByCategory.map((row) => ({
          category: row.category,
          label: categoryLabel(row.category),
          value: row.value,
        })),
        /*
         * Revenue is admin-only, and the charts object is shared by both layouts — so
         * these two are emptied rather than omitted. A Store Manager's payload therefore
         * carries no takings at all, not a hidden series the client chooses not to draw.
         */
        salesTrend: isAdmin ? aggregates.salesTrend : [],
        salesByChannel: isAdmin
          ? aggregates.salesByChannel.map((row) => ({
              category: row.channel,
              label: channelLabel(row.channel),
              value: row.value,
            }))
          : [],
      },
    };

    if (!isAdmin) {
      return {
        ...base,
        todaysConsumption: aggregates.todaysConsumption,
        unrecordedConsumptionDays: aggregates.unrecordedConsumptionDays,
      };
    }

    const topIngredients: TopIngredientDto[] = aggregates.topIngredients.map((row) => ({
      itemId: row.itemId,
      itemName: row.itemName,
      unit: row.unit,
      unitAbbreviation: abbreviation(row.unit),
      timesUsed: row.timesUsed,
      totalQuantity: row.totalQuantity,
      displayQuantity: `${String(row.totalQuantity)} ${abbreviation(row.unit)}`,
    }));

    return {
      ...base,
      todaysPurchases: aggregates.todaysPurchases,
      inventoryValue: aggregates.inventoryValue,
      transfersToday: aggregates.transfersToday,
      topIngredients,
      writeDowns: aggregates.writeDowns,
      todaysSales: aggregates.todaysSales,
      salesMonthToDate: aggregates.salesMonthToDate,
      unrecordedSalesDays: aggregates.unrecordedSalesDays,
      // Counter figures, alongside the declared ones and never folded into them.
      posToday: aggregates.posToday,
      walkInReconciliation: aggregates.walkInReconciliation,
      topProductsToday: aggregates.topProductsToday,
      // An admin also runs the kitchen on a quiet day, so this stays useful to them.
      todaysConsumption: aggregates.todaysConsumption,
      unrecordedConsumptionDays: aggregates.unrecordedConsumptionDays,
    };
  }

  /**
   * Today's work, derived from live state.
   *
   * There is no task table and there should not be one: a stored task lingers after the
   * work is done, while "four items are below their reorder level" stops being true the
   * moment someone restocks them. Every entry carries the route where acting on it starts —
   * a count the user cannot act on is a nag, not a task.
   *
   * Only non-zero items are returned, so an empty list genuinely means nothing needs doing.
   */
  private buildTasks(
    aggregates: Awaited<ReturnType<IDashboardRepository['aggregate']>>,
    isAdmin: boolean,
  ): DashboardTaskDto[] {
    const tasks: DashboardTaskDto[] = [];

    if (aggregates.lowStock.outOfStock > 0) {
      tasks.push({
        key: 'out-of-stock',
        label: 'Items out of stock',
        count: aggregates.lowStock.outOfStock,
        route: '/inventory?needsRestocking=true',
        severity: 'critical',
      });
    }

    const lowOnly = aggregates.lowStock.needsRestocking - aggregates.lowStock.outOfStock;

    if (lowOnly > 0) {
      tasks.push({
        key: 'low-stock',
        label: 'Items below their reorder level',
        count: lowOnly,
        route: '/inventory?needsRestocking=true',
        severity: 'warning',
      });
    }

    // Approval is the admin's decision; receipt is the person running the cart. Showing
    // each role only the half it can act on is what keeps this list actionable.
    if (isAdmin && aggregates.pendingRequests.awaitingApproval > 0) {
      tasks.push({
        key: 'approve-transfers',
        label: 'Transfers awaiting your approval',
        count: aggregates.pendingRequests.awaitingApproval,
        route: '/transfers',
        severity: 'warning',
      });
    }

    if (aggregates.pendingRequests.awaitingReceipt > 0) {
      tasks.push({
        key: 'receive-transfers',
        label: 'Transfers in transit to confirm',
        count: aggregates.pendingRequests.awaitingReceipt,
        route: '/transfers',
        severity: 'info',
      });
    }

    /*
     * Days with no takings entered — admin-only, because only an admin can enter them.
     *
     * Today is deliberately not counted: the figure is entered after close, so it is not
     * late yet. Anything older is a gap, and a missing day cannot be reconstructed later
     * from anything the system holds — which is what makes it worth nagging about.
     */
    if (isAdmin && aggregates.unrecordedSalesDays.length > 0) {
      const missing = aggregates.unrecordedSalesDays.length;

      tasks.push({
        key: 'unrecorded-sales',
        label: missing === 1 ? 'Day without sales recorded' : 'Days without sales recorded',
        count: missing,
        route: '/sales',
        severity: 'warning',
      });
    }

    /*
     * Admin-only, because `/purchases` is admin-only.
     *
     * A Store Manager no longer holds `PURCHASE_ORDER_READ`, so without this guard the task
     * survives into their payload as a count they cannot act on and a link that answers 403 —
     * the access-denied page reached by following the dashboard's own advice. Every task here
     * carries the route where acting on it starts, which only means something if the reader can
     * open it; a task whose route they are denied is worse than no task at all.
     */
    if (isAdmin && aggregates.purchasesMissingInvoice > 0) {
      tasks.push({
        key: 'missing-bills',
        label: 'Purchases without an attached bill',
        count: aggregates.purchasesMissingInvoice,
        route: '/purchases?hasInvoiceFile=false',
        severity: 'info',
      });
    }

    /*
     * A past day with no sheet, which is the one worth escalating.
     *
     * Ranked above today deliberately, and carrying `warning` where today carries `info`: today's
     * sheet is still being worked on, while yesterday's is late and getting harder to fill in
     * accurately by the hour. Nobody remembers what the cart used the day before last.
     */
    if (aggregates.unrecordedConsumptionDays.length > 0) {
      const missing = aggregates.unrecordedConsumptionDays.length;

      tasks.push({
        key: 'unrecorded-consumption',
        label:
          missing === 1 ? 'Day without consumption recorded' : 'Days without consumption recorded',
        count: missing,
        route: '/consumption',
        severity: 'warning',
      });
    }

    // Absence of a record is itself the task, which is why this one is a count of 1 rather
    // than of some backlog: the sheet either exists for today or it does not.
    if (aggregates.todaysConsumption.sheets === 0) {
      tasks.push({
        key: 'record-consumption',
        label: "Today's consumption not recorded yet",
        count: 1,
        route: '/consumption',
        severity: 'info',
      });
    }

    return tasks;
  }
}
