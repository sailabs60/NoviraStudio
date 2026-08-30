import { PrismaClient } from '@prisma/client';

/**
 * BigInt ids do not survive JSON.stringify. Every id in this schema fits
 * comfortably in a JS number, so we teach BigInt how to serialise once here
 * rather than mapping ids at every route boundary.
 */
(BigInt.prototype as unknown as { toJSON(): number }).toJSON = function toJSON(this: bigint) {
  return Number(this);
};

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/** Narrow a route parameter to a positive BigInt id, or null. */
export function toId(value: unknown): bigint | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return BigInt(n);
}
