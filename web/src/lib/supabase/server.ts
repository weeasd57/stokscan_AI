import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

function getSupabaseUrlAndAnonKey() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

  if (!supabaseUrl || !anonKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return { supabaseUrl, anonKey }
}

export const createSupabaseServerClient = async (request?: NextRequest) => {
  const { supabaseUrl, anonKey } = getSupabaseUrlAndAnonKey()
  const authHeader = request?.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "").trim();
    return createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    }) as any;
  }

  const cookieStore = request?.cookies ?? await cookies()

  return createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            if (request) {
              // A request-backed client can make a rotated cookie visible to
              // downstream code in this request, but cannot attach it to an
              // arbitrary route response. High-traffic read routes therefore
              // use viewer-context and never refresh server-side.
              request.cookies.set(name, value)
            } else {
              ;(cookieStore as any).set(name, value, options)
            }
          }
        } catch {
          // Server Components cannot always mutate cookies. Route handlers and
          // Server Actions can; callers that require persistence own response
          // cookie handling.
        }
      },
    },
  })
}
