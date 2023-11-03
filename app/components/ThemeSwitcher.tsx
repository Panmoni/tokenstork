"use client";

// TODO: update to use Tremor and make sure it works, then include in header, maybe as sun/moon

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export default function ThemeSwitcher() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="flex gap-4">
      <Button size="sm" variant="flat" onClick={() => setTheme("light")}>
        Light
      </Button>
      <Button size="sm" variant="flat" onClick={() => setTheme("dark")}>
        Dark
      </Button>
      <Button size="sm" variant="flat" onClick={() => setTheme("modern")}>
        Modern
      </Button>
    </div>
  );
}
