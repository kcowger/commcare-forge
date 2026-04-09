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
        sans: ['Nunito Sans', 'system-ui', '-apple-system', 'sans-serif']
      },
      colors: {
        // CommCare HQ styleguide action colors
        primary: {
          DEFAULT: '#5D70D2',
          light: '#7B8ADE',
          dark: '#4A5BBF',
          subtle: '#DFE2F6'
        },
        info: {
          DEFAULT: '#01A2A9',
          light: '#33B5BB',
          dark: '#018A90',
          subtle: '#CCECEE'
        },
        success: {
          DEFAULT: '#358623',
          light: '#4A9E36',
          dark: '#2A6D1B',
          subtle: '#D9ECD4'
        },
        warning: {
          DEFAULT: '#EEAE00',
          light: '#F5C133',
          dark: '#CC9500',
          subtle: '#FCEFCC'
        },
        danger: {
          DEFAULT: '#E13019',
          light: '#E85A47',
          dark: '#C42812',
          subtle: '#FAD8D4'
        },
        // Dark surface system (purple-tinted to align with HQ primary)
        surface: {
          DEFAULT: '#121218',
          raised: '#1a1a24',
          overlay: '#22222e'
        },
        // Backward-compat alias — accent maps to primary
        accent: {
          DEFAULT: '#5D70D2',
          light: '#7B8ADE',
          dark: '#4A5BBF'
        }
      }
    }
  },
  plugins: []
}
