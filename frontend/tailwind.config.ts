import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        clinical: {
          navy: "#0F2942",
          navyDark: "#0B1F36",
          teal: "#0D9488",
          tealLight: "#CCFBF1",
          coral: "#E11D48",
          amber: "#F59E0B",
          emerald: "#10B981",
          surface: "#F8FAFC",
        },
      },
    },
  },
  plugins: [],
};

export default config;
