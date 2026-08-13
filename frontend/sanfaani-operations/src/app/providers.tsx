import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/features/auth/AuthProvider';
import type { ReactNode } from 'react';
import { queryClient } from './query-client';
export function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}><AuthProvider>{children}<Toaster theme="dark" richColors position="top-right" /></AuthProvider></QueryClientProvider>;
}
