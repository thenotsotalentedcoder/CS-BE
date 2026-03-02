import { createClient } from '@supabase/supabase-js';

// Service role client — never exposed to frontend
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
