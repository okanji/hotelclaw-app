import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { UpdatePasswordForm } from "./update-password-form";

export default async function UpdatePasswordPage() {
  const user = await getSessionUser();
  // The recovery confirm route signs the user in via verifyOtp before
  // redirecting here. If we land here without a session, send to login.
  if (!user) redirect("/login");

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <UpdatePasswordForm />
    </main>
  );
}
