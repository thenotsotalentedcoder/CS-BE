import { supabase } from '../lib/supabase.js';

export async function getTaskMessages(req, res) {
  const { taskId } = req.params;
  const { studentId } = req.query; // Admin can specify studentId
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';

  let targetStudentId = studentId || userId;

  // If not admin, you can only see your own messages
  if (!isAdmin) {
    targetStudentId = userId;
  }

  const { data, error } = await supabase
    .from('task_messages')
    .select('*')
    .eq('task_id', taskId)
    .eq('student_id', targetStudentId)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: 'Server error' });

  // Mark as read if being fetched by the other party
  // (In a real app, you'd be more specific, but for now we'll mark all as read for this thread)
  const unreadMessages = data.filter(m => !m.is_read && m.sender_id !== userId);
  if (unreadMessages.length > 0) {
    await supabase
      .from('task_messages')
      .update({ is_read: true })
      .in('id', unreadMessages.map(m => m.id));
  }

  return res.json(data);
}

export async function sendTaskMessage(req, res) {
  const { taskId } = req.params;
  const { content, studentId } = req.body;
  const senderId = req.user.id;
  const isAdmin = req.user.role === 'admin';

  if (!content?.trim()) return res.status(400).json({ error: 'Message content required' });

  let targetStudentId = studentId || senderId;
  if (!isAdmin) {
    targetStudentId = senderId;
  }

  if (!targetStudentId) return res.status(400).json({ error: 'studentId is required' });

  const { data, error } = await supabase
    .from('task_messages')
    .insert({
      task_id: taskId,
      student_id: targetStudentId,
      sender_id: senderId,
      content: content.trim(),
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Server error' });

  // Create a global notification for the recipient
  const recipientId = isAdmin ? targetStudentId : null; // If student sends, we need to notify admin
  
  // Actually, we should notify the specific student if admin sends, 
  // or notify the task creator if student sends.
  let notifyId = targetStudentId;
  let notifyTitle = 'New message from mentor';
  let notifyBody = content.length > 50 ? content.substring(0, 47) + '...' : content;

  if (!isAdmin) {
    // Notify the admin who created the task (or just all admins if you prefer, 
    // but usually the task creator is the mentor)
    const { data: taskData } = await supabase
      .from('tasks')
      .select('created_by')
      .eq('id', taskId)
      .single();
    
    notifyId = taskData?.created_by;
    notifyTitle = 'New message from student';
  }

  if (notifyId && notifyId !== senderId) {
    await supabase.from('notifications').insert({
      user_id: notifyId,
      type: 'chat_message',
      title: notifyTitle,
      body: notifyBody,
      reference_id: taskId,
      reference_type: 'task'
    });
  }

  return res.status(201).json(data);
}

export async function getUnreadCounts(req, res) {
  const { taskId } = req.params;
  const isAdmin = req.user.role === 'admin';

  if (!isAdmin) {
     // Student side unread (messages from admin)
     const { data, error } = await supabase
       .from('task_messages')
       .select('id')
       .eq('task_id', taskId)
       .eq('student_id', req.user.id)
       .neq('sender_id', req.user.id)
       .eq('is_read', false);
     
     if (error) return res.status(500).json({ error: 'Server error' });
     return res.json({ count: data.length });
  }

  // Admin side: get unread counts per student for this task
  const { data, error } = await supabase
    .from('task_messages')
    .select('student_id')
    .eq('task_id', taskId)
    .neq('sender_id', req.user.id)
    .eq('is_read', false);

  if (error) return res.status(500).json({ error: 'Server error' });

  const counts = {};
  data.forEach(m => {
    counts[m.student_id] = (counts[m.student_id] || 0) + 1;
  });

  return res.json(counts);
}
