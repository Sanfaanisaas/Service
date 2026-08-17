import { createClient } from '@supabase/supabase-js';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { AppUser } from '../models/index.js';
import { audit } from './common.js';

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type StaffInviteInput = {
  email: string;
  name?: string;
  role: 'staff';
};

function inviteError(error: { code?: string; message?: string; status?: number }) {
  const duplicate = error.code === 'email_exists'
    || error.code === 'user_already_exists'
    || error.status === 422
    || /already (?:been )?registered|already exists/i.test(error.message ?? '');
  return duplicate
    ? new ApiError(409, 'OPERATIONAL_USER_EXISTS', 'An account already exists for this email address.')
    : new ApiError(502, 'STAFF_INVITE_FAILED', 'The staff invitation could not be sent. Please try again.');
}

export async function inviteStaff(input: StaffInviteInput, actorId: string) {
  const email = input.email.trim().toLowerCase();
  const name = input.name?.trim() || undefined;
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${env.CLIENT_URL.replace(/\/$/, '')}/reset-password`,
    data: { ...(name ? { name } : {}) },
  });
  if (error) throw inviteError(error);
  if (!data.user?.id) {
    throw new ApiError(502, 'STAFF_INVITE_FAILED', 'The staff invitation could not be sent. Please try again.');
  }

  const databaseSession = await mongoose.startSession();
  let appUser: InstanceType<typeof AppUser> | null = null;
  try {
    await databaseSession.withTransaction(async () => {
      const updatedUser = await AppUser.findOneAndUpdate(
        { supabaseUserId: data.user!.id },
        {
          $set: { email, name, role: input.role, active: true },
          $unset: { customerId: 1 },
        },
        { new: true, upsert: true, runValidators: true, session: databaseSession },
      );
      if (!updatedUser) throw new Error('Invited staff record was not created.');
      appUser = updatedUser;
      await audit(actorId, 'STAFF_INVITED', 'user', updatedUser.id, {
        targetUser: updatedUser.id,
        initialRole: input.role,
      }, databaseSession);
    });
  } catch (databaseError) {
    // Supabase is external to MongoDB. Remove the just-created identity when
    // the transactional application record/audit cannot be committed.
    await supabase.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    throw databaseError;
  } finally {
    await databaseSession.endSession();
  }

  if (!appUser) throw new ApiError(500, 'STAFF_INVITE_FAILED', 'The staff invitation could not be recorded.');
  return appUser;
}
