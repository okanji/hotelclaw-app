import Link from "next/link";
import { redirect } from "next/navigation";
import { acceptInvite } from "@/lib/invites/actions";
import { getSessionUser } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AcceptButton } from "./accept-button";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getSessionUser();

  if (!user) {
    // Send unauthenticated visitors to login, then back here after auth.
    redirect(`/login?next=${encodeURIComponent(`/invites/${token}`)}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Join property</CardTitle>
          <CardDescription>
            You've been invited to a Hotelclaw workspace. Click below to accept.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">{user.email}</span>
          </p>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="ghost" render={<Link href="/" />}>
            Cancel
          </Button>
          <AcceptButton token={token} />
        </CardFooter>
      </Card>
    </main>
  );
}
