import type { Config } from "tailwindcss";

// Every color is a CSS variable from globals.css, so light/dark switch without `dark:` variants.
const v = (name: string) => `var(--${name})`;

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        "surface-2": v("surface-2"),
        line: v("border"),
        "line-strong": v("border-strong"),
        gold: v("gold"),
        coral: v("coral"),
        ink: v("text"),
        muted: v("muted"),
        primary: { DEFAULT: v("primary"), hover: v("primary-hover"), ink: v("primary-ink"), soft: v("primary-soft") },
        grid: v("grid"),
        trace: v("trace"),
        normal: { DEFAULT: v("normal"), soft: v("normal-soft"), fg: v("normal-fg") },
        mild: { DEFAULT: v("mild"), soft: v("mild-soft"), fg: v("mild-fg") },
        moderate: { DEFAULT: v("moderate"), soft: v("moderate-soft"), fg: v("moderate-fg") },
        severe: { DEFAULT: v("severe"), soft: v("severe-soft"), fg: v("severe-fg") },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        pixel: ["var(--font-pixel)", "var(--font-inter)", "sans-serif"],
      },
      transitionTimingFunction: { DEFAULT: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      // short laptop windows: stages compact a step so they fit without scrolling
      screens: { short: { raw: "(max-height: 760px)" } },
    },
    // Pixel art has no curves: every rounded-* utility renders square.
    borderRadius: {
      none: "0",
      sm: "0",
      DEFAULT: "0",
      md: "0",
      lg: "0",
      xl: "0",
      "2xl": "0",
      full: "0",
    },
  },
  plugins: [],
};

export default config;
