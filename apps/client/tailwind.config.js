import tailwindcssAnimate from 'tailwindcss-animate';

const colorVar = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Core palette
        'strike': {
          'bg': colorVar('--color-strike-bg'),
          'surface': colorVar('--color-strike-surface'),
          'elevated': colorVar('--color-strike-elevated'),
          'canvas': colorVar('--color-strike-canvas'),
          'chrome': colorVar('--color-strike-chrome'),
          'panel': colorVar('--color-strike-panel'),
          'panel-raised': colorVar('--color-strike-panel-raised'),
          'border': 'rgb(var(--color-strike-border) / 0.08)',
          'border-light': 'rgb(var(--color-strike-border) / 0.12)',
        },
        // Accent colors
        'accent': {
          'primary': colorVar('--color-accent-primary'),    // Orange - main accent
          'secondary': colorVar('--color-accent-secondary'),   // Cyan - secondary accent
          'tertiary': colorVar('--color-accent-tertiary'),    // Purple - tertiary
        },
        // Team colors
        'team': {
          'red': colorVar('--color-team-red'),
          'red-light': colorVar('--color-team-red-light'),
          'blue': colorVar('--color-team-blue'),
          'blue-light': colorVar('--color-team-blue-light'),
        },
        // UI states
        'ui': {
          'success': colorVar('--color-ui-success'),
          'warning': colorVar('--color-ui-warning'),
          'danger': colorVar('--color-ui-danger'),
          'info': colorVar('--color-ui-info'),
        }
      },
      fontFamily: {
        'display': ['"Bebas Neue"', '"Orbitron"', 'sans-serif'],
        'body': ['"Exo 2"', '"Rajdhani"', 'sans-serif'],
        'mono': ['"JetBrains Mono"', 'monospace'],
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out forwards',
        'fade-up': 'fade-up 0.3s ease-out forwards',
        'scale-in': 'scale-in 0.2s ease-out forwards',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'pulse-low': 'pulse-low 0.8s ease-in-out infinite',
        'slide-in-right': 'slide-in-right 0.3s ease-out forwards',
        'glow': 'glow 2s ease-in-out infinite',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        'pulse-low': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'glow': {
          '0%, 100%': { filter: 'brightness(1)' },
          '50%': { filter: 'brightness(1.2)' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-pattern': 'linear-gradient(135deg, rgb(var(--color-accent-primary) / 0.03) 0%, transparent 50%, rgb(var(--color-accent-secondary) / 0.03) 100%)',
      },
      boxShadow: {
        'glow-orange': '0 0 20px rgb(var(--color-accent-primary) / 0.3)',
        'glow-cyan': '0 0 20px rgb(var(--color-accent-secondary) / 0.3)',
        'glow-red': '0 0 20px rgb(var(--color-ui-danger) / 0.3)',
        'glow-blue': '0 0 20px rgb(var(--color-team-blue) / 0.3)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
