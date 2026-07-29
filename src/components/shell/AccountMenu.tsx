import { useState } from "react";
import { LogOut, UserIcon, UserPlus, PawPrint, Settings, ChevronDown, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
    </>
  );
}

/** Section heading used inside the menu. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-island-ink-soft">
      {children}
    </div>
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
  variant,
}: {
  currentUser: Account;
  otherUsers: Account[];
  getDisplayName: (a: Account) => string;
  onSetLogin: (id: string) => void;
  onRemoveLogin: (id: string) => void;
  onAddAccount: () => void;
  onSwitchBlobbi: () => void;
  variant: "dropdown" | "modal";
}) {
  const { data: blobbis } = useBlobbis();
  const { data: profile } = useBlobbonautProfile();
  const { isDevMode, showDebugOverlays, setShowDebugOverlays } = useDebugOverlays();
  const skyDev = useIslandSkyDev();
  const currentCompanionId = profile?.currentCompanion;
  const currentBlobbi = currentCompanionId
    ? blobbis?.find((b) => b.id === currentCompanionId)
    : undefined;
  const blobbiName = currentBlobbi ? getBlobbiDisplayName(currentBlobbi) : undefined;

  // Reusable row styling so the modal and dropdown look the same. In the
  // dropdown we use DropdownMenuItem (keyboard nav); in the modal we use plain
  // buttons (touch).
  const rowClass =
    "flex w-full items-center gap-2 cursor-pointer rounded-md p-2 text-left hover:bg-island-cream-2";

  const Row = ({
    onClick,
    children,
    className,
  }: {
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
  }) =>
    variant === "dropdown" ? (
      <DropdownMenuItem onClick={onClick} className={cn(rowClass, className)}>
        {children}
      </DropdownMenuItem>
    ) : (
      <button type="button" onClick={onClick} className={cn(rowClass, className)}>
        {children}
      </button>
    );

  const Divider = () =>
    variant === "dropdown" ? (
      <DropdownMenuSeparator />
    ) : (
      <div className="my-2 h-px bg-island-wood/15" />
    );

  return (
    <div className="space-y-1">
      {/* Top row: identity + current Blobbi. In the wider modal these sit side
          by side to cut vertical scrolling; in the dropdown they stack. */}
      <div className={cn(variant === "modal" && "grid grid-cols-2 gap-2")}>
        {/* Current account identity */}
        <div className="flex items-center gap-3 px-2 py-1.5">
          <Avatar className="size-10 border-2 border-island-wood/30">
            <AvatarImage src={currentUser.metadata.picture} alt={getDisplayName(currentUser)} />
            <AvatarFallback className="bg-island-sand text-island-wood-dark blobbi-text">
              {getDisplayName(currentUser).charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-island-ink">
              {getDisplayName(currentUser)}
            </p>
            <p className="truncate text-xs text-island-ink-soft">Signed in</p>
          </div>
        </div>

        {variant === "dropdown" && <Divider />}

        {/* Current Blobbi */}
        {variant === "dropdown" && <SectionLabel>Current Blobbi</SectionLabel>}
        <Row onClick={onSwitchBlobbi} className={cn(variant === "modal" && "!my-0")}>
          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-island-wood/30 bg-island-cream-2">
            <CurrentBlobbiDisplay
              size="sm"
              showFallback
              transparent
              showAccessories={false}
              className="size-full"
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-island-ink">
              {blobbiName || "No Blobbi selected"}
            </p>
            <p className="truncate text-xs text-island-ink-soft">Switch Blobbi</p>
          </div>
          <PawPrint className="size-4 shrink-0 text-island-purple" />
        </Row>
      </div>

      <Divider />

      {/* Network / settings */}
      <div className={cn(variant === "modal" && "flex items-center gap-2")}>
        <SectionLabel>
          <span className="inline-flex items-center gap-1.5">
            <Settings className="size-3.5" />
            Network
          </span>
        </SectionLabel>
        <div className={cn("px-1 pb-1", variant === "modal" && "min-w-0 flex-1 pb-0")}>
          <RelaySelector className="w-full" />
        </div>
      </div>

      <Divider />

      {/* Account actions — in the modal these flow in a 2-col grid to stay compact. */}
      {otherUsers.length > 0 && <SectionLabel>Switch account</SectionLabel>}
      <div className={cn(variant === "modal" && "grid grid-cols-2 gap-1")}>
        {otherUsers.map((user) => (
          <Row key={user.id} onClick={() => onSetLogin(user.id)}>
            <Avatar className="size-8 border border-island-wood/30">
              <AvatarImage src={user.metadata.picture} alt={getDisplayName(user)} />
              <AvatarFallback className="bg-island-sand text-island-wood-dark blobbi-text">
                {getDisplayName(user)?.charAt(0) || <UserIcon />}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-island-ink">
              {getDisplayName(user)}
            </span>
          </Row>
        ))}

        <Row onClick={onAddAccount}>
          <UserPlus className="size-4 shrink-0 text-island-purple" />
          <span className="text-sm text-island-ink">Add another account</span>
        </Row>
        <Row onClick={() => onRemoveLogin(currentUser.id)} className="text-red-500 hover:bg-red-50">
          <LogOut className="size-4 shrink-0" />
          <span className="text-sm">Log out</span>
        </Row>
      </div>

      {/* Developer tools — dev/local builds only; never rendered in production. */}
      {/* `import.meta.env.DEV` is a literal `false` in a build, so the whole
          branch is dropped from the bundle rather than merely rendering nothing.
          `isDevMode` is the same value re-exported from a module, which Rollup
          cannot fold across the boundary — keeping both means the runtime gate is
          unchanged AND the markup stops shipping. */}
      {import.meta.env.DEV && isDevMode && (
        <>
          <Divider />
          <SectionLabel>
            <span className="inline-flex items-center gap-1.5">
              <Wrench className="size-3.5" />
              Developer tools
            </span>
          </SectionLabel>
          {/* Plain label+switch row (no onClick row wrapper, so toggling never
              closes the menu and the control stays put while on or off). */}
          <label className="flex w-full items-center gap-2 rounded-md p-2 text-left cursor-pointer hover:bg-island-cream-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-island-ink">Debug overlays</p>
              <p className="truncate text-xs text-island-ink-soft">
                Boundaries, blockers &amp; position
              </p>
            </div>
            <Switch
              checked={showDebugOverlays}
              onCheckedChange={setShowDebugOverlays}
              aria-label="Toggle debug overlays"
            />
          </label>
          {/* Opens the day/night sky harness inside the live world, so the sky is
              judged against the real Blobbi and real remote players rather than a
              replica scene. See src/components/sky/IslandSkyDevPanel.tsx. */}
          <label className="flex w-full items-center gap-2 rounded-md p-2 text-left cursor-pointer hover:bg-island-cream-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-island-ink">Sky controls</p>
              <p className="truncate text-xs text-island-ink-soft">
                Scrub the island day &amp; night
              </p>
            </div>
            <Switch
              checked={skyDev.panelOpen}
              onCheckedChange={(open) => setIslandSkyDev({ panelOpen: open })}
              aria-label="Toggle sky dev controls"
            />
          </label>
        </>
      )}
    </div>
  );
}
