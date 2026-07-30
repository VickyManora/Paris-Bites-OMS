import bcrypt from 'bcryptjs';
import type { IHashService } from '../../core/application/ports/hash.service.port.js';

/** bcrypt adapter for `IHashService`. Cost factor comes from configuration. */
export class BcryptHashService implements IHashService {
  constructor(private readonly saltRounds: number) {}

  async hash(plainText: string): Promise<string> {
    return bcrypt.hash(plainText, this.saltRounds);
  }

  async compare(plainText: string, hash: string): Promise<boolean> {
    // bcrypt.compare is constant-time with respect to the digest.
    return bcrypt.compare(plainText, hash);
  }
}
