import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{svelte,js,ts}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      primary: "#4f359b",
      secondary: "#ff6b6b",
      accent: "#0ac18e",
      background: "#f0eff4",
      textcolor: "#343a40",
      symbolcolor: "#888",
      altrow: "#e9fcec",
      twitter: "#1da1f2",
      linkhover: "#693cc4",
      linkactive: "#2b185b",
      linkvisited: "#9166cc",
      black: colors.black,
      white: colors.white,
      gray: colors.gray,
      slate: colors.slate,
      emerald: colors.emerald,
      indigo: colors.indigo,
      violet: colors.violet,
      yellow: colors.yellow,
      fuchsia: colors.fuchsia,
      pink: colors.pink,
      red: colors.red,
      amber: colors.amber,
    },
    fontSize: {
      sm: "0.8rem",
      base: "1.25rem",
      xl: "1.5rem",
      "2xl": "1.563rem",
      "3xl": "1.953rem",
      "4xl": "2.441rem",
      "5xl": "3.052rem",
    },
    container: {
      center: true,
    },
  },
  plugins: [],
};
export default config;
