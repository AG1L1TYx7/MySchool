import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e5ff',
          200: '#bcd1ff',
          300: '#8eb3ff',
          400: '#5889ff',
          500: '#325fff',
          600: '#1f3ff5',
          700: '#182ee1',
          800: '#1a28b6',
          900: '#1b288f',
        },
      },
    },
  },
  plugins: [],
};

export default config;
