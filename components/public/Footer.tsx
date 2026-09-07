import Link from "next/link";
import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-border mt-24">
      <div className="mx-auto max-w-5xl px-5 py-12">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">
              Power and distribution transformers engineered for reliability —
              from feeder pillars to plant substations.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 text-[13px]">
            <div className="space-y-2">
              <p className="text-text-tertiary font-medium">Company</p>
              <Link href="/about" className="block text-text-secondary hover:text-text">About</Link>
              <Link href="/products" className="block text-text-secondary hover:text-text">Products</Link>
              <Link href="/contact" className="block text-text-secondary hover:text-text">Contact</Link>
            </div>
            <div className="space-y-2">
              <p className="text-text-tertiary font-medium">Access</p>
              <Link href="/signup" className="block text-text-secondary hover:text-text">Sign In</Link>
              <Link href="/signin" className="block text-text-secondary hover:text-text">Login</Link>
            </div>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-[12px] text-text-tertiary sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} NR Industries. All rights reserved.</p>
          <p>Power at the Best.</p>
        </div>
      </div>
    </footer>
  );
}
