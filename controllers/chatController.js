import { supabase } from '../lib/supabase.js';
import { generateContent } from '../lib/gemini.js';

const TRACKS = {
  webdev: {
    name: 'Web Development',
    groups: {
      A: 'Foundations — HTML, CSS, and basic JS',
      B: 'Core — MERN Stack (MongoDB, Express, React, Node)',
    }
  },
  ai: {
    name: 'Artificial Intelligence',
    groups: {
      A: 'Essentials — Python Fundamentals, OOP, and Data Structures',
      B: 'Machine Learning — Scikit-learn, Regression, and Classification',
      C: 'Generative AI — LLMs, Prompt Engineering, and FastAPI',
    }
  }
};

const SUMMARIZE_EVERY = 10;

async function buildSystemPrompt(user) {
  const userId = user.id;
  const group = user.group;
  const domain = user.domain || 'webdev';

  // Fetch contextual data in parallel
  const [assignmentsRes, announcementsRes, resourcesRes, taskMessagesRes] = await Promise.all([
    supabase
      .from('task_assignments')
      .select('tasks(id, title, description, deadline, domain, group)')
      .eq('student_id', userId),
    supabase
      .from('announcements')
      .select('title, body, target_domain, created_at')
      .or(`target_domain.eq.all,target_domain.eq.${domain}`)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('resources')
      .select('title, type, category, url, domain')
      .or(`domain.eq.all,domain.eq.${domain}`)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('task_messages')
      .select('content, sender_id, created_at, tasks(title)')
      .eq('student_id', userId)
      .order('created_at', { ascending: false })
      .limit(15),
  ]);

  const discussionMessages = (taskMessagesRes.data || []).reverse();
  const discussionText = discussionMessages.length === 0 ? 'No private discussions yet.' : discussionMessages.map(m => {
    const sender = m.sender_id === userId ? 'Student' : 'Mentor';
    return `[Task: ${m.tasks?.title}] ${sender}: ${m.content}`;
  }).join('\n');

  const taskIds = (assignmentsRes.data || []).map(a => a.tasks.id);
  const { data: submissions } = taskIds.length > 0
    ? await supabase.from('submissions').select('*').eq('student_id', userId).in('task_id', taskIds)
    : { data: [] };

  const submissionMap = Object.fromEntries((submissions || []).map(s => [s.task_id, s]));
  const tasks = (assignmentsRes.data || []).map(a => ({ ...a.tasks, submission: submissionMap[a.tasks.id] || null }));

  const now = new Date();
  const tasksText = tasks.length === 0 ? 'No tasks assigned yet.' : tasks.map(t => {
    const deadline = new Date(t.deadline);
    const sub = t.submission;
    let status = sub ? (sub.status === 'reviewed' ? `Reviewed (Feedback: "${sub.feedback_text}")` : 'Submitted') : 'Not submitted';
    return `- "${t.title}"\n  Description: ${t.description || 'No description provided'}\n  Track: ${t.domain} | Deadline: ${deadline.toDateString()} | Status: ${status}`;
  }).join('\n\n');

  const trackInfo = TRACKS[domain] || TRACKS.webdev;
  const groupInfo = trackInfo.groups[group] || group;

  return `You are Kernel, an AI assistant and mentor at ColdStart — an elite technical accelerator.
Current Domain: ${trackInfo.name}
Student Track: ${groupInfo}

YOUR ROLE:
You are a technical mentor, NOT a task assigner. Your primary purpose is to assist the student with the tasks assigned to them by the Admin/Platform (listed in the "Current Tasks" section below). 

DO NOT assign new tasks. DO NOT create your own curriculum. 
If a student asks for a task, tell them to check their dashboard for platform-assigned tasks.
Your value is in explaining concepts, debugging code, and providing architectural guidance for THEIR existing tasks.

YOUR PERSONA:
If the domain is Web Development, act as a Senior Full-Stack Architect.
If the domain is Artificial Intelligence, act as a Lead Machine Learning Engineer.
Always be professional, concise, and technically accurate. Don't greet every time.

== Student Profile ==
Name: ${user.full_name}
Domain: ${trackInfo.name}
Group: ${user.group} (${groupInfo})

== Current Tasks ==
${tasksText}

== Latest Announcements ==
${(announcementsRes.data || []).map(a => `- ${a.title}: ${a.body}`).join('\n') || 'None yet.'}

== Task Discussions with Mentor ==
${discussionText}

== Track Resources ==
${(resourcesRes.data || []).map(r => `- ${r.title} (${r.type}): ${r.url}`).join('\n') || 'None yet.'}

Today's date: ${now.toDateString()}`;
}

export async function sendMessage(req, res) {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

  const userId = req.user.id;

  // Load user profile including track data
  const { data: userRow } = await supabase
    .from('users')
    .select('id, full_name, role, domain, group, chat_summary, chat_message_count')
    .eq('id', userId)
    .single();

  if (!userRow) return res.status(404).json({ error: 'User not found' });

  // Save user message
  await supabase.from('chat_messages').insert({ user_id: userId, role: 'user', content: message.trim() });

  // History logic
  const { data: recentMessages } = await supabase.from('chat_messages').select('role, content').eq('user_id', userId).order('created_at', { ascending: false }).limit(SUMMARIZE_EVERY);
  const history = (recentMessages || []).reverse().slice(0, -1);
  const geminiHistory = [];

  if (userRow.chat_summary) {
    geminiHistory.push({ role: 'user', parts: [{ text: '[Previous summary]' }] });
    geminiHistory.push({ role: 'model', parts: [{ text: userRow.chat_summary }] });
  }

  for (const msg of history) {
    geminiHistory.push({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.content }] });
  }

  const systemPrompt = await buildSystemPrompt(userRow);
  const fullPrompt = `${systemPrompt}\n\nUser: ${message.trim()}`;

  try {
    const reply = await generateContent(fullPrompt, geminiHistory);
    await supabase.from('chat_messages').insert({ user_id: userId, role: 'assistant', content: reply });
    
    // Update count & summarize...
    const newCount = (userRow.chat_message_count || 0) + 2;
    await supabase.from('users').update({ chat_message_count: newCount }).eq('id', userId);

    return res.json({ reply });
  } catch (err) {
    console.error('Kernel Error:', err);
    return res.status(503).json({ error: 'Kernel is temporarily offline' });
  }
}

export async function getChatHistory(req, res) {
  const { data, error } = await supabase.from('chat_messages').select('id, role, content, created_at').eq('user_id', req.user.id).order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: 'Server error' });
  return res.json(data || []);
}

export async function clearHistory(req, res) {
  await supabase.from('chat_messages').delete().eq('user_id', req.user.id);
  await supabase.from('users').update({ chat_summary: null, chat_message_count: 0 }).eq('id', req.user.id);
  return res.json({ message: 'History cleared' });
}
