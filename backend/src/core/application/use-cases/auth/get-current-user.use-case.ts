import type { SessionScope } from '../../../domain/enums/session-scope.enum.js';
import { UnauthorizedError } from '../../../domain/errors/domain-error.js';
import type { IUserRepository } from '../../../domain/repositories/user.repository.js';
import type { AuthenticatedUserDto } from '../../dtos/auth.dto.js';
import { AuthMapper } from '../../mappers/auth.mapper.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/**
 * Returns the signed-in user's profile and permissions.
 *
 * Reads from the database rather than trusting the JWT claims. The token proves
 * *who* the caller is; it is a snapshot from up to 15 minutes ago, so it must not
 * be the source of truth for what they may currently do.
 */
export interface GetCurrentUserInput {
  readonly userId: string;
  /** The session's scope, so the permissions returned are the ones it can actually use. */
  readonly scope?: SessionScope | undefined;
}

export class GetCurrentUserUseCase implements IUseCase<GetCurrentUserInput, AuthenticatedUserDto> {
  constructor(private readonly users: IUserRepository) {}

  async execute({ userId, scope }: GetCurrentUserInput): Promise<AuthenticatedUserDto> {
    const user = await this.users.findById(userId);

    // A valid token for a since-deleted or suspended account.
    if (user === null || !user.canSignIn) {
      throw new UnauthorizedError('Your session is no longer valid. Please sign in again.');
    }

    return AuthMapper.toAuthenticatedUserDto(user, scope);
  }
}
