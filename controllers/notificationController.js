import { supabase } from '../lib/supabase.js';

// GET /api/notifications
export async function getNotifications(req, res) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json(data);
}

// PATCH /api/notifications/:id/read
export async function markRead(req, res) {
  const { id } = req.params;

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .eq('user_id', req.user.id); // ensure ownership

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json({ message: 'Marked as read' });
}

// PATCH /api/notifications/read-all
export async function markAllRead(req, res) {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', req.user.id)
    .eq('is_read', false);

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json({ message: 'All marked as read' });
}

// Internal helper — creates notification rows for students in a group (or all students)
// Used by resource, task, announcement, and submission controllers
export async function createNotificationsForGroup({ targetGroup, type, title, body, referenceId, referenceType }) {
  let query = supabase.from('users').select('id').eq('role', 'student');

  if (targetGroup !== 'all') {
    query = query.eq('group', targetGroup);
  }

  const { data: students, error } = await query;
  if (error || !students?.length) return;

  const rows = students.map((s) => ({
    user_id: s.id,
    type,
    title,
    body,
    reference_id: referenceId || null,
    reference_type: referenceType || null,
    is_read: false,
  }));

  await supabase.from('notifications').insert(rows);
}

// Internal helper — creates a single notification for one user
export async function createNotificationForUser({ userId, type, title, body, referenceId, referenceType }) {
  await supabase.from('notifications').insert({
    user_id: userId,
    type,
    title,
    body,
    reference_id: referenceId || null,
    reference_type: referenceType || null,
    is_read: false,
  });
}

// Internal helper — creates notifications for a specific list of student IDs
export async function createNotificationsForStudents({ studentIds, type, title, body, referenceId, referenceType }) {
  if (!studentIds?.length) return;

  const rows = studentIds.map((id) => ({
    user_id: id,
    type,
    title,
    body,
    reference_id: referenceId || null,
    reference_type: referenceType || null,
    is_read: false,
  }));

  await supabase.from('notifications').insert(rows);
}
