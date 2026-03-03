import { supabase } from '../lib/supabase.js';
import { createNotificationsForStudents } from './notificationController.js';
import { sendEmail } from '../lib/resend.js';

// GET /api/tasks/my — student's assigned tasks
export async function getStudentTasks(req, res) {
  const { data, error } = await supabase
    .from('task_assignments')
    .select(`
      assigned_at,
      tasks (
        id, title, description, deadline, reference_image_url, created_at
      )
    `)
    .eq('student_id', req.user.id)
    .order('assigned_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Server error' });

  // Attach submission status for each task
  const taskIds = data.map((a) => a.tasks.id);
  const { data: submissions } = await supabase
    .from('submissions')
    .select('task_id, status, is_late')
    .eq('student_id', req.user.id)
    .in('task_id', taskIds);

  const submissionMap = Object.fromEntries(
    (submissions || []).map((s) => [s.task_id, s])
  );

  const result = data.map((a) => ({
    ...a.tasks,
    submission: submissionMap[a.tasks.id] || null,
  }));

  return res.json(result);
}

// GET /api/tasks — admin: all tasks
export async function getAllTasks(_req, res) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json(data);
}

// GET /api/tasks/:id — task detail with assignments + submissions (admin) or own submission (student)
export async function getTaskById(req, res) {
  const { id } = req.params;

  const { data: task, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !task) return res.status(404).json({ error: 'Task not found' });

  if (req.user.role === 'admin') {
    // Return full assignment + submission overview
    const { data: assignments } = await supabase
      .from('task_assignments')
      .select('student_id, assigned_at, users(id, full_name, email, group, skill_level)')
      .eq('task_id', id);

    const { data: submissions } = await supabase
      .from('submissions')
      .select('id, student_id, status, is_late, submitted_at')
      .eq('task_id', id);

    const submissionMap = Object.fromEntries(
      (submissions || []).map((s) => [s.student_id, s])
    );

    return res.json({
      ...task,
      assignments: (assignments || []).map((a) => ({
        ...a.users,
        submission: submissionMap[a.student_id] || null,
      })),
    });
  }

  // Student — verify they are assigned to this task
  const { data: assignment } = await supabase
    .from('task_assignments')
    .select('id')
    .eq('task_id', id)
    .eq('student_id', req.user.id)
    .maybeSingle();

  if (!assignment) return res.status(403).json({ error: 'Task not assigned to you' });

  const { data: submission } = await supabase
    .from('submissions')
    .select('*')
    .eq('task_id', id)
    .eq('student_id', req.user.id)
    .maybeSingle();

  return res.json({ ...task, submission });
}

// POST /api/tasks — admin: create task + assign to students
export async function createTask(req, res) {
  const { title, description, deadline, reference_image_url, student_ids } = req.body;

  if (!title || !description || !deadline || !student_ids?.length) {
    return res.status(400).json({ error: 'title, description, deadline, and student_ids are required' });
  }

  // Create the task
  const { data: task, error } = await supabase
    .from('tasks')
    .insert({ title, description, deadline, reference_image_url: reference_image_url || null })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Server error' });

  // Create assignments
  const assignments = student_ids.map((sid) => ({
    task_id: task.id,
    student_id: sid,
  }));

  const { error: assignError } = await supabase.from('task_assignments').insert(assignments);
  if (assignError) return res.status(500).json({ error: 'Task created but assignments failed' });

  // In-app notifications
  await createNotificationsForStudents({
    studentIds: student_ids,
    type: 'task_assigned',
    title: `New task: ${title}`,
    body: `Deadline: ${new Date(deadline).toLocaleDateString()}`,
    referenceId: task.id,
    referenceType: 'task',
  });

  // Email notifications
  const { data: students } = await supabase
    .from('users')
    .select('email, full_name')
    .in('id', student_ids);

  for (const student of students || []) {
    await sendEmail({
      to: student.email,
      subject: `New task assigned: ${title}`,
      html: `<p>Hi ${student.full_name},</p>
             <p>A new task has been assigned to you: <strong>${title}</strong></p>
             <p>${description}</p>
             <p><strong>Deadline:</strong> ${new Date(deadline).toLocaleString()}</p>`,
    });
  }

  return res.status(201).json(task);
}

// PUT /api/tasks/:id — admin: edit task + update assignments
export async function updateTask(req, res) {
  const { id } = req.params;
  const { title, description, deadline, reference_image_url, student_ids } = req.body;

  const { data, error } = await supabase
    .from('tasks')
    .update({ title, description, deadline, reference_image_url })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Server error' });
  if (!data) return res.status(404).json({ error: 'Task not found' });

  // Update assignments if student_ids provided
  if (Array.isArray(student_ids)) {
    // Get current assignments
    const { data: existing } = await supabase
      .from('task_assignments')
      .select('student_id')
      .eq('task_id', id);

    const currentIds = (existing || []).map(a => a.student_id);
    const toAdd = student_ids.filter(sid => !currentIds.includes(sid));
    const toRemove = currentIds.filter(sid => !student_ids.includes(sid));

    if (toRemove.length > 0) {
      await supabase
        .from('task_assignments')
        .delete()
        .eq('task_id', id)
        .in('student_id', toRemove);
    }

    if (toAdd.length > 0) {
      await supabase
        .from('task_assignments')
        .insert(toAdd.map(sid => ({ task_id: id, student_id: sid })));

      // Notify newly assigned students
      await createNotificationsForStudents({
        studentIds: toAdd,
        type: 'task_assigned',
        title: `New task: ${title}`,
        body: `Deadline: ${new Date(deadline).toLocaleDateString()}`,
        referenceId: id,
        referenceType: 'task',
      });
    }
  }

  return res.json(data);
}

// DELETE /api/tasks/:id — admin: delete task
export async function deleteTask(req, res) {
  const { id } = req.params;
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json({ message: 'Task deleted' });
}

// GET /api/tasks/assignable-students?group=A&skill_level=beginner
// Admin uses this to populate the student picker when creating a task
export async function getAssignableStudents(req, res) {
  const { group, skill_level } = req.query;

  let query = supabase
    .from('users')
    .select('id, full_name, email, group, skill_level')
    .eq('role', 'student')
    .not('group', 'is', null); // exclude unassigned students

  if (group) query = query.eq('group', group);
  if (skill_level) query = query.eq('skill_level', skill_level);

  const { data, error } = await query.order('full_name');

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json(data);
}
