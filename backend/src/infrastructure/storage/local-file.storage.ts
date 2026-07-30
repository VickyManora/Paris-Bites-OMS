import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type {
  FileToStore,
  IFileStorage,
  StoredFile,
} from '../../core/application/ports/file-storage.port.js';
import { NotFoundError } from '../../core/domain/errors/domain-error.js';
import type { ILogger } from '../../core/application/ports/logger.port.js';

/**
 * Extensions we are willing to put on disk.
 *
 * The extension is cosmetic — the stored name is a UUID and nothing executes from the
 * upload directory — but keeping it recognisable helps anyone poking at the folder, and
 * an allowlist means a `.php` or `.sh` never lands there even if a misconfigured server
 * were ever pointed at it.
 */
const ALLOWED_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

/**
 * Invoice files on local disk.
 *
 * **Explicitly an interim implementation.** It is correct on a developer machine and on a
 * single long-lived server, and it loses every file on a platform with an ephemeral
 * filesystem — Railway included. Swapping to S3 is one new class implementing
 * `IFileStorage` and one line in the container; nothing above the port knows about paths.
 *
 * The security-relevant decisions:
 *
 * - **The stored name is a generated UUID.** The user's filename is recorded for display
 *   and never touches the path, so an upload called `../../../etc/passwd` is inert.
 * - **Every resolved path is checked to stay inside the root.** Belt and braces against
 *   the above, because path traversal is the one bug here that is catastrophic rather
 *   than annoying.
 * - **Writes are atomic.** Bytes go to a temporary name and are renamed into place, so a
 *   crash mid-write cannot leave a truncated file that reads as a valid invoice.
 */
export class LocalFileStorage implements IFileStorage {
  private readonly root: string;
  private ensured = false;

  constructor(
    uploadDir: string,
    private readonly logger: ILogger,
  ) {
    this.root = resolve(uploadDir);
  }

  async store(file: FileToStore): Promise<StoredFile> {
    await this.ensureRoot();

    const extension = ALLOWED_EXTENSIONS[file.mimeType] ?? extname(file.originalName).slice(0, 10);
    const storedName = `${randomUUID()}${extension}`;
    const checksum = createHash('sha256').update(file.bytes).digest('hex');

    /*
     * Write to a temporary name, then rename. `rename` within one filesystem is atomic, so
     * a reader either sees the whole file or no file — never the half of it that existed
     * when the process died.
     */
    const temporaryPath = this.pathFor(`${storedName}.part`);
    const finalPath = this.pathFor(storedName);

    await writeFile(temporaryPath, file.bytes, { flag: 'wx' });

    try {
      await rename(temporaryPath, finalPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }

    this.logger.debug('Stored uploaded file', {
      storedName,
      sizeBytes: file.bytes.length,
    });

    return { storedName, sizeBytes: file.bytes.length, checksum };
  }

  async read(storedName: string): Promise<Readable> {
    const path = this.pathFor(storedName);

    // Stat first so a missing file surfaces as a clean 404 rather than an error event on
    // a stream the response has already started writing to.
    try {
      await stat(path);
    } catch {
      throw new NotFoundError('Stored file', storedName);
    }

    return createReadStream(path);
  }

  async delete(storedName: string): Promise<void> {
    try {
      await unlink(this.pathFor(storedName));
    } catch (error) {
      /*
       * Absent is success. Deletion is only ever called to clean up something the database
       * no longer references, so failing here would turn a completed replacement into an
       * error over a file that is already gone.
       */
      const code = (error as NodeJS.ErrnoException).code;

      if (code !== 'ENOENT') {
        this.logger.warn('Failed to delete stored file', { storedName, code });
      }
    }
  }

  /**
   * Resolves a stored name inside the root, refusing anything that escapes it.
   *
   * The UUID naming means this should be unreachable. It is here because "should be
   * unreachable" is exactly the assumption path-traversal bugs are built on, and the check
   * costs one string comparison.
   */
  private pathFor(storedName: string): string {
    const path = resolve(join(this.root, storedName));

    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new NotFoundError('Stored file', storedName);
    }

    return path;
  }

  /** Created lazily and once, so a fresh checkout needs no setup step before uploading. */
  private async ensureRoot(): Promise<void> {
    if (this.ensured) {
      return;
    }

    await mkdir(this.root, { recursive: true });
    this.ensured = true;
  }
}
