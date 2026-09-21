/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        crm: {
          bg: "#FAFAF9",
          surface: "#FFFFFF",
          elevated: "#F5F5F4",
          subtle: "#F0F0EE",
          border: "#E5E5E3",
          borderStrong: "#D4D4D0",
          text: "#1C1C1E",
          textSecondary: "#5C5C60",
          textMuted: "#8E8E93",
          accent: "#1E3A5F",
          accentHover: "#152A45",
          accentSubtle: "#F0F4F8",
          accentBorder: "rgba(30, 58, 95, 0.15)",
          success: "#1F7A4D",
          successBg: "#EAF6EF",
          successBorder: "#C2E6D1",
        },
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", "system-ui", "-apple-system", "sans-serif"],
        heading: ["'Space Grotesk'", "system-ui", "-apple-system", "sans-serif"],
        mono: ["'JetBrains Mono'", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
