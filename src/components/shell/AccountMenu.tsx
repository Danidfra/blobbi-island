import { useState } from "react";
import {
  LogOut,
  UserIcon,
  UserPlus,
  PawPrint,
  Settings,
  ChevronDown,
  Wrench,
  Palette,
  Bug,
  CloudSun,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { RelaySelector } from "@/components/RelaySelector";
import { CurrentBlobbiDisplay } from "@/components/blobbi/CurrentBlobbiDisplay";
import LoginDialog from "@/components/auth/LoginDialog";
import SignupDialog from "@/components/auth/SignupDialog";
import { LoginArea } from "@/components/auth/LoginArea";
import { useLoggedInAccounts, type Account } from "@/hooks/useLoggedInAccounts";
import { useBlobbis } from "@/hooks/useBlobbis";
import { getBlobbiDisplayName } from "@/lib/blobbi-legacy";
import { useBlobbonautProfile } from "@/hooks/useBlobbonautProfile";
import { useDebugOverlays } from "@/contexts/DebugOverlaysContext";
import { setIslandSkyDev, useIslandSkyDev } from "@/lib/island-sky-dev";
import { useFullscreenPortalContainer } from "@/contexts/FullscreenPortalContext";
import { ThemePicker } from "@/components/shell/ThemePicker";
import { SettingsRow, SettingsSection } from "@/components/ui/settings-row";
import { useTheme } from "@/hooks/useTheme";
import { genUserName } from "@/lib/genUserName";

interface AccountMenuProps {
  /**
   * "dropdown" — desktop framed header (popover-style dropdown).
   * "modal"    — mobile landscape / immersive / desktop fullscreen. Opens as a
   *              compact, centered, cozy game modal (not a bottom drawer or a
   *              cramped popover) since vertical space is limited there.
   */
  variant?: "dropdown" | "modal";
  /** Open the switch-Blobbi flow. The menu closes itself first. */
  onSwitchBlobbi?: () => void;
  className?: string;
}

/**
 * AccountMenu — the single home for account identity, current Blobbi / switch
 * Blobbi, relays/network, account switching, logout, and (in dev) the developer
 * tools toggle.
 *
 * Auth behavior is NOT rewritten: account switching/logout reuse the existing
 * `useLoggedInAccounts` hook (the same logic as the stable AccountSwitcher), and
 * the logged-out state reuses the stable <LoginArea /> login button. This
 * component only restyles and groups those controls into one cozy menu.
 *
 * Presentation:
 *   - Desktop framed: a header dropdown/popover.
 *   - Immersive (mobile landscape) and desktop fullscreen: a centered modal —
 *     compact, touch-friendly, width-controlled, scrollable, with a backdrop.
 *
 * Fullscreen correctness: both surfaces portal into the active fullscreen root
 * element (via FullscreenPortalContext) so they render ABOVE the fullscreen
 * layer instead of invisibly into document.body.
 */
export function AccountMenu({ variant = "dropdown", onSwitchBlobbi, className }: AccountMenuProps) {
  const { currentUser, otherUsers, setLogin, removeLogin } = useLoggedInAccounts();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [signupDialogOpen, setSignupDialogOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const portalContainer = useFullscreenPortalContainer();

  // Logged out: reuse the stable LoginArea login button unchanged.
  if (!currentUser) {
    return <LoginArea className={className} />;
  }

  const getDisplayName = (account: Account): string =>
    account.metadata.name ?? genUserName(account.pubkey);

  const closeModal = () => setModalOpen(false);

  const handleSwitchBlobbi = () => {
    closeModal();
    onSwitchBlobbi?.();
  };

  const handleAddAccount = () => {
    closeModal();
    setLoginDialogOpen(true);
  };

  // The picker is its own modal, so the menu gets out of its way first —
  // otherwise the dropdown's outside-click handling and the modal's focus trap
  // fight over the same pointer events.
  const handleOpenThemePicker = () => {
    closeModal();
    setThemePickerOpen(true);
  };

  // The shared menu body — identical option set for both desktop & mobile.
  const body = (
    <AccountMenuBody
      currentUser={currentUser}
      otherUsers={otherUsers}
      getDisplayName={getDisplayName}
      onSetLogin={(id) => {
        setLogin(id);
        closeModal();
      }}
      onRemoveLogin={(id) => {
        removeLogin(id);
        closeModal();
      }}
      onAddAccount={handleAddAccount}
      onSwitchBlobbi={handleSwitchBlobbi}
      onOpenThemePicker={handleOpenThemePicker}
      variant={variant}
    />
  );

  const trigger = (
    <button
      type="button"
      aria-label="Account menu"
      className={cn(
        "inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-2",
        "border border-island-wood/30 bg-island-cream/95 text-island-wood-dark shadow-cozy-soft",
        "transition-transform duration-150 ease-cozy hover:brightness-105 active:scale-95",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Avatar className="size-8 border-2 border-island-wood/30">
        <AvatarImage src={currentUser.metadata.picture} alt={getDisplayName(currentUser)} />
        <AvatarFallback className="bg-island-sand text-island-wood-dark blobbi-text">
          {getDisplayName(currentUser).charAt(0)}
        </AvatarFallback>
      </Avatar>
      <ChevronDown className="size-4 shrink-0 opacity-70" />
    </button>
  );

  return (
    <>
      {variant === "modal" ? (
        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogTrigger asChild>{trigger}</DialogTrigger>
          <DialogContent
            container={portalContainer}
            data-block-move
            onPointerDown={(e) => e.stopPropagation()}
            className="flex max-h-[88svh] w-[min(94vw,32rem)] flex-col gap-0 overflow-hidden rounded-3xl border-2 border-island-wood/30 bg-island-cream p-0"
          >
            <DialogHeader className="shrink-0 border-b border-island-wood/15 px-4 py-2.5 text-left">
              <DialogTitle className="text-base text-island-ink">Menu</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{body}</div>
          </DialogContent>
        </Dialog>
      ) : (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent
            container={portalContainer}
            align="end"
            data-block-move
            className="w-72 rounded-2xl border-2 border-island-wood/30 bg-island-cream p-2 shadow-cozy-raised animate-scale-in"
          >
            {body}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <LoginDialog
        isOpen={loginDialogOpen}
        onClose={() => setLoginDialogOpen(false)}
        onLogin={() => {
          setLoginDialogOpen(false);
          setSignupDialogOpen(false);
        }}
        onSignup={() => setSignupDialogOpen(true)}
      />
      <SignupDialog isOpen={signupDialogOpen} onClose={() => setSignupDialogOpen(false)} />
      <ThemePicker open={themePickerOpen} onOpenChange={setThemePickerOpen} />
    </>
  );
}

function AccountMenuBody({
  currentUser,
  otherUsers,
  getDisplayName,
  onSetLogin,
  onRemoveLogin,
  onAddAccount,
  onSwitchBlobbi,
  onOpenThemePicker,
  variant,
}: {
  currentUser: Account;
  otherUsers: Account[];
  getDisplayName: (a: Account) => string;
  onSetLogin: (id: string) => void;
  onRemoveLogin: (id: string) => void;
  onAddAccount: () => void;
  onSwitchBlobbi: () => void;
  onOpenThemePicker: () => void;
  variant: "dropdown" | "modal";
}) {
  const { data: blobbis } = useBlobbis();
  const { data: profile } = useBlobbonautProfile();
  const { isDevMode, showDebugOverlays, setShowDebugOverlays } = useDebugOverlays();
  const { theme } = useTheme();
  const skyDev = useIslandSkyDev();
  const currentCompanionId = profile?.currentCompanion;
  const currentBlobbi = currentCompanionId
    ? blobbis?.find((b) => b.id === currentCompanionId)
    : undefined;
  const blobbiName = currentBlobbi ? getBlobbiDisplayName(currentBlobbi) : undefined;

  /*
    Every row in this menu is a `SettingsRow`.

    It used to hand-roll one: a `rowClass` string, a `Row` component switching
    between `DropdownMenuItem` and a bare `<button>`, and a `Divider` switching
    between `DropdownMenuSeparator` and a `<div>` — and four more spellings of
    the same row lived elsewhere in the game. Keeping `DropdownMenuItem` was
    what forced the split, and it bought nothing here: the menu's rows either
    open a surface or perform an action, and Radix's roving focus is not worth
    two implementations of one row.
  */
  return (
    // The modal presentation is used in mobile landscape and desktop
    // fullscreen, where vertical space is the scarce resource — so its sections
    // flow into two columns once there is width for them. The dropdown is
    // 288px wide and always stacks. This is the only place `variant` still
    // changes anything; the rows themselves are now identical in both.
    <div
      className={cn(
        "space-y-3",
        variant === "modal" && "sm:grid sm:grid-cols-2 sm:items-start sm:gap-3 sm:space-y-0",
      )}
    >
      <SettingsSection>
        {/* Identity is a row too, just not an actionable one — the trailing
            slot carries the state instead of a control. */}
        <SettingsRow
          icon={
            <Avatar className="size-9">
              <AvatarImage src={currentUser.metadata.picture} alt="" />
              <AvatarFallback className="bg-island-sand text-island-wood-dark">
                {getDisplayName(currentUser).charAt(0)}
              </AvatarFallback>
            </Avatar>
          }
          label={getDisplayName(currentUser)}
          description="Signed in"
        />

        <SettingsRow
          icon={
            <span className="flex size-9 items-center justify-center overflow-hidden rounded-full">
              <CurrentBlobbiDisplay
                size="sm"
                showFallback
                transparent
                showAccessories={false}
                className="size-full"
              />
            </span>
          }
          label={blobbiName || "No Blobbi selected"}
          description="Switch Blobbi"
          onClick={onSwitchBlobbi}
          trailing={<PawPrint aria-hidden className="size-4 text-island-purple" />}
        />
      </SettingsSection>

      <SettingsSection label="Appearance" icon={<Palette />}>
        <SettingsRow
          icon={theme.emoji}
          label="Theme"
          description={theme.name}
          onClick={onOpenThemePicker}
        />
      </SettingsSection>

      <SettingsSection label="Network" icon={<Settings />}>
        <div className="px-1.5 py-1">
          <RelaySelector className="w-full" />
        </div>
      </SettingsSection>

      <SettingsSection label="Account" icon={<UserIcon />}>
        {otherUsers.map((user) => (
          <SettingsRow
            key={user.id}
            icon={
              <Avatar className="size-9">
                <AvatarImage src={user.metadata.picture} alt="" />
                <AvatarFallback className="bg-island-sand text-island-wood-dark">
                  {getDisplayName(user)?.charAt(0) || <UserIcon className="size-4" />}
                </AvatarFallback>
              </Avatar>
            }
            label={getDisplayName(user)}
            description="Switch to this account"
            onClick={() => onSetLogin(user.id)}
          />
        ))}

        <SettingsRow
          icon={<UserPlus />}
          label="Add another account"
          onClick={onAddAccount}
        />
        <SettingsRow
          icon={<LogOut />}
          label="Log out"
          tone="danger"
          onClick={() => onRemoveLogin(currentUser.id)}
        />
      </SettingsSection>

      {/* Developer tools — dev/local builds only; never rendered in production. */}
      {/* `import.meta.env.DEV` is a literal `false` in a build, so the whole
          branch is dropped from the bundle rather than merely rendering nothing.
          `isDevMode` is the same value re-exported from a module, which Rollup
          cannot fold across the boundary — keeping both means the runtime gate is
          unchanged AND the markup stops shipping. */}
      {import.meta.env.DEV && isDevMode && (
        <SettingsSection label="Developer tools" icon={<Wrench />}>
          {/* The Switch is the control, so the ROW is not a button — otherwise
              the toggle would be an interactive element inside another one, and
              tapping the row would fight the toggle. */}
          <SettingsRow
            icon={<Bug />}
            label="Debug overlays"
            description="Boundaries, blockers & position"
            trailing={
              <Switch
                checked={showDebugOverlays}
                onCheckedChange={setShowDebugOverlays}
                aria-label="Toggle debug overlays"
              />
            }
          />
          {/* Opens the day/night sky harness inside the live world, so the sky is
              judged against the real Blobbi and real remote players rather than a
              replica scene. See src/components/sky/IslandSkyDevPanel.tsx. */}
          <SettingsRow
            icon={<CloudSun />}
            label="Sky controls"
            description="Scrub the island day & night"
            trailing={
              <Switch
                checked={skyDev.panelOpen}
                onCheckedChange={(open) => setIslandSkyDev({ panelOpen: open })}
                aria-label="Toggle sky dev controls"
              />
            }
          />
        </SettingsSection>
      )}
    </div>
  );
}
