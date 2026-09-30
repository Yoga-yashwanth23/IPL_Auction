import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        display: ["Fraunces", "serif"],
        body: ["Inter", "sans-serif"],
      },
      colors: {
        // Ocean Adventure token system
        abyss: "#061826",      // near-black ocean depth, page background
        deep: "#0A2A43",       // deep navy, panels
        cove: "#0F3B5C",       // lighter navy, cards
        lagoon: "#1FB6AC",     // turquoise accent, primary actions
        "lagoon-bright": "#3FE0D2",
        wood: "#7A4A2B",       // warm wood
        "wood-dark": "#4A2F1D",
        "wood-light": "#B8895D",
        brass: "#C9A24B",      // gold/brass highlight
        "brass-bright": "#E4C978",
        parchment: "#EDE0C8",  // map/paper text on dark
        coral: "#E4623F",      // sold/alert accent
        seafoam: "#8FD9CE",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "#1FB6AC",
          foreground: "#052018",
        },
        secondary: {
          DEFAULT: "#0F3B5C",
          foreground: "#EDE0C8",
        },
        destructive: {
          DEFAULT: "#E4623F",
          foreground: "#FFF6EE",
        },
        muted: {
          DEFAULT: "#0A2A43",
          foreground: "#9FB8C8",
        },
        accent: {
          DEFAULT: "#C9A24B",
          foreground: "#1A1204",
        },
        card: {
          DEFAULT: "#0F3B5C",
          foreground: "#EDE0C8",
        },
      },
      borderRadius: {
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.375rem",
      },
      backgroundImage: {
        "rope-line": "repeating-linear-gradient(90deg, #B8895D 0px, #B8895D 8px, #7A4A2B 8px, #7A4A2B 16px)",
      },
      boxShadow: {
        deck: "0 4px 24px rgba(6, 24, 38, 0.55)",
      },
      keyframes: {
        "sold-reveal": {
          "0%": { opacity: "0", transform: "scale(0.85) translateY(12px)" },
          "60%": { opacity: "1", transform: "scale(1.03) translateY(0)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "sold-reveal": "sold-reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        shimmer: "shimmer 2.5s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
