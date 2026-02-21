import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    resolve(__dirname, 'index.html'),
    resolve(__dirname, 'src/**/*.{js,ts,jsx,tsx}')
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif']
      },
      colors: {
        primary: {
          50: '#e8e8f0',
          100: '#c5c5db',
          200: '#9e9ec5',
          300: '#7777af',
          400: '#59599e',
          500: '#3b3b8d',
          600: '#2d2d6e',
          700: '#1a1a2e',
          800: '#121225',
          900: '#0a0a1a'
        },
        accent: {
          DEFAULT: '#10b981',
          light: '#34d399',
          dark: '#059669'
        }
      }
    }
  },
  plugins: []
}
