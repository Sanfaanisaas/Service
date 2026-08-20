import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from 'next-themes';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/features/auth/AuthProvider';
import type { ReactNode } from 'react';
import { queryClient } from './query-client';

function ThemedToaster() {
  const { resolvedTheme } = useTheme();

  return (
      <Toaster
          theme={resolvedTheme === 'light' ? 'light' : 'dark'}
          richColors
          position="top-right"
      />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
        >
          <AuthProvider>
            {children}
            <ThemedToaster />
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
  );
}
