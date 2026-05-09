/** @type {import('tailwindcss').Config} */

// All colors reference CSS variables so both light and dark themes
// work by switching --color-* values on [data-theme].
// Space-separated RGB channels enable Tailwind opacity modifiers (bg-accent/10 etc.)
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '../../../extensions/*/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        base: v('--color-base'),
        surface: v('--color-surface'),
        elevated: v('--color-elevated'),
        panel: v('--color-panel'),
        'border-subtle': v('--color-border-subtle'),
        'border-default': v('--color-border-default'),
        primary: v('--color-primary'),
        secondary: v('--color-secondary'),
        dim: v('--color-dim'),
        accent: v('--color-accent'),
        'accent-bg': v('--color-accent-bg'),
        success: v('--color-success'),
        warning: v('--color-warning'),
        danger: v('--color-danger'),
        teal: v('--color-teal'),
        steel: v('--color-steel'),
      },
      fontFamily: {
        sans: ['DM Sans Variable', 'DM Sans', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
};
