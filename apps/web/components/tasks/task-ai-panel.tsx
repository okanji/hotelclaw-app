"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BotPanelConversation } from "@/components/ai/bot-panel-conversation";

/**
 * Task detail AI assistant — a small streaming panel inside the task detail
 * page. `useChat` posts the conversation to
 * POST /api/properties/:propertyId/tasks/:taskId/ai, which streams the task
 * bot's turn (text, reasoning, tool parts) back as an AI SDK UI message
 * stream. No server-side persistence: task conversations are short and
 * tightly scoped, so the client owns the transcript.
 */
export function TaskAiPanel({
  propertyId,
  taskId,
}: {
  propertyId: string;
  taskId: string;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const transport = useMemo(
    () => new DefaultChatTransport({ api: `/api/properties/${propertyId}/tasks/${taskId}/ai` }),
    [propertyId, taskId],
  );
  const { messages, sendMessage, status, stop } = useChat({
    id: `task-ai-${taskId}`,
    transport,
    onError: (error) =>
      toast.error(error.message || "Couldn't reach the task assistant"),
  });
  const busy = status === "submitted" || status === "streaming";

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="mt-3 text-muted-foreground"
      >
        <Sparkles className="size-4" />
        Ask AI about this task
      </Button>
    );
  }

  return (
    <section className="mt-3 flex flex-col rounded-md bg-muted p-3">
      <header className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="size-4" />
          Task assistant
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </header>

      {messages.length > 0 || busy ? (
        <BotPanelConversation
          messages={messages}
          status={status}
          workingLabel="Reading the task…"
          feedback={{ propertyId, surface: "task", sessionId: taskId }}
          className="mb-3 max-h-80 rounded-md bg-background/60"
        />
      ) : null}

      <div className="flex items-end gap-2">
        <Textarea
          name="task-ai-question"
          aria-label="Ask the task assistant"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="What does this task involve? Who's blocked on this? Suggest next steps…"
          rows={2}
          className="min-h-0 flex-1 resize-none bg-background shadow-composer focus-visible:shadow-composer-focus"
          disabled={busy}
        />
        {busy ? (
          <Button type="button" size="sm" variant="outline" onClick={() => void stop()}>
            Stop
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={send} disabled={!input.trim()}>
            Ask
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-faint-foreground">
        Answers come from a Claude-backed assistant with access to this task,
        its sub-tasks, related tasks, and property memory.
      </p>
    </section>
  );
}
