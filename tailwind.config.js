/** @type {import('tailwindcss').Config} */
export default {
  content: ['./*.html', './src/**/*.{js,css}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        navy: {
          900: '#0b1220',
          800: '#111c33',
          700: '#1e3a8a',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(15, 23, 42, 0.18)',
        header: '0 1px 0 rgba(15, 23, 42, 0.06), 0 6px 18px -14px rgba(15, 23, 42, 0.35)',
      },
      backgroundImage: {
        'navy-gradient': 'linear-gradient(135deg, #0b1220 0%, #111c33 45%, #1e3a8a 100%)',
        'navy-gradient-soft': 'linear-gradient(120deg, #1e3a8a 0%, #111c33 55%, #0b1220 100%)',
      },
      maxWidth: {
        '8xl': '88rem',
      },
    },
  },
  plugins: [],
};
