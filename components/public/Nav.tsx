"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3 sm:pt-4">
      <motion.nav
        initial={{ y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className={cn(
          "glass w-full max-w-5xl rounded-2xl transition-all duration-300",
          scrolled ? "rounded-2xl" : "rounded-3xl",
        )}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
          <Link href="/" className="text-text hover:opacity-90 transition-opacity">
            <Logo />
          </Link>

          <div className="hidden md:flex items-center gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "nr-interactive rounded-lg px-3 py-1.5 text-[13px] font-medium",
                  pathname === l.href
                    ? "text-text bg-white/[0.06]"
                    : "text-text-secondary hover:text-text hover:bg-white/[0.04]",
                )}
              >
                {l.label}
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-2">
            <Link
              href="/signin"
              className="nr-interactive nr-press rounded-lg border border-border-strong px-3.5 py-1.5 text-[13px] font-medium text-text hover:bg-white/[0.06] hover:border-white/25"
            >
              Sign In
            </Link>
            <Link
              href="/signin?mode=login"
              className="nr-interactive nr-press rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-fg hover:bg-accent-hover hover:shadow-[0_6px_20px_-4px_rgba(59,130,246,0.5)]"
            >
              Login
            </Link>
          </div>

          <button
            onClick={() => setOpen((v) => !v)}
            className="nr-interactive md:hidden inline-flex size-9 items-center justify-center rounded-lg text-text hover:bg-white/[0.06]"
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="md:hidden overflow-hidden border-t border-border"
            >
              <div className="flex flex-col gap-1 p-3">
                {LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm font-medium",
                      pathname === l.href
                        ? "text-text bg-white/[0.06]"
                        : "text-text-secondary hover:text-text hover:bg-white/[0.04]",
                    )}
                  >
                    {l.label}
                  </Link>
                ))}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Link
                    href="/signin"
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-border-strong px-3 py-2 text-center text-sm font-medium text-text"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/signin?mode=login"
                    onClick={() => setOpen(false)}
                    className="rounded-lg bg-accent px-3 py-2 text-center text-sm font-medium text-accent-fg"
                  >
                    Login
                  </Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>
    </div>
  );
}
