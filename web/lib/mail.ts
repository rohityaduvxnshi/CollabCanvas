/**
 * Outbound email (Phase 7). Resend's plain HTTP API via fetch — no SDK.
 * Without RESEND_API_KEY (local dev) the code is logged to the server console.
 */

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
    }),
  });
  if (!res.ok) {
    throw new Error(`mail send failed: ${res.status} ${await res.text()}`);
  }
}
