/**
 * Purchasing vocabulary.
 *
 * Domain-owned; `PurchasePrismaMapper` bridges to Prisma's generated enums with
 * exhaustive switches that stop compiling if the two diverge.
 */

/**
 * How a purchase is taxed, decided by where the supplier is relative to the business.
 *
 * This is a property of the *invoice*, not of the supplier, which is why it is stored per
 * purchase: the business could relocate, or a supplier could register for GST, and a
 * historical invoice must keep reporting the split it was actually filed with.
 */
export const GstTreatment = {
  /** Supplier in our state: the rate splits evenly into CGST and SGST. */
  INTRA_STATE: 'INTRA_STATE',
  /** Supplier in another state: the whole rate is IGST. */
  INTER_STATE: 'INTER_STATE',
  /** Supplier has no GSTIN. No tax is charged and none can be claimed. */
  UNREGISTERED: 'UNREGISTERED',
} as const;

export type GstTreatment = (typeof GstTreatment)[keyof typeof GstTreatment];

export const ALL_GST_TREATMENTS: readonly GstTreatment[] = [
  GstTreatment.INTRA_STATE,
  GstTreatment.INTER_STATE,
  GstTreatment.UNREGISTERED,
];

export const GST_TREATMENT_LABELS: Readonly<Record<GstTreatment, string>> = {
  [GstTreatment.INTRA_STATE]: 'Intra-state (CGST + SGST)',
  [GstTreatment.INTER_STATE]: 'Inter-state (IGST)',
  [GstTreatment.UNREGISTERED]: 'Unregistered supplier',
};

export function isGstTreatment(value: unknown): value is GstTreatment {
  return typeof value === 'string' && Object.hasOwn(GstTreatment, value);
}

/**
 * Decides the treatment for one purchase.
 *
 * Unregistered wins over the state comparison: a supplier with no GSTIN charges no GST
 * even when they are next door, so checking the state first would produce a CGST/SGST
 * split on an invoice that has no tax line at all.
 */
export function resolveGstTreatment(
  supplierGstin: string | null,
  supplierStateCode: string,
  businessStateCode: string,
): GstTreatment {
  if (supplierGstin === null || supplierGstin.length === 0) {
    return GstTreatment.UNREGISTERED;
  }

  return supplierStateCode === businessStateCode
    ? GstTreatment.INTRA_STATE
    : GstTreatment.INTER_STATE;
}

/**
 * The GST rates that exist in India.
 *
 * A fixed list rather than a free number, because a typo'd 1.8% instead of 18% is a
 * ten-fold tax error that nothing downstream would catch. The odd fractional rates are
 * real: 0.25% applies to rough diamonds and 1.5% to job work on them, and they are
 * included so the list is the actual schedule rather than a convenient subset.
 */
export const GST_RATES: readonly number[] = [0, 0.25, 1.5, 3, 5, 12, 18, 28];

export function isValidGstRate(rate: number): boolean {
  return GST_RATES.includes(rate);
}

/** Fields a purchase list may be sorted on. Anything else is rejected at the boundary. */
export const PURCHASE_SORT_FIELDS = [
  'invoiceDate',
  'invoiceNumber',
  'supplierName',
  'totalAmount',
  'createdAt',
] as const;

export type PurchaseSortField = (typeof PURCHASE_SORT_FIELDS)[number];

export const SUPPLIER_SORT_FIELDS = ['name', 'city', 'createdAt'] as const;

export type SupplierSortField = (typeof SUPPLIER_SORT_FIELDS)[number];

/**
 * GST state codes, as published. The two-digit prefix of every GSTIN.
 *
 * A lookup rather than a free-text field: the code drives whether tax splits into
 * CGST/SGST or lands as IGST, so an unrecognised value silently misfiles a return.
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

/**
 * Returns `boolean`, deliberately not a `value is string` type predicate.
 *
 * Every caller already holds a `string`, so a predicate narrowing to `string` would make
 * the *failing* branch `never` — and the error message that branch builds could then not
 * interpolate the value it is complaining about.
 */
export function isGstStateCode(value: unknown): boolean {
  return typeof value === 'string' && Object.hasOwn(GST_STATE_CODES, value);
}

export function stateNameFor(code: string): string {
  return GST_STATE_CODES[code] ?? 'Unknown state';
}
