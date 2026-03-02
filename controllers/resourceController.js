import { supabase } from '../lib/supabase.js';
import { createNotificationsForGroup } from './notificationController.js';
import { sendEmail } from '../lib/resend.js';

export async function getPublicResources(_req, res) {
  const { data, error } = await supabase
    .from('resources')
    .select('id, title, type, url, category, subtitle')
    .eq('is_public', true)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json(data);
}

export async function getStudentResources(req, res) {
  const { group, role } = req.user;

  let query = supabase
    .from('resources')
    .select('id, title, type, url, target_group, is_public, category, subtitle, created_at')
    .order('created_at', { ascending: false });

  // Admin sees all resources; students only see their group + global
  if (role !== 'admin') {
    query = query.or(`target_group.eq.all,target_group.eq.${group}`);
  }

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: 'Server error' });

  // Attach saved status for this student
  const { data: saved } = await supabase
    .from('saved_resources')
    .select('resource_id')
    .eq('student_id', req.user.id);

  const savedIds = new Set((saved || []).map((s) => s.resource_id));
  const result = data.map((r) => ({ ...r, is_saved: savedIds.has(r.id) }));

  return res.json(result);
}

export async function createResource(req, res) {
  const { title, type, url, target_group, is_public, category, subtitle } = req.body;
  if (!title || !type || !url || !target_group) {
    return res.status(400).json({ error: 'title, type, url, and target_group are required' });
  }

  const { data, error } = await supabase
    .from('resources')
    .insert({ title, type, url, target_group, is_public: !!is_public, category: category || 'misc', subtitle: subtitle || null })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Server error' });

  // Only notify students if resource is assigned to a group
  if (target_group !== 'none') {
    await createNotificationsForGroup({
      targetGroup: target_group,
      type: 'resource_posted',
      title: `New resource: ${title}`,
      body: `A new ${type} resource has been posted for your group.`,
      referenceId: data.id,
      referenceType: 'resource',
    });
  }

  return res.status(201).json(data);
}

export async function updateResource(req, res) {
  const { id } = req.params;
  const { title, type, url, target_group, is_public, category, subtitle } = req.body;

  const { data, error } = await supabase
    .from('resources')
    .update({ title, type, url, target_group, is_public, category: category || 'misc', subtitle: subtitle || null })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Server error' });
  if (!data) return res.status(404).json({ error: 'Resource not found' });

  return res.json(data);
}

export async function deleteResource(req, res) {
  const { id } = req.params;

  const { error } = await supabase.from('resources').delete().eq('id', id);
  if (error) return res.status(500).json({ error: 'Server error' });

  return res.json({ message: 'Resource deleted' });
}

export async function saveResource(req, res) {
  const { id } = req.params;

  const { error } = await supabase
    .from('saved_resources')
    .insert({ student_id: req.user.id, resource_id: id });

  if (error?.code === '23505') return res.status(409).json({ error: 'Already saved' });
  if (error) return res.status(500).json({ error: 'Server error' });

  return res.json({ message: 'Saved' });
}

export async function unsaveResource(req, res) {
  const { id } = req.params;

  const { error } = await supabase
    .from('saved_resources')
    .delete()
    .eq('student_id', req.user.id)
    .eq('resource_id', id);

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json({ message: 'Unsaved' });
}

export async function getSavedResources(req, res) {
  const { data, error } = await supabase
    .from('saved_resources')
    .select('resource_id, resources(id, title, type, url, target_group, category, subtitle)')
    .eq('student_id', req.user.id)
    .order('saved_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Server error' });

  return res.json(data.map((s) => ({ ...s.resources, saved_at: s.saved_at })));
}
