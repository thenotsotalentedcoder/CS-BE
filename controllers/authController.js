import { supabase } from '../lib/supabase.js';

// POST /api/auth/check-email
// Checks if email exists in allowed_emails table
export async function checkEmail(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const normalised = email.trim().toLowerCase();

  const { data, error } = await supabase
    .from('allowed_emails')
    .select('id')
    .eq('email', normalised)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Server error' });

  return res.json({ allowed: !!data });
}

// POST /api/auth/signup
// Creates Supabase Auth user + inserts users row
export async function signup(req, res) {
  const { email, password, full_name } = req.body;
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'email, password, and full_name are required' });
  }

  const normalised = email.trim().toLowerCase();

  // Double-check allowlist (don't trust client-side check alone)
  const { data: allowed } = await supabase
    .from('allowed_emails')
    .select('id')
    .eq('email', normalised)
    .maybeSingle();

  if (!allowed) {
    return res.status(403).json({ error: 'This email is not enrolled. Contact the admin.' });
  }

  // Create Auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: normalised,
    password,
    email_confirm: true,
  });

  if (authError) {
    if (authError.message?.toLowerCase().includes('already')) {
      return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    }
    return res.status(500).json({ error: authError.message });
  }

  // Insert users row
  const { error: dbError } = await supabase.from('users').insert({
    id: authData.user.id,
    email: normalised,
    full_name: full_name.trim(),
    role: 'student',
  });

  if (dbError) {
    // Auth user created but DB insert failed — clean up Auth user
    await supabase.auth.admin.deleteUser(authData.user.id);
    return res.status(500).json({ error: 'Account creation failed. Please try again.' });
  }

  return res.status(201).json({ message: 'Account created. Please log in.' });
}

// GET /api/auth/me — returns the logged-in user's DB row
export async function getMe(req, res) {
  return res.json(req.user);
}
