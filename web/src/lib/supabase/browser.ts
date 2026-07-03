"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  
  if (!url || !anonKey) {
    console.error('Missing Supabase environment variables:', { 
      hasUrl: !!url, 
      hasAnonKey: !!anonKey 
    });
    throw new Error("Missing Supabase env vars - check Vercel environment variables");
  }
  
  return createBrowserClient(url, anonKey);
}
