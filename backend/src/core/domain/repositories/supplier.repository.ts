import type { Page, PageRequest } from '../../../shared/pagination.js';
import type { Supplier } from '../entities/supplier.entity.js';
import type { SupplierSortField } from '../enums/purchase.enum.js';

export interface CreateSupplierData {
  readonly name: string;
  readonly gstin?: string | undefined;
  readonly stateCode: string;
  readonly contactName?: string | undefined;
  readonly email?: string | undefined;
  readonly phone?: string | undefined;
  readonly addressLine?: string | undefined;
  readonly city?: string | undefined;
  readonly notes?: string | undefined;
  readonly createdById: string | null;
}

/** Absent keys are left untouched. */
export type UpdateSupplierData = Partial<Omit<CreateSupplierData, 'createdById'>> & {
  readonly isActive?: boolean;
};

export interface SupplierFilter {
  /** Matches name, GSTIN, contact and city. */
  readonly search?: string | undefined;
  readonly isActive?: boolean | undefined;
  readonly stateCode?: string | undefined;
  /** Defaults to false — soft-deleted rows are hidden unless asked for. */
  readonly includeDeleted?: boolean | undefined;
}

export interface SupplierSort {
  readonly field: SupplierSortField;
  readonly direction: 'asc' | 'desc';
}

export interface ISupplierRepository {
  findById(id: string): Promise<Supplier | null>;
  findMany(filter: SupplierFilter, page: PageRequest, sort: SupplierSort): Promise<Page<Supplier>>;
  /**
   * Every supplier a new invoice may name, unpaginated.
   *
   * Feeds the purchase form's dropdown, which must show all of them — a paged select is
   * a select the user cannot find their vendor in. Bounded in practice by how many
   * vendors a dessert business has.
   */
  findSelectable(): Promise<readonly Supplier[]>;
  create(data: CreateSupplierData): Promise<Supplier>;
  update(id: string, data: UpdateSupplierData): Promise<Supplier>;
  /** Soft delete — stamps `deletedAt`. Purchase history must survive it. */
  softDelete(id: string): Promise<void>;
  /** Whether any purchase names this supplier, which changes what deletion means. */
  hasPurchases(id: string): Promise<boolean>;
}
