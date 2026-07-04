import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthShell } from "@/components/auth/AuthShell";
import { EmailAuthForm } from "@/components/auth/AuthForms";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/");

  return (
    <AuthShell
      title="Sign in with email"
      blurb="New here? Create an account — we'll email you a 6-digit code to verify it."
    >
      <EmailAuthForm />
      <Link
        href="/"
        className="font-sans text-[12px] font-semibold text-[var(--ink-soft)] underline"
      >
        ← Back to all sign-in options
      </Link>
    </AuthShell>
  );
}
