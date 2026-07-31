import { z } from 'zod';
import { devLoginDomain } from '../../../config/env.js';
import { emailSchema, passwordSchema } from './common.validators.js';

/**
 * The account identifier, which is an e-mail address everywhere that matters.
 *
 * When `DEV_LOGIN_DOMAIN` is set — development only, see `devLoginDomain` — a value with no
 * `@` in it has that domain appended, so the seeded `admin` and `sunil` accounts can be
 * reached by typing just the name. Anything already containing an `@` is untouched, so a real
 * address behaves identically either way.
 *
 * The expansion happens *before* `emailSchema`, and the result is piped through it rather
 * than around it: a bare name still has to produce a valid, length-bounded address, and the
 * shape of an e-mail is still defined in exactly one place. With no dev domain configured the
 * transform is the identity function and this is `emailSchema` verbatim — which is the whole
 * of the behaviour in production.
 */
const loginIdentifierSchema = z
  .string()
  .trim()
  .toLowerCase()
  // Bounded here as well as in `emailSchema`, so an enormous body is rejected before the
  // domain is concatenated onto it rather than after.
  .max(255, 'Email must be at most 255 characters.')
  .transform((value) =>
    devLoginDomain !== undefined && value.length > 0 && !value.includes('@')
      ? `${value}@${devLoginDomain}`
      : value,
  )
  .pipe(emailSchema);

/**
 * Login accepts any non-empty password rather than applying `passwordSchema`.
 *
 * Enforcing the strength rules here would reject an existing account whose
 * password predates a policy change, and would leak the current policy to
 * unauthenticated callers. Strength is a rule about *setting* a password, not
 * about presenting one.
 */
export const loginSchema = z.object({
  email: loginIdentifierSchema,
  password: z
    .string()
    .min(1, 'Password is required.')
    // Bounded so an enormous body cannot be pushed through bcrypt.
    .max(128, 'Password must be at most 128 characters.'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Your current password is required.'),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'Your new password must be different from the current one.',
    path: ['newPassword'],
  });

export type LoginBody = z.infer<typeof loginSchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
