/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'void': '#0A0A0F',
        'void-deep': '#050508',
        'surface': '#12121A',
        'surface-2': '#1C1C2A',
        'quantum-cyan': '#00F0FF',
        'quantum-violet': '#A78BFA',
        'quantum-gold': '#FBBF24',
        'quantum-green': '#34D399',
        'quantum-red': '#FB7185',
        'quantum-iris': '#818CF8',
        'cloud': '#A1A1AA',
        'text-primary': '#F5F5F7',
        'text-secondary': 'rgba(245,245,247,0.6)',
        'text-tertiary': 'rgba(245,245,247,0.3)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        'glass': '0 8px 32px rgba(0,0,0,0.15)',
        'glass-hover': '0 12px 48px rgba(0,0,0,0.25)',
        'glow-cyan': '0 0 20px rgba(0,240,255,0.25)',
        'glow-violet': '0 0 20px rgba(167,139,250,0.25)',
        'glow-gold': '0 0 20px rgba(251,191,36,0.25)',
        'glow-green': '0 0 20px rgba(52,211,153,0.25)',
        'glow-red': '0 0 20px rgba(251,113,133,0.25)',
      },
    },
  },
  plugins: [],
};
