import type { Config } from "tailwindcss";

export default {
  content: ["./src/web/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "#0a0a0f",
          secondary: "#111118",
          tertiary: "#1a1a24",
          hover: "#1e1e2a",
          active: "#242432",
        },
        border: {
          subtle: "#1e1e2a",
          default: "#2a2a3a",
          bright: "#3a3a4a",
        },
        text: {
          primary: "#e8e8f0",
          secondary: "#9999b0",
          tertiary: "#5a5a70",
          accent: "#7c6af7",
        },
        accent: {
          purple: "#7c6af7",
          "purple-dim": "#4a3f9a",
          blue: "#3b82f6",
          green: "#22c55e",
          red: "#ef4444",
          yellow: "#f59e0b",
        },
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Fira Code"', "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
