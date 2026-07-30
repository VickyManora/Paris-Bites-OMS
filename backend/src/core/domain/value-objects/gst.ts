import { GstTreatment, isValidGstRate } from '../enums/purchase.enum.js';
import { BusinessRuleError } from '../errors/domain-error.js';
import { Money } from './money.js';

export interface GstLineInput {
  readonly quantity: number;
  readonly unitRate: number;
  readonly gstRatePercent: number;
  readonly treatment: GstTreatment;
}

export interface GstLineAmounts {
  readonly taxableAmount: number;
  readonly cgstAmount: number;
  readonly sgstAmount: number;
  readonly igstAmount: number;
  readonly taxAmount: number;
  readonly lineTotal: number;
}

export interface GstTotals {
  readonly subtotal: number;
  readonly totalCgst: number;
  readonly totalSgst: number;
  readonly totalIgst: number;
  readonly totalTax: number;
  readonly totalAmount: number;
}

/**
 * GST arithmetic for a purchase invoice.
 *
 * Three properties this must guarantee, each of which is a real reconciliation bug if it
 * fails:
 *
 * 1. **CGST + SGST equals the tax exactly.** The halves are not each rounded
 *    independently — the second is computed as the remainder. Rounding both halves of a
 *    ₹9.01 tax gives ₹4.51 + ₹4.51 = ₹9.02, inventing a paisa of input credit.
 * 2. **Line totals sum to the invoice total exactly.** Totals are summed from already
 *    rounded line values rather than recomputed from unrounded ones, so what the invoice
 *    states is what its lines add up to.
 * 3. **The split matches the treatment.** Intra-state never produces IGST, inter-state
 *    never produces CGST/SGST, and an unregistered supplier produces no tax at all. The
 *    database enforces this too, as a backstop.
 */
export const Gst = {
  /**
   * Computes one line.
   *
   * The taxable amount is rounded to currency scale *before* tax is applied. That is the
   * order an invoice does it in — the line's net value is a printed figure, and taxing an
   * unrounded intermediate would produce a tax that does not match the printed base.
   */
  line(input: GstLineInput): GstLineAmounts {
    const rate = Gst.normaliseRate(input.gstRatePercent, input.treatment);
    const taxableAmount = Money.round(input.quantity * input.unitRate);

    if (rate === 0) {
      return {
        taxableAmount,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        taxAmount: 0,
        lineTotal: taxableAmount,
      };
    }

    const taxAmount = Money.round((taxableAmount * rate) / 100);

    if (input.treatment === GstTreatment.INTER_STATE) {
      return {
        taxableAmount,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: taxAmount,
        taxAmount,
        lineTotal: Money.sum([taxableAmount, taxAmount]),
      };
    }

    /*
     * Intra-state. The first half is rounded and the second takes the remainder, so the
     * two always add back to `taxAmount` even when it is an odd number of paise. Which
     * half absorbs the extra paisa is arbitrary but must be consistent; CGST taking it
     * matches how the common accounting packages print it.
     */
    const cgstAmount = Money.round(taxAmount / 2);
    const sgstAmount = Money.round(taxAmount - cgstAmount);

    return {
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount: 0,
      taxAmount,
      lineTotal: Money.sum([taxableAmount, taxAmount]),
    };
  },

  /** Adds up computed lines. Pure summation — nothing is recalculated here. */
  totals(lines: readonly GstLineAmounts[]): GstTotals {
    const subtotal = Money.sum(lines.map((line) => line.taxableAmount));
    const totalCgst = Money.sum(lines.map((line) => line.cgstAmount));
    const totalSgst = Money.sum(lines.map((line) => line.sgstAmount));
    const totalIgst = Money.sum(lines.map((line) => line.igstAmount));
    const totalTax = Money.sum([totalCgst, totalSgst, totalIgst]);

    return {
      subtotal,
      totalCgst,
      totalSgst,
      totalIgst,
      totalTax,
      totalAmount: Money.sum([subtotal, totalTax]),
    };
  },

  /**
   * Validates a rate against the published schedule.
   *
   * An unregistered supplier is forced to zero rather than rejected: the UI may well send
   * the rate the item usually carries, and refusing it would make the user clear every
   * line by hand to record a perfectly ordinary cash purchase.
   */
  normaliseRate(gstRatePercent: number, treatment: GstTreatment): number {
    if (treatment === GstTreatment.UNREGISTERED) {
      return 0;
    }

    if (!Number.isFinite(gstRatePercent)) {
      throw new BusinessRuleError('GST rate must be a number.', {
        gstRatePercent: ['Enter a valid GST rate.'],
      });
    }

    if (!isValidGstRate(gstRatePercent)) {
      throw new BusinessRuleError(
        `${gstRatePercent}% is not a GST rate. Use one of 0, 0.25, 1.5, 3, 5, 12, 18 or 28.`,
        { gstRatePercent: ['Select a valid GST rate.'] },
      );
    }

    return gstRatePercent;
  },
} as const;
