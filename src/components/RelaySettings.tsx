import { useState, useSyncExternalStore } from "react";
import { Plus, X } from "lucide-react";
import { useNostr } from "@nostrify/react";
import { useQueryClient } from "@tanstack/react-query";

import { Switch } from "@/components/ui/switch";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { IslandRelayPool } from "@/relays/island-relay-pool";
import { allRelays } from "@/relays/island-flows";

import { RelaySelector } from "@/components/RelaySelector";
import { useAppContext } from "@/hooks/useAppContext";
import { useIslandSafetyPolicy } from "@/safety";
import { isEgressAllowed } from "@/external-egress";
import { relaySelection, withSecondary, withoutSecondary } from "@/relays/relay-config";
import { normalizeRelayUrl } from "@/relays/relay-routing";
import { describeRelayStatus, relayStatusStore, type RelayStatus } from "@/relays/relay-status";
import { cn } from "@/lib/utils";

/**
 * The Network section of the account menu: which relay is the main one, which
 * relays are read and written beside it, and what each of them last did.
 *
 * The Island reads from all of these and merges the answers, and writes every
 * event to all of them. So a relay that is down, or that refuses this account
 * (the Blobbi relay's write list, during its pilot), does not stop the game:
 * it shows here as "syncing later" or "not accepting your saves", and the
 * other relays carry on.
 *
 * Reading from several relays never copies anything between them. Copying a
 * player's EXISTING saves to the relays that lack them is a separate choice,
 * made here, per account, with the destinations spelled out (`CopySavesChoice`
 * below). Until it is made the Island only reads, and writes only what the
 * player does from then on.
 *
 * Changing relays is gated by the experience's `relay-management` capability,
 * at the writer (`AppProvider.updateConfig`). This component only hides the
 * controls; where the capability is absent it shows nothing at all, as
 * `RelaySelector` does.
 */
export function RelaySettings({ className }: { className?: string }) {
  const { config, updateConfig } = useAppContext();
  const policy = useIslandSafetyPolicy();
  const statuses = useSyncExternalStore(relayStatusStore.subscribe, relayStatusStore.getSnapshot);
  const [draft, setDraft] = useState("");

  if (!isEgressAllowed(policy, "relay-management")) return null;

  const { primary, secondaries } = relaySelection(config);
  const candidate = normalizeRelayUrl(draft.includes("://") ? draft : `wss://${draft.trim()}`);
  const canAdd = !!candidate && draft.trim() !== "" && candidate !== primary && !secondaries.includes(candidate);

  const add = () => {
    if (!canAdd || !candidate) return;
    updateConfig((current) => withSecondary(current, candidate));
    setDraft("");
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-1.5">
        <p className="px-1 text-xs font-semibold text-island-ink">Main relay</p>
        <RelaySelector className="w-full" />
        <RelayStatusLine status={statuses[primary]} />
      </div>

      <div className="space-y-1.5">
        <p className="px-1 text-xs font-semibold text-island-ink">Also saved to</p>
        {secondaries.length === 0 ? (
          <p className="px-1 text-xs text-island-ink-soft">No other relay. Your Blobbi is saved to the main relay only.</p>
        ) : (
          <ul className="space-y-1">
            {secondaries.map((relay) => (
              <li key={relay} className="rounded-lg border border-island-wood/25 bg-island-cream px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-island-ink">
                    {relay.replace(/^wss?:\/\//, "")}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${relay}`}
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-island-ink-soft hover:bg-island-wood/10 hover:text-island-ink"
                    onClick={() => updateConfig((current) => withoutSecondary(current, relay))}
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </div>
                <RelayStatusLine status={statuses[relay]} />
              </li>
            ))}
          </ul>
        )}

        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="wss://another.relay"
            aria-label="Add a relay"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-island-wood/30 bg-island-cream px-2.5 py-1.5 text-xs text-island-ink placeholder:text-island-ink-soft/70"
          />
          <button
            type="submit"
            disabled={!canAdd}
            aria-label="Add relay"
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-island-wood/30 text-island-ink disabled:opacity-40"
          >
            <Plus aria-hidden className="size-4" />
          </button>
        </form>
      </div>

      <CopySavesChoice relays={allRelays({ primary, secondaries })} />
    </div>
  );
}

const noSubscription = () => () => {};
const noVersion = () => 0;

/**
 * The account's choice to have its existing saves copied between its relays.
 *
 * Off by default, and per account: turning it on for one login says nothing
 * about another. The relays listed are exactly the ones that will be written
 * to; a relay added afterwards is not covered until the player comes back and
 * includes it, which the "Include" button does.
 */
function CopySavesChoice({ relays }: { relays: string[] }) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const pool = nostr instanceof IslandRelayPool ? nostr : null;
  useSyncExternalStore(pool?.subscribeConsent ?? noSubscription, pool?.getConsentVersion ?? noVersion);

  if (!pool || !user) return null;
  const pubkey = user.pubkey;
  const enabled = pool.consent.isEnabled(pubkey);
  const uncovered = enabled ? pool.consent.uncovered(pubkey, relays) : [];
  const covered = enabled ? relays.filter((relay) => !uncovered.includes(relay)) : relays;
  const short = (relay: string) => relay.replace(/^wss?:\/\//, "");

  const turnOn = () => {
    pool.consent.enable(pubkey, relays);
    // Read again, so what each relay is missing is found now rather than at the next refresh.
    void queryClient.invalidateQueries();
  };

  return (
    <div className="space-y-1.5 rounded-lg border border-island-wood/25 bg-island-cream px-2.5 py-2">
      <div className="flex items-center gap-2">
        <label htmlFor="copy-existing-saves" className="min-w-0 flex-1 text-xs font-semibold text-island-ink">
          Copy my existing saves between these relays
        </label>
        <Switch
          id="copy-existing-saves"
          checked={enabled}
          onCheckedChange={(next) => (next ? turnOn() : pool.consent.disable(pubkey))}
        />
      </div>
      <p className="text-[11px] leading-snug text-island-ink-soft">
        {enabled
          ? "On. Saves this account already has are copied, unchanged, to whichever of these relays is missing them:"
          : "Off. The Island reads from all your relays and only sends what you do from now on. Turn this on to copy this account\u2019s earlier saves (Blobbis, profile, inventory), unchanged, to whichever of these relays is missing them:"}
      </p>
      <ul className="text-[11px] leading-snug text-island-ink">
        {covered.map((relay) => (
          <li key={relay} className="truncate">{short(relay)}</li>
        ))}
      </ul>
      {uncovered.length > 0 ? (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-island-ink-soft">
            Not included yet: {uncovered.map(short).join(", ")}
          </p>
          <button
            type="button"
            className="shrink-0 rounded-full border border-island-wood/30 px-2.5 py-1 text-[11px] font-semibold text-island-ink"
            onClick={turnOn}
          >
            Include
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** One relay's last word, in a line. Says nothing until the relay has been written to. */
function RelayStatusLine({ status }: { status: RelayStatus | undefined }) {
  const line = describeRelayStatus(status);
  if (!line) return null;
  return (
    <p
      className={cn("px-1 text-[11px] leading-snug", line.tone === "warn" ? "text-island-danger" : "text-island-ink-soft")}
      title={line.detail}
    >
      {line.text}
    </p>
  );
}
