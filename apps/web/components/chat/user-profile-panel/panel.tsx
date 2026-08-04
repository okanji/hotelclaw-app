"use client";

import { useEffect, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChatContext } from "stream-chat-react";
import type { Channel as StreamChannel } from "stream-chat";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, MessageSquareText, X } from "lucide-react";
import { toast } from "sonner";
import { useOpenChannel } from "@/lib/chat/use-open-channel";
import { useUserProfilePanel } from "./context";

type ProfileResponse = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
  joinedAt: string;
  isSelf: boolean;
};

/**
 * Profile right-rail. Renders as a static flex item inside the SidebarInset's
 * flex-row container — when open, it claims 360px and the page content
 * (chat/tasks/threads) compresses (Slack-style push, not overlay).
 */
export function UserProfilePanel({ propertyId }: { propertyId: string }) {
  const { userId, close } = useUserProfilePanel();
  const isOpen = userId !== null;

  // Escape to close — matches the Sheet UX we replaced.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <aside
      role="dialog"
      aria-label="User profile"
      data-state={isOpen ? "open" : "closed"}
      className="flex w-[360px] shrink-0 flex-col border-l border-border bg-card data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=open]:duration-200"
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <h2 className="text-sm font-medium">Profile</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={close}
          aria-label="Close profile"
        >
          <X />
        </Button>
      </header>
      {userId ? (
        <ProfileBody propertyId={propertyId} userId={userId} onClose={close} />
      ) : null}
    </aside>
  );
}

function ProfileBody({
  propertyId,
  userId,
  onClose,
}: {
  propertyId: string;
  userId: string;
  onClose: () => void;
}) {
  const openChannel = useOpenChannel(propertyId);
  const { client } = useChatContext();
  const [pending, startTransition] = useTransition();

  const { data, isLoading, error } = useQuery<ProfileResponse>({
    queryKey: ["user-profile", userId],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/profile`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Failed to load profile (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });

  const [recentDms, setRecentDms] = useState<StreamChannel[] | null>(null);
  useEffect(() => {
    if (!client?.user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const channels = await client.queryChannels(
          {
            type: "messaging",
            members: { $in: [userId] },
          },
          [{ last_message_at: -1 }],
          { limit: 5, watch: false, state: true },
        );
        if (!cancelled) setRecentDms(channels);
      } catch {
        if (!cancelled) setRecentDms([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, userId]);

  const initials = (data?.name ?? data?.email ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function startDm() {
    if (!client?.user?.id) return;
    startTransition(async () => {
      try {
        const channel = client.channel("messaging", undefined, {
          members: [client.user!.id, userId],
          property_id: propertyId,
        } as Record<string, unknown>);
        await channel.create();
        onClose();
        if (channel.id) openChannel("messaging", channel.id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to start DM");
      }
    });
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <Skeleton className="aspect-square w-full rounded-lg" />
        <Skeleton className="mt-4 h-5 w-40" />
        <Skeleton className="mt-2 h-4 w-28" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex-1 p-4">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load profile"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-4 p-4">
        <div className="overflow-hidden rounded-md bg-muted shadow-ring">
          <Avatar className="size-full rounded-none">
            <AvatarImage
              src={data.avatarUrl ?? undefined}
              alt=""
              className="aspect-square size-full rounded-none object-cover"
            />
            <AvatarFallback className="aspect-square size-full rounded-none text-3xl">
              {initials || "?"}
            </AvatarFallback>
          </Avatar>
        </div>
        <div>
          <h2 className="text-base font-semibold">{data.name ?? "Unknown"}</h2>
          {data.isSelf ? (
            <p className="mt-0.5 text-xs text-muted-foreground">You</p>
          ) : null}
        </div>
        {!data.isSelf ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={startDm}
              disabled={pending}
            >
              <MessageSquareText />
              {pending ? "Opening…" : "Message"}
            </Button>
          </div>
        ) : null}
      </div>
      <Section title="Contact information">
        {data.email ? (
          <ContactRow
            icon={<Mail />}
            label="Email"
            value={
              <a
                href={`mailto:${data.email}`}
                className="text-primary hover:underline"
              >
                {data.email}
              </a>
            }
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            No email on file for this user.
          </p>
        )}
      </Section>
      {recentDms && recentDms.length > 0 ? (
        <Section title="Recent DMs">
          <ul className="space-y-1">
            {recentDms.map((c) => (
              <li key={c.cid}>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    if (c.id) openChannel("messaging", c.id);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Avatar className="size-6">
                    <AvatarImage
                      src={dmCounterpartImage(c, client?.user?.id)}
                      alt=""
                    />
                    <AvatarFallback className="text-xs">
                      {dmCounterpartInitials(c, client?.user?.id)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">
                    {dmDisplayName(c, client?.user?.id)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border px-4 py-4">
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function ContactRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm">{value}</p>
      </div>
    </div>
  );
}

function dmCounterpart(
  channel: StreamChannel,
  meId: string | undefined,
) {
  if (!meId) return null;
  const members = Object.values(channel.state.members);
  const others = members.filter((m) => m.user_id !== meId);
  if (others.length === 1) return others[0]?.user ?? null;
  return null;
}

function dmDisplayName(channel: StreamChannel, meId: string | undefined) {
  const c = dmCounterpart(channel, meId);
  if (c?.name) return c.name;
  const members = Object.values(channel.state.members);
  return members
    .filter((m) => m.user_id !== meId)
    .map((m) => m.user?.name ?? m.user_id)
    .join(", ");
}

function dmCounterpartImage(
  channel: StreamChannel,
  meId: string | undefined,
): string | undefined {
  const c = dmCounterpart(channel, meId);
  return typeof c?.image === "string" ? c.image : undefined;
}

function dmCounterpartInitials(
  channel: StreamChannel,
  meId: string | undefined,
) {
  const name = dmDisplayName(channel, meId);
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
