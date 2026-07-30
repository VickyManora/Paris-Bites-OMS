import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer, { MulterError } from 'multer';
import { env } from '../../../config/env.js';
import { BusinessRuleError } from '../../../core/domain/errors/domain-error.js';

/**
 * File types an invoice may be, keyed by MIME with the magic bytes that must back it.
 *
 * The declared `Content-Type` on a multipart part is attacker-controlled, so it is checked
 * against the file's actual leading bytes. Without that, "invoice.pdf" claiming to be a
 * PDF while containing anything at all would be stored and later served back with a PDF
 * content type — which is how a stored-XSS or a browser-exploit delivery works.
 *
 * HEIC is matched on the ISO-BMFF `ftyp` box at offset 4 rather than a fixed prefix,
 * because the first four bytes are a length.
 */
const SIGNATURES: Readonly<Record<string, (bytes: Buffer) => boolean>> = {
  'application/pdf': (bytes) => bytes.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/jpeg': (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': (bytes) =>
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (bytes) =>
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP',
  'image/heic': (bytes) => bytes.subarray(4, 8).toString('latin1') === 'ftyp',
};

export const ALLOWED_INVOICE_MIME_TYPES: readonly string[] = Object.keys(SIGNATURES);

/**
 * Multipart parsing for a single invoice file.
 *
 * Memory storage, not disk. The file goes straight to `IFileStorage`, which owns naming
 * and placement — letting multer write it first would put a second, adapter-unaware writer
 * in the path and leave temp files behind on every failed request. Bounded by
 * `UPLOAD_MAX_BYTES`, so "in memory" stays a known quantity.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.UPLOAD_MAX_BYTES,
    // Exactly one file, and no stray text parts: this endpoint takes a bill, nothing else.
    files: 1,
    fields: 0,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_INVOICE_MIME_TYPES.includes(file.mimetype)) {
      callback(
        new BusinessRuleError('An invoice must be a PDF, JPEG, PNG, WebP or HEIC file.', {
          invoice: ['Upload a PDF, JPEG, PNG, WebP or HEIC file.'],
        }),
      );
      return;
    }

    callback(null, true);
  },
});

/**
 * Accepts one `invoice` file part, translating multer's failures into domain errors.
 *
 * Multer reports problems as `MulterError` with terse codes, which the error handler would
 * otherwise surface as a 500. Mapping them here turns "LIMIT_FILE_SIZE" into a 422 that
 * names the limit — the difference between a user shrinking their scan and filing a bug.
 */
export function uploadInvoiceFile(): RequestHandler {
  const handler = upload.single('invoice');

  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (error: unknown) => {
      if (error instanceof MulterError) {
        next(toDomainError(error));
        return;
      }

      if (error !== undefined && error !== null) {
        next(error);
        return;
      }

      next();
    });
  };
}

function toDomainError(error: MulterError): BusinessRuleError {
  const megabytes = Math.round(env.UPLOAD_MAX_BYTES / (1024 * 1024));

  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return new BusinessRuleError(`An invoice must be ${megabytes} MB or smaller.`, {
        invoice: [`This file is too large. The limit is ${megabytes} MB.`],
      });
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return new BusinessRuleError('Upload exactly one file, in a field named "invoice".', {
        invoice: ['Attach a single file.'],
      });
    default:
      return new BusinessRuleError('That upload could not be read.', {
        invoice: ['Try uploading the file again.'],
      });
  }
}

/**
 * Confirms the bytes are what the request claimed.
 *
 * Separate from `fileFilter` because multer runs that before any content exists — the
 * filter can only see the declared type, and the signature can only be checked once the
 * buffer is complete.
 */
export function assertSignatureMatches(mimeType: string, bytes: Buffer): void {
  const matches = SIGNATURES[mimeType];

  if (matches === undefined || !matches(bytes)) {
    throw new BusinessRuleError(
      'That file’s contents do not match its type. Re-save it and try again.',
      { invoice: ['This does not look like a valid PDF or image.'] },
    );
  }
}
