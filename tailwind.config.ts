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
        ink: "#091018",
        plasma: "#10d6a0",
        ember: "#ff7b53",
        tide: "#4b8dff",
        haze: "#ffe8c8"
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,0.08), 0 18px 60px rgba(10,18,35,0.45)"
      },
      borderRadius: {
        "4xl": "2rem"
      },
      backgroundImage: {
        "aurora":
          "radial-gradient(circle at 20% 20%, rgba(16,214,160,0.18), transparent 32%), radial-gradient(circle at 80% 15%, rgba(75,141,255,0.18), transparent 28%), radial-gradient(circle at 50% 80%, rgba(255,123,83,0.18), transparent 30%)"
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
