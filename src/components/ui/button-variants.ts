import { cva } from "class-variance-authority"

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // ---- Cozy island game variants ----
        // Soft cream chip button (cancel / secondary actions in the game UI)
        soft:
          "bg-island-cream text-island-ink border border-island-wood/30 shadow-cozy-soft hover:bg-island-cream-2 active:scale-[0.97] transition-[transform,background-color] duration-150 ease-cozy",
        // Primary playful CTA — warm wood, rounded, gentle press
        playful:
          "bg-primary text-primary-foreground font-semibold rounded-2xl shadow-cozy-raised hover:brightness-105 active:scale-[0.97] transition-[transform,filter] duration-150 ease-cozy",
        // Success / play / go (leafy green)
        success:
          "bg-success text-success-foreground font-semibold rounded-2xl shadow-cozy-soft hover:brightness-105 active:scale-[0.97] transition-[transform,filter] duration-150 ease-cozy",
        // HUD pill — cream surface, soft wood edge, used in the game HUD/dock
        hud:
          "bg-island-cream/95 text-island-ink border border-island-wood/30 rounded-full shadow-cozy-soft hover:bg-island-cream active:scale-[0.96] transition-[transform,background-color] duration-150 ease-cozy",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        xl: "h-12 rounded-2xl px-8 text-base",
        icon: "h-10 w-10",
        "icon-lg": "h-12 w-12",
        pill: "h-9 rounded-full px-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)