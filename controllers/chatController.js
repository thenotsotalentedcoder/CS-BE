import { supabase } from '../lib/supabase.js';
import { generateContent } from '../lib/gemini.js';

const GROUP_DESC = {
  A: 'Beginner track — HTML/CSS fundamentals',
  B: 'Intermediate track — JavaScript and DOM',
  C: 'Advanced track — Full-stack MERN',
};

const SUMMARIZE_EVERY = 10; // messages since last summary

async function buildSystemPrompt(user) {
  const userId = user.id;
  const group = user.group;

  // Fetch tasks + submissions in parallel with announcements + resources
  const [assignmentsRes, announcementsRes, resourcesRes] = await Promise.all([
    supabase
      .from('task_assignments')
      .select('tasks(id, title, deadline)')
      .eq('student_id', userId),
    supabase
      .from('announcements')
      .select('title, body, target_group, created_at')
      .or(`target_group.eq.all,target_group.eq.${group}`)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('resources')
      .select('title, type, category, url')
      .or(`target_group.eq.all,target_group.eq.${group}`)
      .order('created_at', { ascending: false }),
  ]);

  const taskIds = (assignmentsRes.data || []).map(a => a.tasks.id);

  const { data: submissions } = taskIds.length > 0
    ? await supabase
        .from('submissions')
        .select('task_id, status, is_late, submitted_at, feedback_text, reviewed_at')
        .eq('student_id', userId)
        .in('task_id', taskIds)
    : { data: [] };

  const submissionMap = Object.fromEntries(
    (submissions || []).map(s => [s.task_id, s])
  );

  const tasks = (assignmentsRes.data || []).map(a => ({
    ...a.tasks,
    submission: submissionMap[a.tasks.id] || null,
  }));

  // Format tasks
  const now = new Date();
  const tasksText = tasks.length === 0
    ? 'No tasks assigned yet.'
    : tasks.map(t => {
        const deadline = new Date(t.deadline);
        const isPast = deadline < now;
        const sub = t.submission;
        let status = 'Not submitted';
        if (sub) {
          if (sub.status === 'reviewed') status = `Reviewed${sub.feedback_text ? ` — Feedback: "${sub.feedback_text}"` : ''}`;
          else if (sub.is_late) status = 'Submitted (late)';
          else status = 'Submitted, awaiting review';
        }
        return `- "${t.title}" | Deadline: ${deadline.toDateString()}${isPast ? ' (past)' : ''} | Status: ${status}`;
      }).join('\n');

  // Format announcements
  const announcementsText = (announcementsRes.data || []).length === 0
    ? 'No announcements.'
    : (announcementsRes.data || []).map(a =>
        `- [${new Date(a.created_at).toDateString()}] "${a.title}": ${a.body}`
      ).join('\n');

  // Format resources
  const resourcesText = (resourcesRes.data || []).length === 0
    ? 'No resources available.'
    : (resourcesRes.data || []).map(r =>
        `- ${r.title} (${r.type}${r.category ? `, ${r.category}` : ''}): ${r.url}`
      ).join('\n');

  return `You are Kernel, an AI assistant embedded in ColdStart — a private web development learning platform.
You are talking to a specific student. Be helpful, concise, and direct.
You can discuss anything — general topics, coding help, platform questions — you are not restricted to platform data.
Do NOT greet the student at the start of every reply. Only greet if this is clearly the very first message in the conversation (no prior history). Respond naturally as if continuing an ongoing chat.
Format your replies using markdown where appropriate (bold, lists, code blocks).

== Student Profile ==
Name: ${user.full_name}
Group: ${group} — ${GROUP_DESC[group] || group}
Skill level: ${user.skill_level || 'not set'}

== Assigned Tasks ==
${tasksText}

== Recent Announcements ==
${announcementsText}

== Available Resources ==
${resourcesText}

Today's date: ${now.toDateString()}`;
}

// GET /api/chat/history
export async function getChatHistory(req, res) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json(data || []);
}

// POST /api/chat
export async function sendMessage(req, res) {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

  const userId = req.user.id;

  // Load user row (need chat_summary + chat_message_count)
  const { data: userRow } = await supabase
    .from('users')
    .select('id, full_name, group, skill_level, chat_summary, chat_message_count')
    .eq('id', userId)
    .single();

  if (!userRow?.group) return res.status(403).json({ error: 'No group assigned' });

  // Save user message
  await supabase.from('chat_messages').insert({
    user_id: userId,
    role: 'user',
    content: message.trim(),
  });

  // Load recent messages since last summary (up to SUMMARIZE_EVERY)
  const { data: recentMessages } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(SUMMARIZE_EVERY);

  const history = (recentMessages || []).reverse().slice(0, -1); // exclude the message we just saved

  // Build Gemini history format
  const geminiHistory = [];

  if (userRow.chat_summary) {
    geminiHistory.push({
      role: 'user',
      parts: [{ text: '[Previous conversation summary]' }],
    });
    geminiHistory.push({
      role: 'model',
      parts: [{ text: userRow.chat_summary }],
    });
  }

  for (const msg of history) {
    geminiHistory.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    });
  }

  // Build system prompt with fresh context
  const systemPrompt = await buildSystemPrompt(userRow);
  const fullPrompt = `${systemPrompt}\n\n== User message ==\n${message.trim()}`;

  let reply;
  try {
    reply = await generateContent(fullPrompt, geminiHistory);
  } catch (err) {
    console.error('Gemini error:', err.message);
    return res.status(503).json({ error: 'AI unavailable, please try again shortly' });
  }

  // Save assistant reply
  await supabase.from('chat_messages').insert({
    user_id: userId,
    role: 'assistant',
    content: reply,
  });

  // Update message count
  const newCount = (userRow.chat_message_count || 0) + 2; // user + assistant
  await supabase.from('users').update({ chat_message_count: newCount }).eq('id', userId);

  // Summarization checkpoint — every SUMMARIZE_EVERY messages
  if (newCount % SUMMARIZE_EVERY === 0) {
    try {
      const { data: toSummarize } = await supabase
        .from('chat_messages')
        .select('role, content')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(SUMMARIZE_EVERY);

      const block = (toSummarize || []).reverse()
        .map(m => `${m.role === 'user' ? 'Student' : 'Kernel'}: ${m.content}`)
        .join('\n');

      const summaryPrompt = `Summarize this conversation in 4-6 sentences. Preserve key topics discussed, questions asked, and conclusions or advice given.\n\n${block}`;
      const summary = await generateContent(summaryPrompt);

      await supabase.from('users').update({ chat_summary: summary }).eq('id', userId);
    } catch {
      // Summarization failure is non-critical, continue
    }
  }

  return res.json({ reply });
}

// DELETE /api/chat/history
export async function clearHistory(req, res) {
  const userId = req.user.id;
  await supabase.from('chat_messages').delete().eq('user_id', userId);
  await supabase.from('users').update({ chat_summary: null, chat_message_count: 0 }).eq('id', userId);
  return res.json({ message: 'History cleared' });
}
