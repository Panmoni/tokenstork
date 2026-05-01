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
      // zinc: dark-mode neutrals. Slate has a blue cast that, on the
      // dark theme, made body copy read as "blue-on-blue" against
      // dark:bg-slate-900/950 panels. We migrated dark: utilities off
      // slate onto zinc (true gray) and bumped text tiers one step
      // brighter for contrast. Light mode still uses slate.
      zinc: colors.zinc,
      emerald: colors.emerald,
      indigo: colors.indigo,
      violet: colors.violet,
      yellow: colors.yellow,
      fuchsia: colors.fuchsia,
      pink: colors.pink,
      red: colors.red,
      amber: colors.amber,
      // rose is used by the directory grid for negative-% change columns
      // and for down-trending sparkline strokes. Tailwind's `theme.colors`
      // object fully replaces the default palette, so anything not listed
      // here silently resolves to no CSS. Add cautiously.
      rose: colors.rose,
      // sky: 24h TVL-mover badge on the per-token detail page (water /
      // liquidity semantics — distinct from emerald/rose's price-direction
      // signal so the user can see "TVL moved" vs "price moved" at a glance).
      sky: colors.sky,
      // cyan: "top N by Cauldron TVL" badge on the per-token detail page —
      // a sibling of the violet "% of Cauldron TVL" pill, kept distinct so
      // ordinal-rank vs share-of-TVL aren't visually confused.
      cyan: colors.cyan,
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
  plugins: [
    // Powers shadcn-svelte's animate-in / fade-in-0 / zoom-in-95 classes
    // on the Tooltip + future overlay components (dialogs, dropdowns).
    require("tailwindcss-animate"),
  ],
};
export default config;
