/** @type {import('tailwindcss').Config} */
export default {
  content: ['./*.html', './admin/**/*.html', './src/**/*.{js,css}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Archivo Narrow — condensed industrial display: wordmark, headings, labels.
        display: ['"Archivo Narrow"', 'system-ui', 'sans-serif'],
        // IBM Plex Sans — body copy.
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // JetBrains Mono — technical readouts: prices, part numbers, step numbers, eyebrows.
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Forge Vault — dark industrial. Near-black surfaces, machined-orange accent.
        forge: {
          bg: '#131313', // page background / surface
          lowest: '#0e0e0e', // inputs, deepest wells
          low: '#1b1c1c', // low surface
          panel: '#1f2020', // cards / containers
          high: '#2a2a2a', // hovers, raised
          line: '#2a2a2a', // hairline borders
          'line-2': '#353535', // stronger dividers
          bright: '#393939',
          orange: '#ff5f00', // primary action accent
          'orange-dim': '#a63b00', // pressed / muted orange
          salmon: '#ffb599', // light accent text on dark
          ink: '#e4e2e1', // primary text
          muted: '#c6c6c6', // secondary text
          warm: '#e4bfb1', // warm muted text
          outline: '#ab8a7d', // warm outline
          error: '#ffb4ab',
        },
      },
      letterSpacing: {
        widest2: '0.22em',
      },
      boxShadow: {
        panel: '0 1px 0 rgba(255,95,0,0.04), 0 18px 40px -24px rgba(0,0,0,0.8)',
      },
      backgroundImage: {
        'forge-fade': 'linear-gradient(90deg, #131313 0%, rgba(19,19,19,0.4) 55%, transparent 100%)',
      },
      maxWidth: {
        '8xl': '88rem',
      },
    },
  },
  plugins: [],
};
