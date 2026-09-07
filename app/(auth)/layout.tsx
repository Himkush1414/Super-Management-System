export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(55% 45% at 50% 0%, rgba(59,130,246,0.10), transparent 70%)",
        }}
      />
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
