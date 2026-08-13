import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { queryClient } from '@/app/query-client';
import type { Session } from '@supabase/supabase-js';
import { authConfigured, supabase } from '@/lib/supabase';
import { getCurrentUser, setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';

type Profile = Awaited<ReturnType<typeof getCurrentUser>>;
type AuthValue = { session: Session|null; profile: Profile|null; loading: boolean; configured: boolean; signOut: () => Promise<void> };
const AuthContext = createContext<AuthValue|null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session|null>(null);
  const [profile, setProfile] = useState<Profile|null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionResolved, setSessionResolved] = useState(false);
  useEffect(() => {
    // Generated requests already start with `/api`; accept either an origin or
    // an older `/api`-suffixed value without accidentally creating `/api/api`.
    const configuredApiUrl = import.meta.env.VITE_API_URL?.replace(/\/api\/?$/, '') || null;
    setBaseUrl(configuredApiUrl);
    setAuthTokenGetter(async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null);
    if (!supabase) { setSessionResolved(true); setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setSessionResolved(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setSessionResolved(true); });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) { setProfile(null); if (sessionResolved) setLoading(false); return; }
    setLoading(true);
    getCurrentUser().then(setProfile).catch(() => setProfile(null)).finally(() => setLoading(false));
  }, [session?.access_token, sessionResolved]);
  const value = useMemo(() => ({ session, profile, loading, configured: authConfigured, signOut: async () => {
    await supabase?.auth.signOut();
    setSession(null);
    setProfile(null);
    setLoading(false);
    queryClient.clear();
  } }), [session, profile, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
