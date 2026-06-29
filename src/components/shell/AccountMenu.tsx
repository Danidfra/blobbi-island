import { useState } from "react";
import { LogOut, UserIcon, UserPlus, PawPrint, Settings, ChevronDown } from "lucide-react";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { RelaySelector } from "@/components/RelaySelector";
import { CurrentBlobbiDisplay } from "@/components/blobbi/CurrentBlobbiDisplay";
import LoginDialog from "@/components/auth/LoginDialog";
import SignupDialog from "@/components/auth/SignupDialog";
import { LoginArea } from "@/components/auth/LoginArea";
import { useLoggedInAccounts, type Account } from "@/hooks/useLoggedInAccounts";
import { useBlobbis } from "@/hooks/useBlobbis";
import { useBlobbonautProfile } from "@/hooks/useBlobbonautProfile";
import { genUserName } from "@/lib/genUserName";

interface AccountMenuProps {
  /**
   * "dropdown" — desktop framed header (popover-style dropdown).
   * "sheet"    — mobile landscape / immersive (touch-friendly bottom sheet),
   *              opened from the in-canvas HUD where a tiny popover feels cramped.
   */
  variant?: "dropdown" | "sheet";
  /** Open the switch-Blobbi flow. The menu closes itself first. */
  onSwitchBlobbi?: () => void;
  className?: string;
}

/**
 * AccountMenu — the single home for account identity, current Blobbi / switch
 * Blobbi, relays/network, account switching and logout.
 *
 * Auth behavior is NOT rewritten: account switching/logout reuse the existing
 * `useLoggedInAccounts` hook (the same logic as the stable AccountSwitcher), and
 * the logged-out state reuses the stable <LoginArea /> login button. This
 * component only restyles and groups those controls into one cozy menu, and adds
 * the current-Blobbi section. Desktop renders a dropdown; mobile/immersive
 * renders a bottom sheet so it's readable and touch-friendly.
 */
export function AccountMenu({ variant = "dropdown", onSwitchBlobbi, className }: AccountMenuProps) {
  const { currentUser, otherUsers, setLogin, removeLogin } = useLoggedInAccounts();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [signupDialogOpen, setSignupDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Logged out: reuse the stable LoginArea login button unchanged.
  if (!currentUser) {
    return <LoginArea className={className} />;
  }

  const getDisplayName = (account: Account): string =>
    account.metadata.name ?? genUserName(account.pubkey);

  const closeSheet = () => setSheetOpen(false);

  const handleSwitchBlobbi = () => {
    closeSheet();
    onSwitchBlobbi?.();
  };

  const handleAddAccount = () => {
    closeSheet();
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
        closeSheet();
      }}
      onRemoveLogin={(id) => {
        removeLogin(id);
        closeSheet();
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
      {variant === "sheet" ? (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent
            side="bottom"
            data-block-move
            className="max-h-[85svh] overflow-y-auto rounded-t-3xl border-t-2 border-island-wood/30 bg-island-cream p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          >
            <SheetHeader className="text-left">
              <SheetTitle className="text-island-ink">Menu</SheetTitle>
            </SheetHeader>
            <div className="mt-3">{body}</div>
          </SheetContent>
        </Sheet>
      ) : (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
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
  variant: "dropdown" | "sheet";
}) {
  const { data: blobbis } = useBlobbis();
  const { data: profile } = useBlobbonautProfile();
  const currentCompanionId = profile?.currentCompanion;
  const currentBlobbi = currentCompanionId
    ? blobbis?.find((b) => b.id === currentCompanionId)
    : undefined;
  const blobbiName = currentBlobbi?.name?.trim();

  // Reusable row styling so the sheet and dropdown look the same. In the
  // dropdown we use DropdownMenuItem (keyboard nav); in the sheet we use plain
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

      <Divider />

      {/* Current Blobbi */}
      <SectionLabel>Current Blobbi</SectionLabel>
      <Row onClick={onSwitchBlobbi}>
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

      <Divider />

      {/* Network / settings */}
      <SectionLabel>
        <span className="inline-flex items-center gap-1.5">
          <Settings className="size-3.5" />
          Network
        </span>
      </SectionLabel>
      <div className="px-1 pb-1">
        <RelaySelector className="w-full" />
      </div>

      <Divider />

      {/* Account actions */}
      {otherUsers.length > 0 && <SectionLabel>Switch account</SectionLabel>}
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
  );
}
