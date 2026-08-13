import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '@shared/contracts';
import { api } from '@/lib/api';
import { authConfigured, supabase } from '@/lib/supabase';

type Profile = { id: string; appUserId: string; email: string; role: UserRole; customerId?: string };
type AuthValue = { session: Session|null; profile: Profile|null; loading: boolean; configured: boolean; signOut: () => Promise<void> };
const AuthContext = createContext<AuthValue|null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session|null>(null);
  const [profile, setProfile] = useState<Profile|null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) { setProfile(null); setLoading(false); return; }
    setLoading(true);
    api.get<Profile>('/me').then(setProfile).catch(() => setProfile(null)).finally(() => setLoading(false));
  }, [session?.access_token]);
  const value = useMemo(() => ({ session, profile, loading, configured: authConfigured, signOut: async () => { await supabase?.auth.signOut(); } }), [session, profile, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
