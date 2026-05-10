import { supabase } from '../lib/supabase.js';

// GET /api/admin/stats
export async function getDashboardStats(_req, res) {
  const [userRecords, activeTasks, pendingReviews, lateSubmissions] = await Promise.all([
    // All students with their domain and group
    supabase.from('users').select('domain, group').eq('role', 'student'),

    // Active tasks
    supabase.from('tasks').select('id', { count: 'exact' }).gte('deadline', new Date().toISOString()),

    // Submissions pending review
    supabase.from('submissions').select('id', { count: 'exact' }).eq('status', 'submitted'),

    // Late submissions details
    supabase.from('submissions').select('id, task_id, student_id, submitted_at, tasks(title), users(full_name, email)').eq('is_late', true).eq('status', 'submitted'),
  ]);

  // Breakdown students by domain and group
  const stats = {
    webdev: { A: 0, B: 0 },
    ai: { A: 0, B: 0, C: 0 }
  };

  for (const s of userRecords.data || []) {
    if (s.domain && s.group && stats[s.domain]) {
      stats[s.domain][s.group] = (stats[s.domain][s.group] || 0) + 1;
    }
  }

  return res.json({
    students_breakdown: stats,
    active_tasks: activeTasks.count ?? 0,
    pending_reviews: pendingReviews.count ?? 0,
    late_submissions: lateSubmissions.data ?? [],
  });
}

// GET /api/admin/allowlist
export async function getAllowlist(_req, res) {
  const { data, error } = await supabase
    .from('allowlist')
    .select('*')
    .order('imported_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json(data);
}

// POST /api/admin/allowlist/import
// Body: { users: [{ email: "a@b.com", role: "student", domain: "ai", group: "A" }, ...] }
export async function importAllowlist(req, res) {
  const { users } = req.body;

  if (!Array.isArray(users) || !users.length) {
    return res.status(400).json({ error: 'users array is required' });
  }

  const rows = users.map((u) => ({
    email: u.email.trim().toLowerCase(),
    role: u.role || 'student',
    domain: u.domain,
    group: u.group
  }));

  const { data, error } = await supabase
    .from('allowlist')
    .upsert(rows, { onConflict: 'email', ignoreDuplicates: true })
    .select();

  if (error) return res.status(500).json({ error: 'Server error' });

  return res.json({
    imported: data?.length ?? 0,
    total_sent: users.length,
  });
}

// PATCH /api/admin/users/:id/role
export async function updateUserRole(req, res) {
  const { id } = req.params;
  const { role, domain, group } = req.body;

  const updates = {};
  if (role) updates.role = role;
  if (domain) updates.domain = domain;
  if (group) updates.group = group;

  if (id === req.user.id && role && role !== 'admin') {
    return res.status(400).json({ error: 'Cannot demote yourself' });
  }

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', id)
    .select('id, full_name, email, role, domain, group')
    .single();

  if (error || !data) return res.status(404).json({ error: 'User not found' });
  return res.json(data);
}

// POST /api/admin/allowlist — single email add
export async function addAllowedEmail(req, res) {
  const { email, role, domain, group } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const normalised = email.trim().toLowerCase();

  const { error } = await supabase
    .from('allowlist')
    .insert({ 
      email: normalised, 
      role: role || 'student', 
      domain, 
      group 
    });

  if (error?.code === '23505') {
    return res.status(409).json({ error: 'Email already in allowlist' });
  }
  if (error) return res.status(500).json({ error: 'Server error' });

  return res.status(201).json({ message: 'Email added to allowlist' });
}
