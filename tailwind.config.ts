import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#151515",
        plasma: "#baff39",
        ember: "#ff764d",
        tide: "#00a7e1",
        haze: "#f4f1e8"
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,0.08), 0 18px 55px rgba(0,0,0,0.34)"
      },
      borderRadius: {
        "4xl": "0.65rem"
      },
      backgroundImage: {
        "aurora":
          "linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(180deg, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(135deg, rgba(186,255,57,0.12), rgba(0,167,225,0.08), rgba(255,118,77,0.1))"
      },
      fontFamily: {
        sans: ["Avenir Next", "Segoe UI Variable", "Segoe UI", "sans-serif"],
        mono: ["IBM Plex Mono", "SFMono-Regular", "monospace"]
      }
    }
  },
  plugins: []
};

export default config;
