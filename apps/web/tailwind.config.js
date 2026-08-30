/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Every colour resolves through a CSS variable so the palette can be
        // swapped at runtime — by the theme switch, by high contrast, or by an
        // agency's white-label accent — without a rebuild.
        bg: 'rgb(var(--nv-bg) / <alpha-value>)',
        'bg-soft': 'rgb(var(--nv-bg-soft) / <alpha-value>)',
        surface: 'rgb(var(--nv-surface) / <alpha-value>)',
        'surface-strong': 'rgb(var(--nv-surface-strong) / <alpha-value>)',
        'surface-muted': 'rgb(var(--nv-surface-muted) / <alpha-value>)',
        line: 'rgb(var(--nv-border) / <alpha-value>)',
        'line-strong': 'rgb(var(--nv-border-strong) / <alpha-value>)',
        ink: 'rgb(var(--nv-text) / <alpha-value>)',
        'ink-muted': 'rgb(var(--nv-text-muted) / <alpha-value>)',
        'ink-subtle': 'rgb(var(--nv-text-subtle) / <alpha-value>)',
        primary: 'rgb(var(--nv-primary) / <alpha-value>)',
        'primary-strong': 'rgb(var(--nv-primary-strong) / <alpha-value>)',
        'primary-soft': 'rgb(var(--nv-primary-soft) / <alpha-value>)',
        'primary-fg': 'rgb(var(--nv-primary-fg) / <alpha-value>)',
        success: 'rgb(var(--nv-success) / <alpha-value>)',
        'success-soft': 'rgb(var(--nv-success-soft) / <alpha-value>)',
        warning: 'rgb(var(--nv-warning) / <alpha-value>)',
        'warning-soft': 'rgb(var(--nv-warning-soft) / <alpha-value>)',
        danger: 'rgb(var(--nv-danger) / <alpha-value>)',
        'danger-soft': 'rgb(var(--nv-danger-soft) / <alpha-value>)',
        info: 'rgb(var(--nv-info) / <alpha-value>)',
        'info-soft': 'rgb(var(--nv-info-soft) / <alpha-value>)',
        canvas: 'rgb(var(--nv-canvas) / <alpha-value>)',
      },
      borderRadius: { DEFAULT: '0.5rem', '2xl': '1rem', '3xl': '1.5rem' },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      /*
       * A shadow scale rather than one shadow.
       *
       * Depth in a white interface is the only thing separating a raised
       * control from the paper behind it, so it needs steps: a hairline for
       * inputs, a soft lift for cards, a real cast for popovers and modals.
       * Each is two layers — a tight contact shadow and a wide ambient one —
       * because a single large blur is what makes an interface look drawn
       * rather than built.
       */
      boxShadow: {
        xs: '0 1px 2px rgb(var(--nv-shadow) / 0.05)',
        btn: '0 1px 2px rgb(var(--nv-shadow) / 0.09), 0 1px 1px rgb(var(--nv-shadow) / 0.04)',
        card: '0 1px 2px rgb(var(--nv-shadow) / 0.05), 0 8px 24px -8px rgb(var(--nv-shadow) / 0.12)',
        pop: '0 2px 6px rgb(var(--nv-shadow) / 0.07), 0 18px 44px -12px rgb(var(--nv-shadow) / 0.22)',
        panel: '0 2px 6px rgb(var(--nv-shadow) / 0.07), 0 18px 44px -12px rgb(var(--nv-shadow) / 0.22)',
        modal: '0 4px 12px rgb(var(--nv-shadow) / 0.08), 0 32px 80px -16px rgb(var(--nv-shadow) / 0.32)',
        glow: '0 6px 24px -6px rgb(var(--nv-primary) / 0.5)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
