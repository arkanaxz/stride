"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

export function preferredTheme(): Theme {
  try {
    const stored = localStorage.getItem("stride-theme");
    if (stored === "dark" || stored === "light") return stored;
  } catch { /* Storage might not be available. */ }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("stride-theme", theme); } catch { /* The current page still changes. */ }
  window.dispatchEvent(new Event("stride-theme-change"));
}

export default function ThemeToggle({ onChange }: { onChange?: (theme: Theme) => void }) {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const synchronize = () => setTheme(preferredTheme());
    synchronize();
    window.addEventListener("stride-theme-change", synchronize);
    window.addEventListener("storage", synchronize);
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onSystemChange = () => {
      try {
        if (["light", "dark"].includes(localStorage.getItem("stride-theme") || "")) return;
      } catch { /* Follow the system setting. */ }
      const next = preferredTheme();
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    media.addEventListener("change", onSystemChange);
    return () => {
      window.removeEventListener("stride-theme-change", synchronize);
      window.removeEventListener("storage", synchronize);
      media.removeEventListener("change", onSystemChange);
    };
  }, []);

  const next = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? "Switch to light mode" : "Switch to dark mode";
  return <button type="button" className="btn theme-toggle" aria-label={label} title={label} onClick={() => {
    applyTheme(next);
    setTheme(next);
    onChange?.(next);
  }}><span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span><span>{next === "light" ? "Light mode" : "Dark mode"}</span></button>;
}
