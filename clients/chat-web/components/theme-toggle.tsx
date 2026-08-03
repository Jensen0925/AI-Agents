"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export type CloudSageTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "cloudsage.theme";

function applyTheme(theme: CloudSageTheme) {
  document.documentElement.dataset.cloudsageTheme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  window.dispatchEvent(
    new CustomEvent<CloudSageTheme>("cloudsage-theme-change", {
      detail: theme,
    }),
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<CloudSageTheme>("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initialTheme: CloudSageTheme = stored === "light" ? "light" : "dark";
    document.documentElement.dataset.cloudsageTheme = initialTheme;
    document.documentElement.classList.toggle("dark", initialTheme === "dark");
    setTheme(initialTheme);

    const syncTheme = (event: Event) => {
      setTheme((event as CustomEvent<CloudSageTheme>).detail);
    };
    window.addEventListener("cloudsage-theme-change", syncTheme);
    return () => window.removeEventListener("cloudsage-theme-change", syncTheme);
  }, []);

  function toggleTheme() {
    const nextTheme: CloudSageTheme = theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    setTheme(nextTheme);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-transparent text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      aria-label={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
      title={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
