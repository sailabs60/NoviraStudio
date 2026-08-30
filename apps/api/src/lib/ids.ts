import { randomBytes, randomUUID } from 'node:crypto';

/** URL-safe opaque token — used for share links and invitations, never a row id. */
export function opaqueToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export const uuid = (): string => randomUUID();

/** Stable file key for uploaded objects. */
export const fileKey = (): string => randomBytes(16).toString('hex');
