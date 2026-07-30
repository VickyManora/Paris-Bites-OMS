import type { Readable } from 'node:stream';

export interface StoredFile {
  /** Opaque name the storage assigned. Never derived from user input. */
  readonly storedName: string;
  readonly sizeBytes: number;
  /** SHA-256 of the bytes as written. */
  readonly checksum: string;
}

export interface FileToStore {
  /** The user's original filename. Recorded for display; never used to build a path. */
  readonly originalName: string;
  readonly mimeType: string;
  readonly bytes: Buffer;
}

/**
 * Somewhere to put an uploaded invoice.
 *
 * A port because the local-disk implementation behind it is explicitly temporary: it works
 * on a developer machine and on a single long-lived server, and it loses every file on a
 * platform with an ephemeral filesystem. Swapping to S3 should be one new adapter and one
 * line in the container, with no use case touched — which is only true if nothing above
 * this interface knows about paths.
 *
 * That is why `store` returns an opaque `storedName` rather than a path or URL, and why
 * reading takes that name back. A use case that received a filesystem path would quietly
 * bake local disk into the application layer.
 */
export interface IFileStorage {
  /**
   * Writes bytes and returns what to record.
   *
   * Implementations must generate their own storage name. Trusting `originalName` is the
   * classic path-traversal hole — a file called `../../../etc/passwd` must land in the
   * upload directory like anything else.
   */
  store(file: FileToStore): Promise<StoredFile>;

  /** Opens a stored file for streaming. Throws `NotFoundError` if it is gone. */
  read(storedName: string): Promise<Readable>;

  /**
   * Removes a stored file.
   *
   * Must not throw when the file is already absent. Deletion is only ever called to clean
   * up something the database no longer references, and failing there would turn a
   * successful replacement into an error.
   */
  delete(storedName: string): Promise<void>;
}
