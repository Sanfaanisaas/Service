import { createClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '../contracts.js';
import { env } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { AppUser, Customer } from '../models/index.js';

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

declare global {
  namespace Express {
    interface Request {
      authUser?: { id: string; appUserId: string; email: string; role: UserRole; active: boolean; customerId?: string };
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'A valid SANFAANI session is required.');
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user?.email) throw new ApiError(401, 'INVALID_TOKEN', 'Your session has expired. Please sign in again.');
    const email = data.user.email.toLowerCase();
    const initialRole: UserRole = env.SANFAANI_ADMIN_EMAIL?.toLowerCase() === email ? 'admin' : 'customer';
    const appUser = await AppUser.findOneAndUpdate(
      { supabaseUserId: data.user.id },
      { $set: { email, name: data.user.user_metadata?.name }, $setOnInsert: { role: initialRole } },
      { new: true, upsert: true, runValidators: true },
    );
    if (!appUser.get('active')) {
      throw new ApiError(403, 'USER_INACTIVE', 'This SANFAANI account has been deactivated.');
    }
    if (appUser.get('role') === 'customer' && !appUser.get('customerId')) {
      const customer = await Customer.findOneAndUpdate(
        { email },
        { $setOnInsert: { name: data.user.user_metadata?.name || email.split('@')[0], email } },
        { new: true, upsert: true, runValidators: true },
      );
      appUser.set('customerId', customer.id);
      await appUser.save();
    }
    req.authUser = {
      id: data.user.id, appUserId: appUser.id, email, role: appUser.get('role') as UserRole, active: true,
      customerId: appUser.get('customerId')?.toString(),
    };
    next();
  } catch (error) { next(error); }
}

export function allow(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.authUser) return next(new ApiError(401, 'UNAUTHORIZED', 'Sign in is required.'));
    if (!roles.includes(req.authUser.role)) return next(new ApiError(403, 'FORBIDDEN', 'Your role cannot perform this operation.'));
    next();
  };
}
