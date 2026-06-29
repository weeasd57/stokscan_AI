import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Default to scanner redirect
  const next = searchParams.get("next") ?? "/scanner/technical";

  if (code) {
    const cookieStore = cookies();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

    if (!url || !anonKey) {
      return NextResponse.redirect(`${origin}/login?error=Supabase environment variables missing`);
    }

    const supabase = createServerClient(url, anonKey, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch (error) {
            // Can be ignored if handled by middleware or server components
          }
        },
        remove(name: string, options: any) {
          try {
            cookieStore.delete({ name, ...options });
          } catch (error) {
            // Can be ignored
          }
        },
      },
    });

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Check if user is admin to redirect accordingly
      const { data: { user } } = await supabase.auth.getUser();
      const isAdmin =
        user?.app_metadata?.role === "admin" ||
        (user?.email && ["weeeessd57@gmail.com", "weeasd57@gmail.com"].includes(user.email));
      const finalDest = isAdmin ? "/admin" : next;
      return NextResponse.redirect(`${origin}${finalDest}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=Authentication failed`);
}
