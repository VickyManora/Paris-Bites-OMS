import { ValidationError } from '../../../domain/errors/domain-error.js';
import type { ISupplierRepository } from '../../../domain/repositories/supplier.repository.js';

/**
 * Resolves an item's supplier reference, rejecting one that does not exist.
 *
 * Shared by create and update so both give the same answer to the same input — a
 * check that lived in only one of them would let an edit set a supplier a create
 * would have refused.
 *
 * The foreign key already guarantees referential integrity, but it fails as an opaque
 * P2003 rather than a message under the supplier field. This turns a "select a valid
 * supplier" mistake into something the form can point at.
 *
 * A **soft-deleted** supplier is refused as well. The foreign key cannot see the
 * difference — the row is still there — but naming a removed vendor as where to reorder
 * from is exactly the suggestion the reorder list must not make.
 *
 * @param supplierId `undefined` leaves the reference untouched, `null` clears it.
 * @returns The value to persist, or `undefined` to change nothing.
 */
export async function resolveSupplierId(
  suppliers: ISupplierRepository,
  supplierId: string | null | undefined,
): Promise<string | null | undefined> {
  if (supplierId === undefined || supplierId === null) {
    return supplierId;
  }

  const supplier = await suppliers.findById(supplierId);

  if (supplier === null || supplier.isDeleted) {
    throw new ValidationError('That supplier does not exist.', {
      supplierId: ['Select a supplier from the list.'],
    });
  }

  return supplierId;
}
