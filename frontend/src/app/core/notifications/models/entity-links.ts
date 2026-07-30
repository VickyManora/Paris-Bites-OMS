/** Where a notification points, once resolved. */
export interface DeepLink {
  readonly commands: readonly string[];
  /** Always present, possibly empty — callers pass it straight to `Router.navigate`. */
  readonly queryParams: Readonly<Record<string, string>>;
}

/**
 * Maps a notification's `entityType` to the screen that shows it.
 *
 * Shared by the bell and the notification centre rather than duplicated in each: they
 * present the same rows, and two copies of this table would eventually send the same
 * notification to two different places depending on where it was clicked.
 *
 * Keys are the server's `entityType` strings. An unknown one resolves to `null` and the
 * entry simply does not navigate — a notification type added on the server before the UI
 * knows where to send it should still be readable, not broken.
 */
const ENTITY_ROUTES: Readonly<Record<string, (id: string) => DeepLink>> = {
  StockTransfer: (id) => ({ commands: ['/transfers'], queryParams: { transfer: id } }),
  // Both alert types point at the item, which is where the stock level, the expiry date
  // and the adjust action all live.
  InventoryItem: (id) => ({ commands: ['/inventory'], queryParams: { item: id } }),
  Purchase: (id) => ({ commands: ['/purchases'], queryParams: { purchase: id } }),
};

export function deepLinkFor(entityType: string | null, entityId: string | null): DeepLink | null {
  if (entityType === null || entityId === null) {
    return null;
  }

  return ENTITY_ROUTES[entityType]?.(entityId) ?? null;
}
