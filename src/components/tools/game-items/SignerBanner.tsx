/**
 * The header strip: who is signing, whether that key is the official Blobbi
 * issuer, and which relays this tool reads and writes.
 *
 * It is always visible, never collapsible, and never abbreviated away on
 * mobile. Everything else in this page is an editor; this is the one part that
 * answers "whose name is about to go on this event?", and a publishing tool
 * that hides that behind a menu is a tool that will eventually publish
 * something under the wrong key.
 */

import { KeyRound, ShieldAlert, ShieldCheck, UserX } from 'lucide-react';

import { LoginArea } from '@/components/auth/LoginArea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { shortHex, type SignerIdentity } from '@/tools/game-items/signer-identity';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';

import { CopyButton } from './RawEventInspector';

const MODE_STYLES = {
  official: {
    icon: ShieldCheck,
    label: 'Official issuer',
    className:
      'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100',
  },
  'third-party': {
    icon: ShieldAlert,
    label: 'Third-party issuer',
    className:
      'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
  },
  unauthenticated: {
    icon: UserX,
    label: 'Not signed in',
    className: 'border-border bg-muted/50 text-foreground',
  },
} as const;

export interface SignerBannerProps {
  identity: SignerIdentity;
  relayUrls: readonly string[];
  className?: string;
}

export function SignerBanner({ identity, relayUrls, className }: SignerBannerProps) {
  const style = MODE_STYLES[identity.mode];
  const Icon = style.icon;

  return (
    <section
      className={cn(
        'rounded-2xl border px-4 py-3 shadow-sm',
        style.className,
        className,
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              {style.label}
              {identity.mode === 'official' && (
                <Badge variant="secondary" className="text-[10px]">
                  matches OFFICIAL_ITEM_ISSUER_PUBKEY
                </Badge>
              )}
            </p>

            {identity.pubkey ? (
              <div className="space-y-0.5 text-xs">
                <p className="flex items-center gap-1.5 break-all font-mono">
                  <KeyRound className="h-3 w-3 shrink-0" aria-hidden />
                  {identity.npub ?? '(npub unavailable)'}
                </p>
                <p className="font-mono opacity-80">{identity.shortHex}</p>
                {identity.mode === 'third-party' && (
                  <p className="max-w-prose pt-1 opacity-90">
                    You can publish under this key, but Blobbi Island only trusts
                    definitions signed by{' '}
                    <span className="font-mono">
                      {shortHex(OFFICIAL_ITEM_ISSUER_PUBKEY)}
                    </span>
                    , so the item will not appear in the game.
                  </p>
                )}
              </div>
            ) : (
              <p className="max-w-prose text-xs opacity-90">
                The editor, preview and inspectors all work signed out. Publishing
                needs an account, because an event has to be signed by somebody.
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {identity.npub && <CopyButton value={identity.npub} label="Copy npub" />}
          <LoginArea className="max-w-52" />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-current/10 pt-2 text-[11px] opacity-80">
        <span className="font-medium">Relays</span>
        {relayUrls.map((url) => (
          <Badge key={url} variant="outline" className="font-mono text-[10px]">
            {url.replace(/^wss:\/\//, '')}
          </Badge>
        ))}
      </div>
    </section>
  );
}
