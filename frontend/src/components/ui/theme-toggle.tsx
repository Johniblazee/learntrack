import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

// Small, accessible theme toggle. Persist to localStorage and respect system.
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const stored = (localStorage.getItem("learntrack-theme") as "light" | "dark" | null);
    if (stored) return stored;
    // Default to light mode instead of system preference
    return "light";
  });

  // Apply theme to <html> class list
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      localStorage.setItem("learntrack-theme", theme)
    } catch {
      void theme
    }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <Button
      type="button"
      variant="outline"
      onClick={toggle}
      aria-pressed={theme === "dark"}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="h-9 w-9 p-0 rounded-full border-border/60 transition-all duration-200 hover:scale-[1.03] motion-reduce:transition-none dark:bg-white/5"
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all duration-200 dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all duration-200 dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

