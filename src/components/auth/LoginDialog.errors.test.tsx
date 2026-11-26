/**
 * The extension (NIP-07) and bunker (NIP-46) logins are asynchronous. The
 * dialog awaits them: it closes only once the login succeeded, and a rejected
 * handshake is shown on the plate instead of being an unhandled rejection
 * behind an already-closed dialog (IS-07).
 *
 * The login actions are mocked: nothing here opens a relay or touches a key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import LoginDialog from './LoginDialog';

const actions = {
  nsec: vi.fn<(nsec: string) => void>(),
  bunker: vi.fn<(uri: string) => Promise<void>>(),
  extension: vi.fn<() => Promise<void>>(),
  logout: vi.fn<() => Promise<void>>(),
};

vi.mock('@/hooks/useLoginActions', () => ({ useLoginActions: () => actions }));

let onLogin: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderDialog() {
  render(<LoginDialog isOpen onClose={onClose} onLogin={onLogin} />);
}

function openTab(name: RegExp) {
  const trigger = screen.getByRole('tab', { name });
  // Radix tabs switch on mousedown/focus rather than click in jsdom.
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.focus(trigger);
  fireEvent.click(trigger);
}

beforeEach(() => {
  onLogin = vi.fn();
  onClose = vi.fn();
  for (const fn of Object.values(actions)) fn.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'nostr');
});

describe('LoginDialog: asynchronous logins', () => {
  it('bunker: stays open while connecting, closes only after success', async () => {
    const pending = deferred();
    actions.bunker.mockReturnValue(pending.promise);
    renderDialog();
    openTab(/bunker/i);
    fireEvent.change(screen.getByLabelText(/bunker uri/i), { target: { value: 'bunker://abc?relay=wss://relay.invalid' } });
    fireEvent.click(screen.getByRole('button', { name: /login with bunker/i }));

    expect(actions.bunker).toHaveBeenCalledWith('bunker://abc?relay=wss://relay.invalid');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /connecting/i })).toBeDisabled();

    await act(async () => pending.resolve());
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('bunker: a rejected handshake is shown and the dialog stays open', async () => {
    actions.bunker.mockRejectedValue(new Error('connect timeout'));
    renderDialog();
    openTab(/bunker/i);
    fireEvent.change(screen.getByLabelText(/bunker uri/i), { target: { value: 'bunker://abc' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /login with bunker/i }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/could not connect to the bunker/i);
    expect(onLogin).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /login with bunker/i })).toBeEnabled();

    // Editing the URI clears the message.
    fireEvent.change(screen.getByLabelText(/bunker uri/i), { target: { value: 'bunker://abcd' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('extension: a rejected NIP-07 request is shown and the dialog stays open', async () => {
    Object.defineProperty(window, 'nostr', { value: {}, configurable: true });
    actions.extension.mockRejectedValue(new Error('user rejected'));
    renderDialog();
    openTab(/extension/i);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /login with extension/i }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/extension did not sign you in/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('extension: success closes the dialog after the login resolved', async () => {
    Object.defineProperty(window, 'nostr', { value: {}, configurable: true });
    actions.extension.mockResolvedValue();
    renderDialog();
    openTab(/extension/i);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /login with extension/i }));
    });
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('extension: a missing extension is explained, not only logged', async () => {
    renderDialog();
    openTab(/extension/i);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /login with extension/i }));
    });
    expect(actions.extension).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/extension not found/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('secret key: an invalid key is shown, and the pasted text is never logged', async () => {
    const pasted = 'nsec1-not-a-real-key';
    actions.nsec.mockImplementation(() => {
      throw new Error(`Invalid nsec ${pasted}`);
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText(/nostr secret key/i), { target: { value: pasted } });
    fireEvent.click(screen.getByRole('button', { name: /enter island/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/not a valid nostr secret key/i);
    expect(onClose).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});
