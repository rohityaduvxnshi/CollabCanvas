/**
 * Outbound email (Phase 7). Resend's plain HTTP API via fetch — no SDK.
 * Without RESEND_API_KEY (local dev) the code is logged to the server console.
 */

/** Branded HTML for the code email. `code` is a 6-digit number → no escaping needed. */
function codeEmailHtml(code: string): string {
  return `
  <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4ecd8;padding:32px 16px;">
    <div style="max-width:420px;margin:0 auto;background:#fffdf7;border:2px solid #1c1a17;border-radius:16px;box-shadow:5px 5px 0 #1c1a17;padding:28px;text-align:center;">
      <div style="display:inline-block;width:40px;height:40px;line-height:38px;background:#ffd84d;border:2px solid #1c1a17;border-radius:10px;font-weight:700;font-size:20px;color:#1c1a17;">C</div>
      <h1 style="font-size:18px;color:#1c1a17;margin:16px 0 4px;">Your verification code</h1>
      <p style="font-size:13px;color:#6b6455;margin:0 0 20px;">Enter this code to finish signing in to CollabCanvas.</p>
      <div style="font-family:'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:#1c1a17;background:#f4ecd8;border:2px solid #1c1a17;border-radius:10px;padding:14px 0;">${code}</div>
      <p style="font-size:12px;color:#6b6455;margin:20px 0 0;">This code expires in 15 minutes. If you didn't request it, you can safely ignore this email.</p>
    </div>
  </div>`;
}

export async function sendVerificationCode(
  email: string,
  code: string,
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // ponytail: dev fallback — no mail provider configured, read the code here.
    console.log(`[mail] verification code for ${email}: ${code}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "CollabCanvas <onboarding@resend.dev>",
      to: email,
      subject: `${code} is your CollabCanvas verification code`,
      text: `Your CollabCanvas verification code is ${code}\n\nIt expires in 15 minutes. If you didn't request this, ignore this email.`,
      html: codeEmailHtml(code),
    }),
  });
  if (!res.ok) {
    throw new Error(`mail send failed: ${res.status} ${await res.text()}`);
  }
}
