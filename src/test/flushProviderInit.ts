import { act } from '@testing-library/react';

/**
 * Flush the one asynchronous update that mounting the app's providers schedules.
 *
 * `NostrLoginProvider` reads its stored logins through a promise, so its first
 * state update — `null` → the parsed login list — always lands one microtask
 * AFTER `render()` returns. A test whose body is synchronous hands control back
 * to the runner before that microtask runs, so React applies the update outside
 * `act(...)` and warns. Tests that already await something (`findBy*`,
 * `waitFor`) flush it inside Testing Library's own `act(...)` wrapper, which is
 * why only the synchronous ones warn.
 *
 * Awaiting this straight after `render()` is that same flush, made explicit. It
 * changes nothing about what a test asserts — only that the providers have
 * finished initialising by the time the test ends.
 *
 * It lives beside `TestApp` rather than in it so that file keeps exporting
 * components only (`react-refresh/only-export-components`), and applies equally
 * to tests that render the real `<App />`, which mounts the same provider.
 */
export async function flushProviderInit(): Promise<void> {
  await act(async () => {});
}
