import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Matches the Jinja templates' palette so the look is identical
        brand: "#0f62fe",
        sidebar: "#0c2e59",
        sidebarHover: "#164075",
        sidebarActive: "#1a4b8c",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
      animation: {
        shimmer: "shimmer 1.2s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
