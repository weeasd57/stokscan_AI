import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

function getSupabaseUrlAndAnonKey() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

  if (!supabaseUrl || !anonKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return { supabaseUrl, anonKey }
}

export const createSupabaseServerClient = (request?: NextRequest) => {
  const { supabaseUrl, anonKey } = getSupabaseUrlAndAnonKey()
  const authHeader = request?.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "").trim();
    return createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    }) as any;
  }

  const cookieStore = request?.cookies ?? cookies()

  return createServerClient(supabaseUrl, anonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value
      },
      set(name: string, value: string, options: any) {
        try {
          if ("set" in cookieStore) {
            cookieStore.set({ name, value, ...options })
          }
        } catch {}
      },
      remove(name: string, options: any) {
        try {
          if ("delete" in cookieStore) {
            cookieStore.delete({ name, ...options })
          }
        } catch {}
      },
    },
  })
}
