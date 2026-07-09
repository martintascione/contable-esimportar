import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "SF Pro Display",
          "Helvetica Neue",
          "Inter",
          "system-ui",
          "sans-serif"
        ],
        display: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "Helvetica Neue",
          "Inter",
          "sans-serif"
        ]
      },
      colors: {
        bg: "#f5f5f7",
        surface: "#ffffff",
        "surface-2": "#fbfbfd",
        ink: "#1d1d1f",
        "ink-2": "#6e6e73",
        "ink-3": "#86868b",
        line: "#e5e5ea",
        "line-2": "#d2d2d7",
        brand: {
          DEFAULT: "#0071e3",
          soft: "#e8f1fd"
        },
        ok: { DEFAULT: "#30a46c", soft: "#e6f6ed" },
        warn: { DEFAULT: "#b4730e", soft: "#fcf0dd" },
        danger: { DEFAULT: "#f04f6f", soft: "#fdeaef" },
        violet: { DEFAULT: "#7c5cff", soft: "#efeaff" }
      },
      borderRadius: {
        xl: "14px",
        "2xl": "18px",
        "3xl": "24px"
      }
    }
  },
  plugins: []
};
export default config;
