import Link from "next/link";
import { Logo } from "@/components/public/Logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(50% 40% at 50% 0%, rgba(59,130,246,0.10), transparent 70%)",
        }}
      />
      <Link href="/" className="mb-8 text-text">
        <Logo />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-8 text-[12px] text-text-tertiary">
        NR Industries — access is granted internally.
      </p>
    </div>
  );
}
