import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/features/auth/AuthProvider';
import type { ReactNode } from 'react';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 }, mutations: { retry: 0 } } });
export function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}><AuthProvider>{children}<Toaster theme="dark" richColors position="top-right" /></AuthProvider></QueryClientProvider>;
}
