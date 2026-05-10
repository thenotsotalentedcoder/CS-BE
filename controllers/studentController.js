import { supabase } from '../lib/supabase.js';

// GET /api/students — all students (admin)
export async function getAllStudents(_req, res) {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, domain, group, created_at')
    .eq('role', 'student')
    .order('full_name');

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json(data);
}

// GET /api/students/:id/profile — full student profile (admin)
export async function getStudentProfile(req, res) {
  const { id } = req.params;

  const { data: student, error } = await supabase
    .from('users')
    .select('id, full_name, email, role, domain, group, created_at')
    .eq('id', id)
    .eq('role', 'student')
    .single();

  if (error || !student) return res.status(404).json({ error: 'Student not found' });

  // Get all assigned tasks with submission status
  const { data: assignments } = await supabase
    .from('task_assignments')
    .select('assigned_at, tasks(id, title, deadline)')
    .eq('student_id', id);

  const taskIds = (assignments || []).map((a) => a.tasks.id);

  const { data: submissions } = await supabase
    .from('submissions')
    .select('id, task_id, status, is_late, submitted_at, feedback_text, reviewed_at')
    .eq('student_id', id)
    .in('task_id', taskIds);

  const submissionMap = Object.fromEntries(
    (submissions || []).map((s) => [s.task_id, s])
  );

  const tasks = (assignments || []).map((a) => ({
    ...a.tasks,
    submission: submissionMap[a.tasks.id] || null,
  }));

  return res.json({ ...student, tasks });
}

// PATCH /api/students/:id/group
export async function assignGroup(req, res) {
  const { id } = req.params;
  const { group } = req.body;

  const validGroups = ['A', 'B', 'C'];
  if (!validGroups.includes(group)) {
    return res.status(400).json({ error: 'group must be A, B, or C' });
  }

  const { data, error } = await supabase
    .from('users')
    .update({ group })
    .eq('id', id)
    .eq('role', 'student')
    .select('id, full_name, group')
    .single();

  if (error || !data) return res.status(404).json({ error: 'Student not found' });
  return res.json(data);
}
