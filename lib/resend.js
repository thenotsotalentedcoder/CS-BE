import { Resend } from 'resend';

export const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail({ to, subject, html }) {
  try {
    await resend.emails.send({
      from: 'ColdStart <onboarding@resend.dev>',
      to,
      subject,
      html,
    });
  } catch (err) {
    // Log but never throw — email failure should not break the main action
    console.error('Email send failed:', err.message);
  }
}
