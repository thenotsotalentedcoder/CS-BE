import { supabase } from '../lib/supabase.js';

// GET /api/admin/stats
export async function getDashboardStats(_req, res) {
  const [groupCounts, activeTasks, pendingReviews, lateSubmissions] = await Promise.all([
    // Students per group
    supabase.from('users').select('group').eq('role', 'student').not('group', 'is', null),

    // Active tasks (deadline in future)
    supabase.from('tasks').select('id', { count: 'exact' }).gte('deadline', new Date().toISOString()),

    // Submissions pending review
    supabase.from('submissions').select('id', { count: 'exact' }).eq('status', 'submitted'),

    // Late submissions not yet reviewed
    supabase.from('submissions').select('id, task_id, student_id, submitted_at, tasks(title), users(full_name, email)').eq('is_late', true).eq('status', 'submitted'),
  ]);

  const groups = { A: 0, B: 0, C: 0 };
  for (const s of groupCounts.data || []) {
    if (s.group) groups[s.group]++;
  }

  return res.json({
    students_per_group: groups,
    active_tasks: activeTasks.count ?? 0,
    pending_reviews: pendingReviews.count ?? 0,
    late_submissions: lateSubmissions.data ?? [],
  });
}

// GET /api/admin/allowlist
export async function getAllowlist(_req, res) {
  const { data, error } = await supabase
    .from('allowed_emails')
    .select('id, email, imported_at')
    .order('imported_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json(data);
}

// POST /api/admin/allowlist/import
// Body: { emails: ["a@b.com", "c@d.com", ...] }
// Frontend parses the CSV and sends the array
export async function importAllowlist(req, res) {
  const { emails } = req.body;

  if (!Array.isArray(emails) || !emails.length) {
    return res.status(400).json({ error: 'emails array is required' });
  }

  const normalised = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];

  const rows = normalised.map((email) => ({ email }));

  // upsert — skip duplicates
  const { data, error } = await supabase
    .from('allowed_emails')
    .upsert(rows, { onConflict: 'email', ignoreDuplicates: true })
    .select();

  if (error) return res.status(500).json({ error: 'Server error' });

  return res.json({
    imported: data?.length ?? 0,
    skipped: normalised.length - (data?.length ?? 0),
    total_sent: normalised.length,
  });
}

// PATCH /api/admin/users/:id/role
export async function updateUserRole(req, res) {
  const { id } = req.params;
  const { role } = req.body;

  if (!['admin', 'student'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin or student' });
  }

  // Prevent demoting yourself
  if (id === req.user.id) {
    return res.status(400).json({ error: 'Cannot change your own role' });
  }

  const { data, error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', id)
    .select('id, full_name, email, role')
    .single();

  if (error || !data) return res.status(404).json({ error: 'User not found' });
  return res.json(data);
}

// POST /api/admin/allowlist — single email add
export async function addAllowedEmail(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const normalised = email.trim().toLowerCase();

  const { error } = await supabase
    .from('allowed_emails')
    .insert({ email: normalised });

  if (error?.code === '23505') {
    return res.status(409).json({ error: 'Email already in allowlist' });
  }
  if (error) return res.status(500).json({ error: 'Server error' });

  return res.status(201).json({ message: 'Email added to allowlist' });
}
