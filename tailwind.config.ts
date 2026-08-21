import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
		// The @blobbi/react renderer implements its canonical square box with
		// literal Tailwind classes (BLOBBI_RENDER_SIZE_CLASSES) so callers can
		// still override it through `className` via tailwind-merge. Those classes
		// live in the workspace package, so the JIT scanner must see it or every
		// Blobbi renders in a zero-sized box.
		//
		// Named explicitly rather than globbed as `packages/*`: only packages the
		// production bundle actually renders belong in the production CSS scan.
		// `packages/blobbi-react-consumer` is a test-only fixture, and letting its
		// class names reach the shipped stylesheet would be dead weight nobody
		// notices. A new renderer package is a deliberate line here.
		// Asserted by packages/blobbi-react/src/package-css.test.ts.
		"./packages/blobbi-react/src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		extend: {
			fontFamily: {
				sans: ['Comfortaa', 'system-ui', 'sans-serif'],
			},
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				success: {
					DEFAULT: 'hsl(var(--success))',
					foreground: 'hsl(var(--success-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				// ── The Island palette ────────────────────────────────────────
				// Every entry reads the ACTIVE THEME rather than a literal, which
				// is what makes `text-island-ink`, `bg-island-cream` and
				// `border-island-wood/30` — some 650 call sites across the game —
				// switch with the theme without a single component edit.
				//
				// `<alpha-value>` is the placeholder Tailwind substitutes when a
				// class carries an opacity modifier (`/30` → `0.3`) and replaces
				// with `1` otherwise. Dropping it would silently break every
				// `-island-*/NN` class in the codebase.
				//
				// The variables hold bare HSL channels ("27 40% 54%"), never
				// colours — see the token block at the top of src/index.css.
				island: {
					page: 'hsl(var(--island-page) / <alpha-value>)',
					sky: 'hsl(var(--island-sky) / <alpha-value>)',
					ocean: 'hsl(var(--island-ocean) / <alpha-value>)',
					grass: 'hsl(var(--island-grass) / <alpha-value>)',
					'grass-dark': 'hsl(var(--island-grass-dark) / <alpha-value>)',
					sand: 'hsl(var(--island-sand) / <alpha-value>)',
					wood: 'hsl(var(--island-wood) / <alpha-value>)',
					'wood-dark': 'hsl(var(--island-wood-dark) / <alpha-value>)',
					cream: 'hsl(var(--island-cream) / <alpha-value>)',
					'cream-2': 'hsl(var(--island-cream-2) / <alpha-value>)',
					purple: 'hsl(var(--island-purple) / <alpha-value>)',
					ink: 'hsl(var(--island-ink) / <alpha-value>)',
					'ink-soft': 'hsl(var(--island-ink-soft) / <alpha-value>)',
					// `danger` and `warn` existed as CSS variables and were used
					// as Tailwind classes (`text-island-danger`, 8 sites) but were
					// never declared here, so those classes emitted nothing and
					// the elements rendered at their inherited colour.
					danger: 'hsl(var(--island-danger) / <alpha-value>)',
					warn: 'hsl(var(--island-warn) / <alpha-value>)',
				},
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar-background))',
					foreground: 'hsl(var(--sidebar-foreground))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
					border: 'hsl(var(--sidebar-border))',
					ring: 'hsl(var(--sidebar-ring))'
				}
			},
			// One definition per elevation, shared with the `--shadow-*` custom
			// properties in index.css. Both spell the theme's own ink at low
			// alpha, so a theme with a cooler or darker ink casts a shadow that
			// belongs to it instead of a generic black.
			boxShadow: {
				'cozy-soft': 'var(--shadow-soft)',
				'cozy-raised': 'var(--shadow-raised)',
				'cozy-frame': 'var(--shadow-frame)',
				'cozy-inset': 'var(--shadow-inset)',
			},
			transitionTimingFunction: {
				cozy: 'cubic-bezier(0.34, 1.4, 0.5, 1)',
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)',
				// Game surfaces are rounder than form controls. `rounded-panel`
				// is a cozy card, `rounded-frame` a framed modal or the wood
				// frame itself — the two literals that were being written as
				// `rounded-[1.25rem]` / `rounded-[1.5rem]` / `rounded-3xl`.
				panel: 'var(--radius-panel)',
				frame: 'var(--radius-frame)'
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)'
					},
					to: {
						height: '0'
					}
				},
				'cozy-pop': {
					'0%': { transform: 'scale(0.92)', opacity: '0' },
					'100%': { transform: 'scale(1)', opacity: '1' }
				},
				'cozy-wiggle': {
					'0%, 100%': { transform: 'rotate(-2deg)' },
					'50%': { transform: 'rotate(2deg)' }
				},
				'sign-flip': {
					'0%': { transform: 'perspective(800px) rotateY(-18deg)', opacity: '0.35' },
					'100%': { transform: 'perspective(800px) rotateY(0deg)', opacity: '1' }
				},
				// Menu/popover entrance. `animate-scale-in` was already being
				// used by AccountMenu and AccountSwitcher against a keyframe that
				// did not exist, so those surfaces simply appeared.
				'scale-in': {
					'0%': { transform: 'scale(0.96)', opacity: '0' },
					'100%': { transform: 'scale(1)', opacity: '1' }
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				'cozy-pop': 'cozy-pop 0.24s cubic-bezier(0.34, 1.4, 0.5, 1)',
				'cozy-wiggle': 'cozy-wiggle 0.5s ease-in-out',
				'sign-flip': 'sign-flip 0.28s cubic-bezier(0.34, 1.2, 0.5, 1)',
				'scale-in': 'scale-in 0.14s cubic-bezier(0.34, 1.4, 0.5, 1)'
			},
			cursor: {
				pickaxe: "url('/assets/ui/cursors/pickaxe.png') 0 0, auto",
				'blobbi-neon': "url('/assets/ui/cursors/blobbi-baby-neon.png') 14 1, auto",
			}
		}
	},
	plugins: [tailwindcssAnimate],
} satisfies Config;
