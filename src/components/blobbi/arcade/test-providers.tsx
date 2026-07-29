import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The only React context the arcade's reward path needs.
 *
 * `TestApp` is the repository's full provider stack, and `NostrLoginProvider`
 * inside it renders `null` until an asynchronous storage read resolves — so
 * every assertion against it has to be awaited, which is a poor fit for the
 * synchronous DOM assertions the arcade's tests are built from. The machine
 * tests mock `useCurrentUser` and `useNostr` at the module level instead, which
 * leaves a query client as the only thing that genuinely has to be provided.
 *
 * Shared by the dance, hockey and pool machine tests; test doubles (fake
 * signer, fake writer) live in `test-doubles.ts` beside this file.
 */
export function QueryProviders({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
