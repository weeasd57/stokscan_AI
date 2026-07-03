import { createClient } from '@supabase/supabase-js'

// Lazy initialization to avoid build-time errors
let _supabaseServer: ReturnType<typeof createClient> | null = null

function getSupabaseServer() {
  if (_supabaseServer) return _supabaseServer

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables')
  }

  _supabaseServer = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })

  return _supabaseServer
}

// Only export the function, not a pre-initialized client
export const createSupabaseServerClient = () => getSupabaseServer()