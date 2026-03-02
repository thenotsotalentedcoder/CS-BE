import { supabase } from '../lib/supabase.js';
import { createNotificationsForGroup } from './notificationController.js';
import { sendEmail } from '../lib/resend.js';

// GET /api/announcements — returns announcements relevant to the logged-in user
export async function getAnnouncements(req, res) {
  const { role, group } = req.user;

  let query = supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });

  if (role === 'student') {
    query = query.or(`target_group.eq.all,target_group.eq.${group}`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json(data);
}

// POST /api/announcements — admin: create announcement
export async function createAnnouncement(req, res) {
  const { title, body, target_group } = req.body;

  if (!title || !body || !target_group) {
    return res.status(400).json({ error: 'title, body, and target_group are required' });
  }

  const { data, error } = await supabase
    .from('announcements')
    .insert({ title, body, target_group })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Server error' });

  // In-app notifications
  await createNotificationsForGroup({
    targetGroup: target_group,
    type: 'announcement',
    title,
    body: body.slice(0, 150) + (body.length > 150 ? '...' : ''),
    referenceId: data.id,
    referenceType: 'announcement',
  });

  // Email notifications
  let studentQuery = supabase.from('users').select('email, full_name').eq('role', 'student');
  if (target_group !== 'all') studentQuery = studentQuery.eq('group', target_group);
  const { data: students } = await studentQuery;

  for (const student of students || []) {
    await sendEmail({
      to: student.email,
      subject: `Announcement: ${title}`,
      html: `<p>Hi ${student.full_name},</p><p><strong>${title}</strong></p><p>${body}</p>`,
    });
  }

  return res.status(201).json(data);
}

// PUT /api/announcements/:id
export async function updateAnnouncement(req, res) {
  const { id } = req.params;
  const { title, body, target_group } = req.body;

  const { data, error } = await supabase
    .from('announcements')
    .update({ title, body, target_group })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Server error' });
  if (!data) return res.status(404).json({ error: 'Announcement not found' });

  return res.json(data);
}

// DELETE /api/announcements/:id
export async function deleteAnnouncement(req, res) {
  const { id } = req.params;
  const { error } = await supabase.from('announcements').delete().eq('id', id);
  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json({ message: 'Announcement deleted' });
}
