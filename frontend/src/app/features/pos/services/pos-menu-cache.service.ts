import { inject, Injectable } from '@angular/core';
import { StorageKeys } from '../../../core/constants/storage-keys';
import { StorageService } from '../../../core/services/storage.service';
import type { MenuCategory } from '../models/pos.model';

/**
 * How old a cached menu may be before it is ignored.
 *
 * A week. Long enough that a cart which trades daily always opens instantly, short enough that a
 * menu nobody has synced since the last redesign never appears at all — at that age the right
 * behaviour is the spinner, because the screen would otherwise be a museum piece presented as the
 * current menu.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedMenu {
  readonly savedAt: number;
  readonly menu: readonly MenuCategory[];
}

/**
 * The last menu the API returned, kept so the order screen can be used before the API answers.
 *
 * ## This reverses a documented decision, deliberately
 *
 * `app.config.ts` states that the service worker caches the app shell and **no API response**,
 * because "a POS that shows a cached menu would be lying about the state of the business, and a
 * stale price is a wrong charge". The first half stands. The second is what changed, and it changed
 * because of something the app already does rather than because the risk was reconsidered:
 *
 * **the server re-prices every order on submit.** The cart sends product ids and quantities; prices
 * travel with the menu for *display*, and `PlaceOrderUseCase` looks up the real price itself. So a
 * stale cached price can produce a wrong number on the screen a cashier is reading — it cannot
 * produce a wrong charge. That is a real cost and a much smaller one than a counter that cannot
 * take an order for a minute, which is the alternative being paid today.
 *
 * The screen is not allowed to hide the difference: while the menu on display came from here rather
 * than from the API, the order page says so, in the one place the cashier is already looking.
 *
 * ## What is not cached
 *
 * Availability is part of the menu and therefore part of the staleness: an item marked sold out an
 * hour ago may be back, and vice versa. Nothing else — no takings, no order list, no summary. Those
 * answer "what has happened", and a cached answer to that question is the lie the original note is
 * about. This one answers "what do we sell", which changes on the scale of weeks.
 */
@Injectable({ providedIn: 'root' })
export class PosMenuCacheService {
  private readonly storage = inject(StorageService);

  /**
   * The cached menu, or `null` if there is none, it is too old, or it does not parse.
   *
   * The shape check is not paranoia: this value survives deployments, so the app that reads it can
   * be a version newer than the one that wrote it. Anything unrecognisable is dropped rather than
   * handed to a template that would then fail on a missing field.
   */
  read(): { readonly menu: readonly MenuCategory[]; readonly savedAt: Date } | null {
    const cached = this.storage.get<CachedMenu | null>(StorageKeys.posMenu, null);

    if (
      cached === null ||
      typeof cached.savedAt !== 'number' ||
      !Array.isArray(cached.menu) ||
      cached.menu.length === 0
    ) {
      return null;
    }

    if (Date.now() - cached.savedAt > MAX_AGE_MS) {
      this.storage.remove(StorageKeys.posMenu);
      return null;
    }

    return { menu: cached.menu, savedAt: new Date(cached.savedAt) };
  }

  /** Records a menu that came from the API. Called on every successful load, not only the first. */
  write(menu: readonly MenuCategory[]): void {
    if (menu.length === 0) {
      // An empty menu is a failure that returned 200, and caching it would turn one bad response
      // into an empty counter screen that persists across reloads.
      return;
    }

    this.storage.set<CachedMenu>(StorageKeys.posMenu, { savedAt: Date.now(), menu });
  }
}
