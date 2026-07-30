import type { SupplierSortField } from '../../domain/enums/purchase.enum.js';
import type { RequestContext } from './auth.dto.js';

export interface SupplierDto {
  readonly id: string;
  readonly name: string;
  readonly gstin: string | null;
  readonly stateCode: string;
  readonly stateName: string;

  readonly contactName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly addressLine: string | null;
  readonly city: string | null;
  readonly notes: string | null;

  readonly isActive: boolean;
  /** Server-derived: whether a new purchase may name this supplier. */
  readonly canBePurchasedFrom: boolean;
  readonly isGstRegistered: boolean;

  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The purchase form's dropdown.
 *
 * Deliberately smaller than `SupplierDto`: the select needs to identify a supplier and
 * predict its tax treatment, and shipping notes and addresses to render an option list is
 * payload nobody reads.
 */
export interface SupplierOptionDto {
  readonly id: string;
  readonly name: string;
  readonly gstin: string | null;
  readonly stateCode: string;
  readonly stateName: string;
  readonly isGstRegistered: boolean;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateSupplierInput extends RequestContext {
  readonly actorId: string;
  readonly name: string;
  readonly gstin?: string | undefined;
  readonly stateCode: string;
  readonly contactName?: string | undefined;
  readonly email?: string | undefined;
  readonly phone?: string | undefined;
  readonly addressLine?: string | undefined;
  readonly city?: string | undefined;
  readonly notes?: string | undefined;
}

export interface UpdateSupplierInput extends RequestContext {
  readonly actorId: string;
  readonly id: string;
  readonly name?: string | undefined;
  readonly gstin?: string | null | undefined;
  readonly stateCode?: string | undefined;
  readonly contactName?: string | undefined;
  readonly email?: string | undefined;
  readonly phone?: string | undefined;
  readonly addressLine?: string | undefined;
  readonly city?: string | undefined;
  readonly notes?: string | undefined;
  readonly isActive?: boolean | undefined;
}

export interface DeleteSupplierInput extends RequestContext {
  readonly actorId: string;
  readonly id: string;
}

export interface ListSuppliersInput {
  readonly search?: string | undefined;
  readonly isActive?: boolean | undefined;
  readonly stateCode?: string | undefined;
  readonly page: number;
  readonly pageSize: number;
  readonly sortField: SupplierSortField;
  readonly sortDirection: 'asc' | 'desc';
}
