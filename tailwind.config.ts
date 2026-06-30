import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
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
				// Raw cozy-island palette for new shell/HUD/frame components
				island: {
					sky: '#9DDCF9',
					ocean: '#55BFEA',
					grass: '#7CCB72',
					'grass-dark': '#5BAE54',
					sand: '#F6DFA6',
					wood: '#B9855B',
					'wood-dark': '#8C6239',
					cream: '#FFF4D8',
					'cream-2': '#FBEAC2',
					purple: '#8E6BE8',
					ink: '#3A2A1A',
					'ink-soft': '#6B5742',
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
			boxShadow: {
				'cozy-soft': '0 2px 6px rgba(58, 42, 26, 0.10)',
				'cozy-raised': '0 8px 20px rgba(58, 42, 26, 0.14)',
				'cozy-frame': '0 16px 40px rgba(58, 42, 26, 0.22)',
				'cozy-inset': 'inset 0 2px 8px rgba(58, 42, 26, 0.18)',
			},
			transitionTimingFunction: {
				cozy: 'cubic-bezier(0.34, 1.4, 0.5, 1)',
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
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
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				'cozy-pop': 'cozy-pop 0.24s cubic-bezier(0.34, 1.4, 0.5, 1)',
				'cozy-wiggle': 'cozy-wiggle 0.5s ease-in-out',
				'sign-flip': 'sign-flip 0.28s cubic-bezier(0.34, 1.2, 0.5, 1)'
			},
			cursor: {
				pickaxe: "url('/assets/interactive/games/cursor-pickaxe.png') 0 0, auto",
				'blobbi-neon': "url('/assets/baby-stage/baby/cursor-blobbi-baby-neon.png') 14 1, auto",
			}
		}
	},
	plugins: [tailwindcssAnimate],
} satisfies Config;
