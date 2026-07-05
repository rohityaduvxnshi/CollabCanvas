import { redirect } from "next/navigation";

// Verification is now an inline step of the email-first flow on "/". Old
// /verify?email=… links just return to the start.
export default function VerifyPage() {
  redirect("/");
}
