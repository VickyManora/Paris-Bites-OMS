import type { MenuCategory, Product } from './pos.model';

/**
 * The takeaway-box prompt for waffles.
 *
 * A waffle sold to take away needs a box, and the box is a chargeable line — `Waffle Packaging`,
 * ₹10, already on the menu under Extras. Before this, charging for it depended on the cashier
 * remembering to tap a product in a different category from the one they were just looking at,
 * which is exactly the kind of thing that gets missed on a busy counter. Every miss is ₹10 the
 * shop paid for a box it gave away.
 *
 * So the question is asked at the moment it can still be answered: as the waffle goes into the
 * cart, while the customer is still standing there saying whether they are eating in.
 *
 * ## Matched on names, resolved against the live menu
 *
 * Both the category and the packaging product are found by name, the same approach
 * `COMBO_OFFER_POLICY` takes and for the same reason: ids are generated and change on a reseed,
 * while these names are what the shop calls things. A name that matches nothing yields no prompt
 * and the flow is unchanged — which is the right failure, because a prompt that cannot add
 * anything is worse than no prompt.
 *
 * **Not matched on the word "waffle" in the product name.** That was the obvious first cut and it
 * is wrong twice over: `Waffle Packaging` contains it, so the box would prompt for its own box,
 * and a future `Waffle Sundae` filed under Bowls would prompt for a box it does not need. The
 * category is the thing that actually means "this is a waffle".
 */
const WAFFLE_CATEGORY_NAME = 'Belgian Waffles';
const PACKAGING_PRODUCT_NAME = 'Waffle Packaging';

/** Case- and space-insensitive, so a menu edit that retitles nothing but the casing still matches. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Every product id in the waffle category.
 *
 * A set of ids rather than a predicate over a `Product`, because the thing being tested is
 * sometimes a cart line, which carries the product but is not one.
 */
export function waffleProductIds(menu: readonly MenuCategory[]): ReadonlySet<string> {
  const category = menu.find((entry) => sameName(entry.name, WAFFLE_CATEGORY_NAME));

  return new Set(category?.products.map((product) => product.id) ?? []);
}

/**
 * The packaging product, or `null` if it is absent or currently unavailable.
 *
 * Availability is checked here rather than by the caller because it is the same question as "can
 * this prompt do anything": marking the box sold out is how the shop says it has run out of boxes,
 * and asking "shall I pack it?" when there is nothing to pack it in wastes a tap and teaches the
 * cashier to dismiss the prompt without reading it.
 *
 * Searched across the whole menu rather than within Extras. Which category the shop files it
 * under is presentation, and a reorganised menu should not silently switch the charge off.
 */
export function findPackagingProduct(menu: readonly MenuCategory[]): Product | null {
  for (const category of menu) {
    const match = category.products.find((product) =>
      sameName(product.name, PACKAGING_PRODUCT_NAME),
    );

    if (match !== undefined) {
      return match.isAvailable ? match : null;
    }
  }

  return null;
}
