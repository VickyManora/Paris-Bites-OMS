/**
 * Mirrors the supplier DTOs and vocabulary from the API.
 *
 * The state-code table is duplicated from the server rather than fetched. It is a
 * published, effectively frozen list — the GST state codes have changed twice in a
 * decade — and a dropdown that cannot render until a request returns is a worse trade
 * than a table that needs editing on the rare day a state is added. The server still
 * validates the code, so a stale entry here is rejected rather than stored.
 */

export interface Supplier {
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
  /** Server-derived: whether a new invoice may name this supplier. */
  readonly canBePurchasedFrom: boolean;
  readonly isGstRegistered: boolean;

  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The purchase form's dropdown — deliberately smaller than `Supplier`. */
export interface SupplierOption {
  readonly id: string;
  readonly name: string;
  readonly gstin: string | null;
  readonly stateCode: string;
  readonly stateName: string;
  readonly isGstRegistered: boolean;
}

export interface CreateSupplierRequest {
  readonly name: string;
  readonly gstin?: string;
  readonly stateCode: string;
  readonly contactName?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly addressLine?: string;
  readonly city?: string;
  readonly notes?: string;
}

/** `gstin: null` clears it — how a supplier that deregistered is corrected. */
export interface UpdateSupplierRequest {
  readonly name?: string;
  readonly gstin?: string | null;
  readonly stateCode?: string;
  readonly contactName?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly addressLine?: string;
  readonly city?: string;
  readonly notes?: string;
  readonly isActive?: boolean;
}

export const SUPPLIER_SORT_FIELDS = ['name', 'city', 'createdAt'] as const;

export type SupplierSortField = (typeof SUPPLIER_SORT_FIELDS)[number];

export interface SupplierQuery {
  readonly search?: string;
  readonly isActive?: boolean;
  readonly stateCode?: string;
  readonly page: number;
  readonly pageSize: number;
  readonly sortField: SupplierSortField;
  readonly sortDirection: 'asc' | 'desc';
}

/**
 * GST state codes, as published — the two-digit prefix of every GSTIN.
 *
 * A lookup rather than free text: the code decides whether tax splits into CGST/SGST or
 * lands as IGST, so an unrecognised value silently misfiles a return.
 */
export const GST_STATE_CODES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

/** Sorted by name, so a user scanning 36 entries can find their state. */
export const GST_STATE_OPTIONS = Object.entries(GST_STATE_CODES)
  .map(([value, label]) => ({ value, label: `${label} (${value})` }))
  .sort((a, b) => a.label.localeCompare(b.label));

/**
 * GSTIN shape, position by position:
 *
 * ```
 *   27      AAPFU0939F      1        Z         V
 *   state   PAN (10)        entity   literal   checksum
 * ```
 *
 * Duplicated from the server so a typo is caught before a round trip. Structure only —
 * the checksum is not computed here or there, because reimplementing it would start
 * rejecting valid numbers the day the algorithm changes.
 */
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/**
 * The first two characters of a GSTIN are the state code, so a GSTIN that disagrees with
 * the selected state is one of the two being wrong — and getting it wrong flips the whole
 * invoice between CGST/SGST and IGST.
 */
export function gstinMatchesState(gstin: string, stateCode: string): boolean {
  return gstin.slice(0, 2) === stateCode;
}
