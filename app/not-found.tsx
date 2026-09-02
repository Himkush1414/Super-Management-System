import Link from "next/link";
import { Logo } from "@/components/public/Logo";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <Logo />
      <p className="mt-8 text-5xl font-semibold tracking-tight tnum">404</p>
      <p className="mt-2 text-[15px] text-text-secondary">
        That page doesn&apos;t exist.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg border border-border-strong px-4 py-2 text-sm font-medium hover:bg-white/[0.05]"
      >
        Back home
      </Link>
    </div>
  );
}
