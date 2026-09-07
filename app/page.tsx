import { redirect } from "next/navigation";

// No landing page. The app opens on the sign-in screen (or the dashboard if
// already signed in — the proxy handles that redirect).
export default function RootPage() {
  redirect("/login");
}
