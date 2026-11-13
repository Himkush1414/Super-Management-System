/**
 * The browser Supabase client, loaded on first use. supabase-js is about
 * 68 KB (gzip); imported directly, every dashboard page had to download and
 * run it before it could respond to a tap, although only the live updates
 * and the notification bell use it, after the page is up. Same client
 * (createBrowserClient keeps one per page).
 */
export const browserClient = () => import("@/lib/supabase/client").then((mod) => mod.createClient());
