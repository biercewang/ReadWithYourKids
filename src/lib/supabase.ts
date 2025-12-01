import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const isValidUrl = (url?: string) => typeof url === 'string' && /^(https?:)\/\//.test(url)
export const isSupabaseConfigured = isValidUrl(supabaseUrl) && typeof supabaseAnonKey === 'string' && supabaseAnonKey.length > 0

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : null
