import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { VerifyCodeForm } from "@/components/auth/AuthForms";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  if (!email) redirect("/signin");

  return (
    <AuthShell
      title="Check your inbox"
      blurb={`We sent a 6-digit code to ${email}. Enter your password and the code to verify your address.`}
    >
      <VerifyCodeForm email={email} />
    </AuthShell>
  );
}
