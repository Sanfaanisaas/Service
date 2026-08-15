import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    // Operational writes must fail visibly while offline, never queue and
    // replay later when the operator may no longer be on the same handoff.
    mutations: { retry: 0, networkMode: 'always' },
  },
});
