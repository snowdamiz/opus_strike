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
          'bg': '#0c0c10',
          'surface': '#12121a',
          'elevated': '#1a1a24',
          'border': 'rgba(255, 255, 255, 0.08)',
          'border-light': 'rgba(255, 255, 255, 0.12)',
        },
        // Accent colors
        'accent': {
          'primary': '#f97316',    // Orange - main accent
          'secondary': '#06b6d4',   // Cyan - secondary accent
          'tertiary': '#8b5cf6',    // Purple - tertiary
        },
        // Team colors
        'team': {
          'red': '#ef4444',
          'red-light': '#fca5a5',
          'blue': '#3b82f6',
          'blue-light': '#93c5fd',
        },
        // UI states
        'ui': {
          'success': '#22c55e',
          'warning': '#eab308',
          'danger': '#ef4444',
          'info': '#06b6d4',
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
        'hero-pattern': 'linear-gradient(135deg, rgba(249, 115, 22, 0.03) 0%, transparent 50%, rgba(6, 182, 212, 0.03) 100%)',
      },
      boxShadow: {
        'glow-orange': '0 0 20px rgba(249, 115, 22, 0.3)',
        'glow-cyan': '0 0 20px rgba(6, 182, 212, 0.3)',
        'glow-red': '0 0 20px rgba(239, 68, 68, 0.3)',
        'glow-blue': '0 0 20px rgba(59, 130, 246, 0.3)',
      },
    },
  },
  plugins: [],
};
