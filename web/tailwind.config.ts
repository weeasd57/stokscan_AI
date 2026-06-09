import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      screens: {
        'xs': '480px',
      },
      colors: {
        // Light mode colors
        'light-bg': '#ffffff',
        'light-bg-secondary': '#f8f9fa',
        'light-text': '#1a1a1a',
        'light-text-secondary': '#666666',
        'light-border': '#e0e0e0',
        
        // Keep existing dark mode colors
      },
    },
  },
  plugins: [
    plugin(function ({ addVariant }) {
      addVariant("light", "html.light &");
    }),
  ],
};

export default config;
