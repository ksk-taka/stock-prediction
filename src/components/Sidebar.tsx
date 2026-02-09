"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState, useEffect, useCallback } from "react";

// ── Context ────────────────────────────────────────────────

interface SidebarContextType {
  open: boolean;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextType>({ open: false, toggle: () => {} });

export function useSidebar() {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("sidebar");
      if (saved === "open") setOpen(true);
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    setOpen((v) => {
      const next = !v;
      try { localStorage.setItem("sidebar", next ? "open" : "closed"); } catch {}
      return next;
    });
  }, []);

  return (
    <SidebarContext.Provider value={{ open, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

// ── Nav Items ──────────────────────────────────────────────

const NAV_ITEMS = [
  {
    href: "/",
    label: "ウォッチリスト",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
      </svg>
    ),
  },
  {
    href: "/new-highs",
    label: "新高値",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
      </svg>
    ),
  },
];

// ── Sidebar Component ──────────────────────────────────────

export default function Sidebar() {
  const { open, toggle } = useSidebar();
  const pathname = usePathname();

  return (
    <>
      {/* Overlay (mobile) */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/30 lg:hidden"
          onClick={toggle}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`fixed top-0 left-0 z-30 flex h-full w-56 flex-col border-r border-gray-200 bg-white pt-14 transition-transform duration-200 dark:border-slate-700 dark:bg-slate-800 lg:static lg:z-0 lg:pt-0 lg:transition-none ${
          open ? "translate-x-0" : "-translate-x-full lg:-translate-x-full"
        }`}
      >
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  // Close sidebar on mobile after navigation
                  if (window.innerWidth < 1024) toggle();
                }}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    : "text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
