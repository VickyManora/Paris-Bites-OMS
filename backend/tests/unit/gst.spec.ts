import { describe, expect, it } from 'vitest';
import { GstTreatment } from '../../src/core/domain/enums/purchase.enum.js';
import { BusinessRuleError } from '../../src/core/domain/errors/domain-error.js';
import { Gst, type GstLineAmounts } from '../../src/core/domain/value-objects/gst.js';
import { Money } from '../../src/core/domain/value-objects/money.js';

describe('Money', () => {
  it('sums without floating-point drift', () => {
    // Plain `+` gives 0.30000000000000004 here.
    expect(Money.sum([0.1, 0.2])).toBe(0.3);
  });

  it('stays exact across many additions', () => {
    const hundredPaise = Array.from({ length: 100 }, () => 0.01);
    expect(Money.sum(hundredPaise)).toBe(1);
  });

  it('rounds half up, including the binary-representation edge case', () => {
    // 1.005 is really 1.00499999... in binary; a naive Math.round loses the paisa.
    expect(Money.round(1.005)).toBe(1.01);
    expect(Money.round(2.675)).toBe(2.68);
  });

  it('rejects a negative amount with a field-scoped message', () => {
    expect(() => Money.normalise(-1, 'unitRate')).toThrow(BusinessRuleError);
  });
});

describe('Gst.line', () => {
  it('splits intra-state tax into equal halves', () => {
    const line = Gst.line({
      quantity: 10,
      unitRate: 100,
      gstRatePercent: 18,
      treatment: GstTreatment.INTRA_STATE,
    });

    expect(line.taxableAmount).toBe(1000);
    expect(line.cgstAmount).toBe(90);
    expect(line.sgstAmount).toBe(90);
    expect(line.igstAmount).toBe(0);
    expect(line.lineTotal).toBe(1180);
  });

  it('puts the whole rate on IGST inter-state', () => {
    const line = Gst.line({
      quantity: 10,
      unitRate: 100,
      gstRatePercent: 18,
      treatment: GstTreatment.INTER_STATE,
    });

    expect(line.cgstAmount).toBe(0);
    expect(line.sgstAmount).toBe(0);
    expect(line.igstAmount).toBe(180);
    expect(line.lineTotal).toBe(1180);
  });

  it('charges nothing for an unregistered supplier, whatever rate is sent', () => {
    const line = Gst.line({
      quantity: 10,
      unitRate: 100,
      gstRatePercent: 18,
      treatment: GstTreatment.UNREGISTERED,
    });

    expect(line.taxAmount).toBe(0);
    expect(line.lineTotal).toBe(1000);
  });

  /**
   * The bug this guards: rounding each half independently. A tax of 9.01 would become
   * 4.51 + 4.51 = 9.02, inventing a paisa of input credit on every such line.
   */
  it('keeps CGST + SGST exactly equal to the tax on an odd number of paise', () => {
    const line = Gst.line({
      quantity: 1,
      unitRate: 100.05,
      gstRatePercent: 18,
      treatment: GstTreatment.INTRA_STATE,
    });

    expect(Money.sum([line.cgstAmount, line.sgstAmount])).toBe(line.taxAmount);
    expect(Money.sum([line.taxableAmount, line.taxAmount])).toBe(line.lineTotal);
  });

  it('keeps the halves consistent across a sweep of awkward amounts', () => {
    for (let paise = 1; paise <= 500; paise++) {
      const line = Gst.line({
        quantity: 1,
        unitRate: paise / 100,
        gstRatePercent: 5,
        treatment: GstTreatment.INTRA_STATE,
      });

      expect(Money.sum([line.cgstAmount, line.sgstAmount])).toBe(line.taxAmount);
    }
  });

  it('handles a fine per-unit rate over a large quantity', () => {
    // 5000 g at 0.1234/g — the case that motivated a 4-decimal rate column.
    const line = Gst.line({
      quantity: 5000,
      unitRate: 0.1234,
      gstRatePercent: 5,
      treatment: GstTreatment.INTER_STATE,
    });

    expect(line.taxableAmount).toBe(617);
    expect(line.igstAmount).toBe(30.85);
    expect(line.lineTotal).toBe(647.85);
  });

  it('rejects a rate that is not on the GST schedule', () => {
    expect(() =>
      Gst.line({
        quantity: 1,
        unitRate: 100,
        gstRatePercent: 1.8,
        treatment: GstTreatment.INTRA_STATE,
      }),
    ).toThrow(BusinessRuleError);
  });

  it('accepts the fractional rates that genuinely exist', () => {
    expect(() =>
      Gst.line({
        quantity: 1,
        unitRate: 100,
        gstRatePercent: 0.25,
        treatment: GstTreatment.INTRA_STATE,
      }),
    ).not.toThrow();
  });
});

describe('Gst.totals', () => {
  function lineAt(unitRate: number, rate: number, treatment: GstTreatment): GstLineAmounts {
    return Gst.line({ quantity: 3, unitRate, gstRatePercent: rate, treatment });
  }

  /**
   * The reconciliation property: what the invoice states must equal what its lines add up
   * to, to the paisa. Mixed rates on one invoice are the normal case — food at 5% and
   * packaging at 18%.
   */
  it('totals match the sum of the lines exactly, across mixed rates', () => {
    const lines = [
      lineAt(33.33, 5, GstTreatment.INTRA_STATE),
      lineAt(19.99, 18, GstTreatment.INTRA_STATE),
      lineAt(7.77, 12, GstTreatment.INTRA_STATE),
    ];

    const totals = Gst.totals(lines);

    expect(totals.subtotal).toBe(Money.sum(lines.map((line) => line.taxableAmount)));
    expect(totals.totalTax).toBe(Money.sum(lines.map((line) => line.taxAmount)));
    expect(totals.totalAmount).toBe(Money.sum(lines.map((line) => line.lineTotal)));
    expect(totals.totalIgst).toBe(0);
  });

  it('never mixes IGST with CGST/SGST on one invoice', () => {
    const totals = Gst.totals([
      lineAt(100, 18, GstTreatment.INTER_STATE),
      lineAt(50, 5, GstTreatment.INTER_STATE),
    ]);

    expect(totals.totalCgst).toBe(0);
    expect(totals.totalSgst).toBe(0);
    expect(totals.totalIgst).toBeGreaterThan(0);
  });

  it('returns zeroes for an empty invoice rather than NaN', () => {
    expect(Gst.totals([])).toEqual({
      subtotal: 0,
      totalCgst: 0,
      totalSgst: 0,
      totalIgst: 0,
      totalTax: 0,
      totalAmount: 0,
    });
  });
});
