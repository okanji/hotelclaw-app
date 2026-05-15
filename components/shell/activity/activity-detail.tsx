"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChannelView } from "@/components/chat/channel-view";
import { TaskRoom } from "@/components/tasks/task-room";
import type { TaskPriority, TaskStatus } from "@/lib/db/types";
import type {
  ChannelAddedPayload,
  InviteReceivedPayload,
  MentionPayload,
  NotificationRow,
  TaskAssignedPayload,
} from "@/lib/notifications/types";

type TaskApiRow = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  due_at: string | null;
};

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * Right pane of the Activity view. Renders the full interactive target of the
 * selected notification — a chat channel, a task, or an invitation.
 */
export function ActivityDetail({
  propertyId,
  notification,
}: {
  propertyId: string;
  notification: NotificationRow | null;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {notification ? (
        <DetailBody propertyId={propertyId} notification={notification} />
      ) : (
        <Placeholder>Select a notification to view the details.</Placeholder>
      )}
    </div>
  );
}

function DetailBody({
  propertyId,
  notification,
}: {
  propertyId: string;
  notification: NotificationRow;
}) {
  switch (notification.type) {
    case "mention": {
      const p = notification.payload as Partial<MentionPayload>;
      if (!p.channelId) {
        return <Placeholder>This message is no longer available.</Placeholder>;
      }
      return (
        <ChannelView
          key={p.channelId}
          channelId={p.channelId}
          propertyId={propertyId}
          messageId={p.messageId ?? null}
        />
      );
    }
    case "channel_added": {
      const p = notification.payload as Partial<ChannelAddedPayload>;
      if (!p.channelId) {
        return <Placeholder>This channel is no longer available.</Placeholder>;
      }
      return (
        <ChannelView
          key={p.channelId}
          channelId={p.channelId}
          propertyId={propertyId}
        />
      );
    }
    case "task_assigned":
    case "task_unassigned": {
      const p = notification.payload as Partial<TaskAssignedPayload>;
      if (!p.taskId) {
        return <Placeholder>This task is no longer available.</Placeholder>;
      }
      return <TaskLoader key={p.taskId} propertyId={propertyId} taskId={p.taskId} />;
    }
    case "invite_received": {
      const p = notification.payload as Partial<InviteReceivedPayload>;
      return <InviteCard payload={p} />;
    }
    default:
      return <Placeholder>No preview available for this notification.</Placeholder>;
  }
}

/** Fetches a task on demand, then hands it to `TaskRoom`. */
function TaskLoader({
  propertyId,
  taskId,
}: {
  propertyId: string;
  taskId: string;
}) {
  const { data, isLoading, isError } = useQuery<TaskApiRow>({
    queryKey: ["task", propertyId, taskId],
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/tasks/${taskId}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error("Failed to load task");
      return r.json();
    },
  });

  if (isLoading) return <Placeholder>Loading task…</Placeholder>;
  if (isError || !data) {
    return <Placeholder>This task is no longer available.</Placeholder>;
  }

  return (
    <TaskRoom
      propertyId={propertyId}
      task={{
        id: data.id,
        title: data.title,
        description: data.description,
        status: data.status,
        priority: data.priority,
        assigneeId: data.assignee_id,
        dueAt: data.due_at,
      }}
    />
  );
}

function InviteCard({ payload }: { payload: Partial<InviteReceivedPayload> }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-center">
        <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Mail className="size-5" />
        </span>
        <h2 className="text-base font-semibold">
          Invitation to {payload.propertyName ?? "a workspace"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You&apos;ve been invited
          {payload.role ? (
            <>
              {" "}
              as <span className="capitalize">{payload.role}</span>
            </>
          ) : null}
          .
        </p>
        {payload.inviteToken ? (
          <Button
            className="mt-4 w-full"
            render={<Link href={`/invites/${payload.inviteToken}`} />}
          >
            View invitation
          </Button>
        ) : null}
      </div>
    </div>
  );
}
