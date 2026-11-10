export const SALES_INTRO_EMAIL_SUBJECT = 'Introducing Everycall — your AI receptionist';

export function salesIntroEmailText(firstName) {
  const name = String(firstName || '').replace(/[\r\n\u0000-\u001f\u007f]/g, '').trim();
  return `Hi ${name || 'there'},

I wanted to take a moment to introduce you to Everycall, an AI-powered receptionist designed to help service businesses handle incoming calls and capture more leads.

With Everycall, your business can:

Answer incoming calls 24/7, even after business hours.
Capture customer details and qualify potential leads.
Handle multiple incoming calls simultaneously.
Send call summaries directly to your team.
Transfer callers to the appropriate team member when needed.

Our goal is simple: help businesses avoid missed opportunities while allowing their teams to focus on running their operations.

You can learn more about us and experience our live demo here:
https://www.everycall.io/

Would you be open to taking a quick look?

Best regards,
Ram
Everycall Team`;
}
