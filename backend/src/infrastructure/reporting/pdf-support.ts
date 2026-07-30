const MUTED = '#666666';

/**
 * Currency for PDFs.
 *
 * **`Rs.`, not `₹`** — and this is not a style choice.
 *
 * pdfkit's built-in fonts are the PDF standard fourteen, which use WinAnsiEncoding. That
 * character set predates the rupee sign (U+20B9, added to Unicode in 2010) and has no
 * glyph for it, so `₹` is silently substituted with whatever occupies that code point —
 * every amount in the file renders as `ˡ35,240.00`. It looks like a font-rendering bug in
 * the reader, which is exactly why it survived a round of "does the PDF parse and have
 * pages" checks: the bytes are valid, only the output is wrong.
 *
 * The alternative is embedding a TrueType font that carries the glyph, which means adding
 * roughly half a megabyte of binary to the repository for one character. `Rs.` is
 * unambiguous, standard on Indian invoices, and costs nothing. Excel and the browser both
 * render `₹` correctly and keep using it.
 */
export function pdfMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }

  return `Rs. ${Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Writes "Page N of M" on every page.
 *
 * The bottom margin is temporarily set to zero around each write. Without that, pdfkit
 * treats text positioned below the margin as content that does not fit and **starts a new
 * page** — so the footer pass appended one blank page per real page, doubling the document
 * and making its own page count wrong. A four-page PDF of two pages of content is the
 * symptom; an off-by-double "of M" is the tell.
 *
 * Requires the document to have been created with `bufferPages: true`.
 */
export function drawPageNumbers(doc: PDFKit.PDFDocument, margin: number): void {
  const range = doc.bufferedPageRange();

  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index);

    const previous = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc
      .fontSize(7)
      .fillColor(MUTED)
      .text(
        `Page ${String(index + 1)} of ${String(range.count)}`,
        margin,
        doc.page.height - margin + 4,
        { width: doc.page.width - margin * 2, align: 'right', lineBreak: false },
      );

    doc.page.margins.bottom = previous;
  }
}
