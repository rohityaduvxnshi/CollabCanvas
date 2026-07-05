import { redirect } from "next/navigation";

// The email-first flow now lives on the landing page ("/"). Keep /signin as a
// permanent alias so old links/bookmarks still work.
export default function SignInPage() {
  redirect("/");
}
