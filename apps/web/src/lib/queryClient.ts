import { QueryClient } from '@tanstack/react-query';

/** Shared singleton so non-component code (e.g. the undo/redo stack) can invalidate queries too. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});
