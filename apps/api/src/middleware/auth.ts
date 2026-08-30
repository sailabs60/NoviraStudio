import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import type { MemberRole, PlanTier, UserRole } from '@novira/shared';

export interface AuthedUser {
  id: bigint;
  email: string;
  role: UserRole;
  planTier: PlanTier;
  companyId: bigint | null;
  companyRole: MemberRole | null;
  isBlocked: boolean;
  isEmailVerified: boolean;
  creditsRemaining: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
      /** Set when the request authenticated via a share token instead of a session. */
      shareToken?: string;
    }
  }
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

export function signToken(user: { id: bigint; email: string; role: string }): string {
  const payload: TokenPayload = {
    sub: String(user.id),
    email: user.email,
    role: user.role as UserRole,
  };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '30d' });
}

async function loadUser(userId: bigint): Promise<AuthedUser | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      planTier: true,
      companyId: true,
      isBlocked: true,
      isEmailVerified: true,
      creditsRemaining: true,
      memberships: { select: { companyId: true, role: true, status: true } },
    },
  });
  if (!row) return null;
  const membership = row.memberships.find(
    (m) => m.companyId === row.companyId && m.status === 'active'
  );
  return {
    id: row.id,
    email: row.email,
    role: row.role as UserRole,
    planTier: row.planTier as PlanTier,
    companyId: row.companyId,
    companyRole: (membership?.role as MemberRole) ?? null,
    isBlocked: row.isBlocked,
    isEmailVerified: row.isEmailVerified,
    creditsRemaining: row.creditsRemaining,
  };
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') return null;
  return token;
}

/** Populates req.user when a valid token is present; never rejects. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env.jwtSecret) as TokenPayload;
    const user = await loadUser(BigInt(payload.sub));
    if (user && !user.isBlocked) req.user = user;
  } catch {
    /* An invalid token is simply an anonymous request here. */
  }
  next();
}

/** Requires a signed-in, non-blocked user. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) return next(ApiError.unauthorized());
  try {
    const payload = jwt.verify(token, env.jwtSecret) as TokenPayload;
    const user = await loadUser(BigInt(payload.sub));
    if (!user) return next(ApiError.unauthorized('Your account no longer exists.'));
    if (user.isBlocked) return next(ApiError.forbidden('This account has been blocked.'));
    req.user = user;
    return next();
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    return next(ApiError.unauthorized(expired ? 'Your session expired. Sign in again.' : 'Invalid session.'));
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden('Not available for your role.'));
    return next();
  };
}

export const requireSuperAdmin = requireRole('super_admin');

/** Company owners/admins, plus platform super admins. */
export function requireCompanyAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(ApiError.unauthorized());
  if (req.user.role === 'super_admin') return next();
  if (req.user.companyId && (req.user.companyRole === 'admin' || req.user.role === 'company_admin')) {
    return next();
  }
  return next(ApiError.forbidden('Team management is available to company owners and admins.'));
}
