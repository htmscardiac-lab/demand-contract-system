// Supabase client. Connection details come from the .env file (see .env.example):
//   VITE_SUPABASE_URL       Project URL
//   VITE_SUPABASE_ANON_KEY  anon / publishable key (safe to ship in the browser; RLS protects the data)
import { createClient } from '@supabase/supabase-js'

export const SUPA_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!SUPA_URL || !SUPA_KEY) {
  const msg = 'Supabase is not configured. Copy .env.example to .env, fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart "npm run dev".'
  document.body.innerHTML = `<div style="font-family:system-ui;max-width:560px;margin:80px auto;padding:24px;border:1px solid #fca5a5;border-radius:12px;background:#fef2f2;color:#991b1b">${msg}</div>`
  throw new Error(msg)
}

export const supabase = createClient(SUPA_URL, SUPA_KEY)

// Public URL of a part image stored in the "part-images" bucket.
export const imgUrl = (p) => p ? `${SUPA_URL}/storage/v1/object/public/part-images/${p}` : null
