import { z } from 'zod';
import { emailSchema, passwordSchema } from './common.validators.js';

/**
 * Login accepts any non-empty password rather than applying `passwordSchema`.
 *
 * Enforcing the strength rules here would reject an existing account whose
 * password predates a policy change, and would leak the current policy to
 * unauthenticated callers. Strength is a rule about *setting* a password, not
 * about presenting one.
 */
export const loginSchema = z.object({
  email: emailSchema,
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
