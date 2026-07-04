import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPrisma } from "@collabcanvas/db";
import { AuthShell } from "@/components/auth/AuthShell";
import { ProfileForm } from "@/components/auth/AuthForms";

export default async function WelcomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const user = await getPrisma().user.findUnique({
    where: { id: session.user.id },
  });
  if (!user) redirect("/");

  return (
    <AuthShell
      title="You're verified — introduce yourself"
      blurb="This is how teammates will see you on shared boards."
    >
      <ProfileForm initialName={user.name ?? ""} initialBio={user.bio ?? ""} />
    </AuthShell>
  );
}
