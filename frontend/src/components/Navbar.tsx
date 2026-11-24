"use client";

import React, { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import type { HealthStatus } from "@/lib/types";

export type Tab = "workbench" | "research";

interface NavbarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  health: HealthStatus | null;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "workbench", label: "Screening" },
  { id: "research", label: "Research" },
];

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        localStorage.setItem("cb-theme", next);
        setTheme(next);
      }}
      aria-label={`Switch to ${next} theme`}
      className="grid h-11 w-11 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink"
    >
      {theme === "dark" ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
    </button>
  );
}

export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 68 68" className={className} aria-hidden>
      <rect width="68" height="68" rx="16" className="fill-primary" />
      <path
        d="M8 38 H15 L19 32 L23 44 L28 16 L34 52 L38 36 H42 C46 36, 47 24, 52 24 C57 24, 57 44, 62 44"
        fill="none"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: "var(--primary-ink)" }}
      />
    </svg>
  );
}

export default function Navbar({ activeTab, onTabChange, health }: NavbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <a href="#top" className="flex items-center gap-2.5 rounded-lg font-semibold tracking-tight">
          <BrandMark />
          <span className="text-lg">CardioBreath</span>
        </a>

        <nav aria-label="Main" className="flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              aria-current={activeTab === t.id ? "page" : undefined}
              className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors sm:px-4 ${
                activeTab === t.id ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
          <span className="mx-2 hidden items-center gap-2 text-xs text-muted md:inline-flex" role="status">
            <span className={`h-2 w-2 rounded-full ${health ? "bg-primary" : "bg-mild"}`} aria-hidden />
            {health ? `Model ready · ${health.n_onnx_folds}-model ensemble` : "Connecting…"}
          </span>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
