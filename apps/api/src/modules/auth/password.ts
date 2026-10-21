import * as argon2 from 'argon2';
import { Errors } from '../../common/errors';

/** Argon2id with OWASP-recommended baseline parameters (PRD §103). */
const ARGON_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Constant-time-ish dummy verification to blunt username enumeration via timing. */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHash ??= hashPassword('karban-dummy-password-1');
  await verifyPassword(await dummyHash, plain);
}

/**
 * MVP password policy (PRD §136 "Password Policy" — default pending validation):
 * at least 8 characters, containing both letters and digits.
 */
export function assertPasswordPolicy(password: string, username?: string): void {
  if (password.length < 8) throw Errors.validation('رمز عبور باید حداقل ۸ کاراکتر باشد.');
  if (password.length > 128) throw Errors.validation('رمز عبور بیش از حد طولانی است.');
  if (!/\p{L}/u.test(password) || !/[0-9۰-۹]/.test(password)) {
    throw Errors.validation('رمز عبور باید شامل حروف و عدد باشد.');
  }
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    throw Errors.validation('رمز عبور نباید شامل نام کاربری باشد.');
  }
}
