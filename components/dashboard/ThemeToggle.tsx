"use client";

import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_KEY, type Theme } from "@/lib/theme";

// the choice made on this page, for when localStorage is blocked
let chosen: Theme | null = null;
const listeners = new Set<() => void>();

const readTheme = (): Theme => {
  if (chosen) return chosen;
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  // another tab switched theme
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY) return;
    chosen = null;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
};

const noop = () => () => {};

const applyTheme = (theme: Theme) => {
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
};

/**
 * Dark / light switch in the dashboard header, for every role. Dark is the
 * default; the choice is remembered on this device (localStorage). A full
 * page load gets it from the inline script in app/layout.tsx before the
 * first paint; this applies it when the dashboard is reached by a client
 * navigation (e.g. right after login) and takes it off again on the way out,
 * so the login and public pages always stay dark.
 */
export function ThemeToggle() {
  // the server always renders dark; the browser reads the saved choice
  const theme = useSyncExternalStore(subscribe, readTheme, () => "dark" as const);
  // false only while hydrating, when `theme` is still the server's "dark":
  // the inline script has already set the real theme, so leave it alone
  const live = useSyncExternalStore(noop, () => true, () => false);

  useLayoutEffect(() => {
    if (live) applyTheme(theme);
  }, [live, theme]);
  // leaving the dashboard: back to the default
  useEffect(() => () => applyTheme("dark"), []);

  const toggle = () => {
    chosen = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(THEME_KEY, chosen);
    } catch {
      // storage blocked: the switch still works until the page reloads
    }
    listeners.forEach((l) => l());
  };

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={toggle}
      className="nr-interactive inline-flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-overlay/[0.06] hover:text-text"
      aria-label={label}
      title={label}
    >
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
