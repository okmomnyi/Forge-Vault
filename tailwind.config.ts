import type { Config } from 'tailwindcss';
import { colors } from './design/tokens';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './design/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'blueprint-navy': colors.blueprintNavy,
        'grid-line': colors.gridLine,
        'diagram-cyan': colors.diagramCyan,
        'forge-orange': colors.forgeOrange,
        'steel-white': colors.steelWhite,
        'muted-steel': colors.mutedSteel,
        'whatsapp-green': colors.whatsappGreen,
      },
      fontFamily: {
        display: ['var(--font-oswald)', 'sans-serif'],
        body: ['var(--font-work-sans)', 'sans-serif'],
        mono: ['var(--font-space-mono)', 'monospace'],
      },
      backgroundImage: {
        // faint blueprint grid, used behind product imagery on hover
        'blueprint-grid':
          'linear-gradient(to right, rgba(111,183,222,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(111,183,222,0.08) 1px, transparent 1px)',
      },
      backgroundSize: {
        grid: '20px 20px',
      },
      keyframes: {
        'draw-leader': {
          '0%': { strokeDashoffset: '100' },
          '100%': { strokeDashoffset: '0' },
        },
        'led-flash': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
      animation: {
        'draw-leader': 'draw-leader 400ms ease-out forwards',
      },
    },
  },
  plugins: [],
};

export default config;
