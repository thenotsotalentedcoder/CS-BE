import { supabase } from '../lib/supabase.js';
import { createNotificationsForStudents } from './notificationController.js';
import { sendEmail } from '../lib/resend.js';

// GET /api/tasks/my — student's specifically assigned tasks
export async function getStudentTasks(req, res) {
  const { data, error } = await supabase
    .from('task_assignments')
    .select(`
      assigned_at,
      tasks (
        id, title, description, deadline, reference_image_url, created_at,
        created_by:users(full_name)
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
    created_by_name: a.tasks.created_by?.full_name,
    submission: submissionMap[a.tasks.id] || null,
  }));

  return res.json(result);
}

// GET /api/tasks — all tasks for admin/instructor
export async function getAllTasks(req, res) {
  let query = supabase
    .from('tasks')
    .select('*, created_by:users(full_name)')
    .order('created_at', { ascending: false });

  // Instructors see tasks in their domain
  if (req.user.role === 'instructor') {
    query = query.eq('domain', req.user.domain);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Server error' });
  
  return res.json(data.map(t => ({ ...t, created_by_name: t.created_by?.full_name })));
}

// GET /api/tasks/:id — task detail with assignments + submissions
export async function getTaskById(req, res) {
  const { id } = req.params;

  const { data: task, error } = await supabase
    .from('tasks')
    .select('*, created_by:users(full_name)')
    .eq('id', id)
    .single();

  if (error || !task) return res.status(404).json({ error: 'Task not found' });

  if (req.user.role !== 'student') {
    const { data: assignments } = await supabase
      .from('task_assignments')
      .select('student_id, assigned_at, users(id, full_name, email, group)')
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
      created_by_name: task.created_by?.full_name,
      assignments: (assignments || []).map((a) => ({
        ...a.users,
        submission: submissionMap[a.student_id] || null,
      })),
    });
  }

  // Student — verify assignment
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

  return res.json({ 
    ...task, 
    created_by_name: task.created_by?.full_name,
    submission 
  });
}

// POST /api/tasks — create task + assign to specific students
export async function createTask(req, res) {
  const { title, description, deadline, reference_image_url, student_ids, domain, group } = req.body;

  if (!title || !deadline || !student_ids?.length) {
    return res.status(400).json({ error: 'title, deadline, and student_ids are required' });
  }

  const taskDomain = domain || 'webdev';
  const taskGroup = group || 'A';

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({ 
      title, 
      description, 
      deadline, 
      reference_image_url: reference_image_url || null,
      domain: taskDomain,
      group: taskGroup,
      created_by: req.user.id
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Server error' });

  // Create individual assignments
  const assignments = student_ids.map((sid) => ({
    task_id: task.id,
    student_id: sid,
  }));

  const { error: assignError } = await supabase.from('task_assignments').insert(assignments);
  if (assignError) return res.status(500).json({ error: 'Task created but assignments failed' });

  // Notifications
  await createNotificationsForStudents({
    studentIds: student_ids,
    type: 'task_assigned',
    title: `New task: ${title}`,
    body: `Deadline: ${new Date(deadline).toLocaleDateString()}`,
    referenceId: task.id,
    referenceType: 'task',
  });

  return res.status(201).json(task);
}

// Update an existing task
export async function updateTask(req, res) {
  const { id } = req.params;
  const { title, description, deadline, reference_image_url, domain, group } = req.body;

  const { data, error } = await supabase
    .from('tasks')
    .update({ 
      title, 
      description, 
      deadline, 
      reference_image_url,
      domain: domain || 'webdev',
      group: group || 'A'
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json(data);
}

// Delete a task (cascade will handle assignments/submissions)
export async function deleteTask(req, res) {
  const { id } = req.params;
  
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id);

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json({ message: 'Task deleted successfully' });
}

// Re-adding getAssignableStudents which was missing in the simplified version
export async function getAssignableStudents(req, res) {
  const { domain, group } = req.query;

  let query = supabase
    .from('users')
    .select('id, full_name, email, group, domain')
    .eq('role', 'student');

  if (domain) query = query.eq('domain', domain);
  if (group) query = query.eq('group', group);

  const { data, error } = await query.order('full_name');

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json(data);
}
