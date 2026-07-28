import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The only React context the dance game's reward path needs.
 *
 * `TestApp` is the repository's full provider stack, and `NostrLoginProvider`
 * inside it renders `null` until an asynchronous storage read resolves — so
 * every assertion against it has to be awaited, which is a poor fit for the
 * synchronous DOM assertions the arcade's tests are built from. The tests here
 * mock `useCurrentUser` and `useNostr` at the module level instead, which leaves
 * a query client as the only thing that genuinely has to be provided.
 *
 * Test doubles (fake signer, fake writer, scriptable audio) live in
 * `test-doubles.ts`.
 */
export function QueryProviders({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
