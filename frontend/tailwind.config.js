/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        sae: {
          dark: '#0a0e17',
          card: '#111827',
          panel: '#1f293d',
          accent: '#0284c7',
          accentGlow: '#38bdf8',
          gold: '#eab308',
          success: '#10b981',
          warning: '#f59e0b',
          danger: '#ef4444',
          hud: '#00f0ff'
        },
        surface: {
          DEFAULT: '#121315',
          dim: '#121315',
          bright: '#38393b',
          'container-lowest': '#0d0e10',
          'container-low': '#1b1c1e',
          container: '#1f2022',
          'container-high': '#292a2c',
          'container-highest': '#343537',
          variant: '#343537'
        },
        'primary-container': '#2f6fd6',
        'on-primary-container': '#f8f8ff',
        'secondary-container': '#ee9800',
        'on-secondary-container': '#5b3800',
        'tertiary-container': '#008442',
        'on-tertiary-container': '#e8ffe8',
        'error-container': '#93000a',
        'on-error-container': '#ffdad6',
        'on-surface': '#e3e2e4',
        'on-surface-variant': '#c2c6d5',
        uav: {
          bg: 'var(--uav-bg)',
          header: 'var(--uav-header)',
          card: 'var(--uav-card)',
          border: 'var(--uav-card-border)',
          text: 'var(--uav-text)',
          muted: 'var(--uav-muted)',
          primary: 'var(--uav-primary-blue)',
          icon: 'var(--uav-icon-blue)',
          green: 'var(--uav-green)',
          'green-fill': 'var(--uav-green-fill)',
          amber: 'var(--uav-amber)',
          red: 'var(--uav-red)',
          'red-dark': 'var(--uav-red-dark)',
          'red-border': 'var(--uav-red-border)',
          purple: 'var(--uav-purple)',
        },
      },
      fontFamily: {
        orbitron: ['Orbitron', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif']
      },
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'radar': 'radar 4s linear infinite',
        'scan': 'scan 2s ease-in-out infinite'
      },
      keyframes: {
        radar: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' }
        },
        scan: {
          '0%, 100%': { transform: 'translateY(0%)' },
          '50%': { transform: 'translateY(100%)' }
        }
      }
    },
  },
  plugins: [],
}
