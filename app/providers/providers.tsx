"use client";

// TODO: decide if and how to use next-themes with tremor

import { ThemeProvider as NextThemesProvider } from "next-themes";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      themes={["light", "dark", "modern"]}
    >
      {children}
    </NextThemesProvider>
  );
}
