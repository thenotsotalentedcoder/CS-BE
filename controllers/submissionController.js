import { supabase } from '../lib/supabase.js';
import { createNotificationForUser } from './notificationController.js';
import { sendEmail } from '../lib/resend.js';

const GITHUB_URL_REGEX = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/;

// POST /api/submissions
export async function submitTask(req, res) {
  const { task_id, github_url, description } = req.body;

  if (!task_id || !github_url || !description) {
    return res.status(400).json({ error: 'task_id, github_url, and description are required' });
  }

  if (!GITHUB_URL_REGEX.test(github_url)) {
    return res.status(400).json({ error: 'Please provide a valid GitHub repository URL (https://github.com/username/repo)' });
  }

  // Verify student is assigned to this task
  const { data: assignment } = await supabase
    .from('task_assignments')
    .select('id')
    .eq('task_id', task_id)
    .eq('student_id', req.user.id)
    .maybeSingle();

  if (!assignment) return res.status(403).json({ error: 'Task not assigned to you' });

  // Check for existing submission
  const { data: existing } = await supabase
    .from('submissions')
    .select('id')
    .eq('task_id', task_id)
    .eq('student_id', req.user.id)
    .maybeSingle();

  if (existing) return res.status(409).json({ error: 'You have already submitted this task' });

  // Fetch task deadline to compute is_late
  const { data: task } = await supabase
    .from('tasks')
    .select('deadline')
    .eq('id', task_id)
    .single();

  const is_late = task ? new Date() > new Date(task.deadline) : false;

  const { data, error } = await supabase
    .from('submissions')
    .insert({
      task_id,
      student_id: req.user.id,
      github_url,
      description,
      is_late,
      status: 'submitted',
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.status(201).json(data);
}

// GET /api/submissions/task/:taskId — admin: all submissions for a task
export async function getTaskSubmissions(req, res) {
  const { taskId } = req.params;

  const { data, error } = await supabase
    .from('submissions')
    .select('*, users(id, full_name, email)')
    .eq('task_id', taskId)
    .order('submitted_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json(data);
}

// GET /api/submissions/:id — admin or submission owner
export async function getSubmission(req, res) {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('submissions')
    .select('*, users(id, full_name, email)')
    .eq('id', id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Submission not found' });

  // Students can only view their own submission
  if (req.user.role === 'student' && data.student_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  return res.json(data);
}

// PATCH /api/submissions/:id/review — admin: post feedback + mark reviewed
export async function reviewSubmission(req, res) {
  const { id } = req.params;
  const { feedback_text, feedback_image_url } = req.body;

  if (!feedback_text) {
    return res.status(400).json({ error: 'feedback_text is required' });
  }

  const { data, error } = await supabase
    .from('submissions')
    .update({
      feedback_text,
      feedback_image_url: feedback_image_url || null,
      status: 'reviewed',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*, tasks(title), users(id, email, full_name)')
    .single();

  if (error || !data) return res.status(404).json({ error: 'Submission not found' });

  // In-app notification
  await createNotificationForUser({
    userId: data.student_id,
    type: 'feedback_posted',
    title: `Feedback on: ${data.tasks.title}`,
    body: feedback_text.slice(0, 100) + (feedback_text.length > 100 ? '...' : ''),
    referenceId: id,
    referenceType: 'submission',
  });

  // Email notification
  await sendEmail({
    to: data.users.email,
    subject: `Feedback posted: ${data.tasks.title}`,
    html: `<p>Hi ${data.users.full_name},</p>
           <p>Your submission for <strong>${data.tasks.title}</strong> has been reviewed.</p>
           <p><strong>Feedback:</strong> ${feedback_text}</p>`,
  });

  return res.json(data);
}
