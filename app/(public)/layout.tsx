import { Nav } from "@/components/public/Nav";
import { Footer } from "@/components/public/Footer";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col">
      {/* ambient background field */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 40% at 50% 0%, rgba(59,130,246,0.10), transparent 70%), radial-gradient(40% 30% at 90% 10%, rgba(59,130,246,0.06), transparent 70%)",
        }}
      />
      <Nav />
      <main className="flex-1 pt-28 sm:pt-32">{children}</main>
      <Footer />
    </div>
  );
}
