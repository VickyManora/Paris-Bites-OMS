/**
 * Password hashing, abstracted so the algorithm can be swapped (bcrypt today,
 * argon2 tomorrow) without touching a single use case.
 */
export interface IHashService {
  hash(plainText: string): Promise<string>;
  /** Must be a constant-time comparison. */
  compare(plainText: string, hash: string): Promise<boolean>;
}
