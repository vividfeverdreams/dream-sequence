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
        ink: "#08080a",
        plasma: "#c8f24b",
        ember: "#ff7a45",
        tide: "#7fb2ff",
        haze: "#f2ebdd"
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,0.06), 0 24px 70px rgba(0,0,0,0.5)"
      },
      borderRadius: {
        "4xl": "2rem"
      },
      backgroundImage: {
        "aurora":
          "radial-gradient(90% 140% at 12% 0%, rgba(255,122,69,0.14), transparent 60%), radial-gradient(80% 120% at 100% 0%, rgba(127,178,255,0.08), transparent 60%)"
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "SFMono-Regular", "monospace"],
        display: ["var(--font-display)", "Georgia", "serif"]
      }
    }
  },
  plugins: []
};

export default config;
