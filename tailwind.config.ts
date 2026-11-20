import type { Config } from "tailwindcss";

// Walden Local brand system, sampled from Walden's staging portal (Avex) and
// waldenlocalmeat.com. Site font is Neue Campton (licensed); "Albert Sans" is
// the closest free fallback. If Campton is installed locally it wins.
export default {
  content: ["./app/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        forest: {
          DEFAULT: "#22392B", // header / footer
          700: "#2D5B3E", // primary green buttons + links
          800: "#244A33",
          900: "#1C3A2B", // logo green
        },
        cream: {
          DEFAULT: "#F7F5EA", // order card side panel, modals
          light: "#FBFAF4",
          dark: "#EFEBDA",
        },
        line: "#ECEAE0",
        gold: {
          DEFAULT: "#E3C76A", // progress bar, sign-up button
          light: "#F6DB78", // demo banner
        },
        carrot: {
          DEFAULT: "#EE7330", // modal secondary / plan page actions
          dark: "#D9611F",
        },
        alert: "#C9502F",
        ink: "#141414",
        // Legacy palette, still used by /merchant and /account until restyled.
        brand: {
          50: "#f0f3eb", 100: "#dde5d4", 200: "#b8c9a9", 300: "#8aaa70", 400: "#6a9152",
          500: "#548534", 600: "#508519", 700: "#3c6613", 800: "#2b490e", 900: "#1c3829", 950: "#0f2118",
        },
        surface: "#FFFFFF",
        accent: "#E87B30",
        "accent-dark": "#C45E1A",
        "accent-light": "#FDE8CC",
      },
      fontFamily: {
        sans: ['"Neue Campton"', '"Albert Sans"', "system-ui", "sans-serif"],
        serif: ['"Fraunces"', "Georgia", "serif"],
        display: ['"Neue Campton"', '"Albert Sans"', "system-ui", "sans-serif"],
        body: ['"Neue Campton"', '"Albert Sans"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,20,20,0.04)",
        modal: "0 24px 60px rgba(0,0,0,0.25)",
        "warm-xs": "0 1px 2px rgba(28, 25, 23, 0.04)",
        "warm-sm": "0 1px 3px rgba(28, 25, 23, 0.06), 0 1px 2px rgba(28, 25, 23, 0.04)",
        "warm-md": "0 4px 12px rgba(28, 25, 23, 0.07)",
        "warm-lg": "0 12px 40px rgba(28, 25, 23, 0.1)",
        "warm-xl": "0 24px 60px rgba(28, 25, 23, 0.14)",
        glow: "0 0 0 3px rgba(34, 197, 94, 0.2)",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        popIn: {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out forwards",
        "pop-in": "popIn 0.22s ease-out forwards",
        "slide-up": "popIn 0.3s ease-out forwards",
        "scale-in": "popIn 0.2s ease-out forwards",
        "pulse-soft": "pulse 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
