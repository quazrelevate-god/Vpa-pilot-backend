import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        info: "hsl(var(--info))",
        // Triage urgency scale (semantic, brand-independent)
        urgency: {
          critical: "hsl(var(--urgency-critical))",
          high: "hsl(var(--urgency-high))",
          medium: "hsl(var(--urgency-medium))",
          low: "hsl(var(--urgency-low))",
        },
        // Brand / interactive accent (refined royal blue)
        brand: {
          DEFAULT: "hsl(var(--accent-blue))",
          foreground: "hsl(var(--accent-blue-foreground))",
        },
        // Sidebar chrome
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          active: "hsl(var(--sidebar-active))",
          hover: "hsl(var(--sidebar-hover))",
          border: "hsl(var(--sidebar-border))",
        },
        // ── Nam Kural proposal site (/proposal) — Refined Indigo + Gold ──────
        // Self-contained palette used only by the /proposal experience; kept
        // separate from the Aurora HSL-variable tokens above.
        ink: {
          950: "#081831",
          900: "#0E2647",
          800: "#14406E",
          700: "#1B4F86",
          600: "#2A6BB0",
          500: "#3B82C4",
        },
        // 'haze' rather than 'sky' so it does not shadow Tailwind's default
        // sky-* scale (used elsewhere in the portal). Ported /proposal source
        // has sky-100/300 rewritten to haze-100/300.
        haze: {
          100: "#D6EAFF",
          300: "#8EC9FF",
        },
        gold: {
          300: "#F4DFAE",
          400: "#EFC468",
          500: "#E3AA3D",
          600: "#B47F1E",
        },
        paper: "#F4F8FC",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
        // Nam Kural proposal site (/proposal)
        disp: ['"Anek Tamil"', '"Noto Sans Tamil"', '"Noto Sans"', "sans-serif"],
        body: ['"Noto Sans"', '"Noto Sans Tamil"', "sans-serif"],
      },
      letterSpacing: {
        eyebrow: "0.28em",
        wide2: "0.06em",
      },
      maxWidth: {
        wrap: "78rem",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        shimmer: "shimmer 1.3s infinite",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
