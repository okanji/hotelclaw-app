import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { getStreamServer } from "@/lib/stream/server";
import { getBotUserId } from "@/lib/stream/ai-adapter";
import { aiSummarizeRunner } from "./ai";
import type { RunnerImpl } from "./types";

const POSITION_GAP = 1024;

async function nextDocPosition(
  propertyId: string,
  parentId: string | null,
): Promise<number> {
  const supabase = createServiceClient();
  let query = supabase
    .from("documents")
    .select("position")
    .eq("property_id", propertyId);
  query = parentId
    ? query.eq("parent_id", parentId)
    : query.is("parent_id", null);
  const { data } = await query
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.position ?? 0) + POSITION_GAP;
}

async function nextBoardItemPosition(boardId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("document_board_items")
    .select("position")
    .eq("board_id", boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.position ?? 0) + POSITION_GAP;
}

type CreateDocConfig = {
  title: string;
  body_markdown?: string;
  parent_id?: string;
};

export const createDocRunner: RunnerImpl<
  CreateDocConfig,
  { document: Record<string, unknown> }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return {
      document: {
        id: `dry-${ctx.stepId}`,
        property_id: ctx.propertyId,
        title: config.title,
        body_text: config.body_markdown ?? "",
      },
    };
  }

  const supabase = createServiceClient();
  const parentId = config.parent_id ?? null;
  if (parentId) {
    const { data: parentRow } = await supabase
      .from("documents")
      .select("property_id, archived_at")
      .eq("id", parentId)
      .maybeSingle();
    if (!parentRow || parentRow.property_id !== ctx.propertyId) {
      throw new Error("create_doc: parent document not found");
    }
    if (parentRow.archived_at) {
      throw new Error("create_doc: cannot nest under an archived document");
    }
  }

  const position = await nextDocPosition(ctx.propertyId, parentId);
  const { data, error } = await supabase
    .from("documents")
    .insert({
      property_id: ctx.propertyId,
      parent_id: parentId,
      position,
      kind: "doc",
      title: config.title,
      body_text: config.body_markdown ?? "",
      created_by: ctx.workflowOwnerId,
      last_edited_by: ctx.workflowOwnerId,
    })
    .select("*")
    .single();
  if (error) throw new Error(`create_doc failed: ${error.message}`);
  return { document: data as Record<string, unknown> };
};

type ArchiveDocConfig = { document_id: string };

export const archiveDocRunner: RunnerImpl<
  ArchiveDocConfig,
  { document_id: string }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) return { document_id: config.document_id };

  const supabase = createServiceClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("property_id")
    .eq("id", config.document_id)
    .eq("property_id", ctx.propertyId)
    .maybeSingle();
  if (!doc) throw new Error("archive_doc: document not found");

  const { error } = await supabase.rpc("archive_document_tree", {
    root: config.document_id,
  });
  if (error) throw new Error(`archive_doc failed: ${error.message}`);
  return { document_id: config.document_id };
};

type AddToBoardConfig = { document_id: string; board_id: string };

export const addToBoardRunner: RunnerImpl<AddToBoardConfig, { ok: boolean }> = async ({
  config,
  ctx,
}) => {
  if (ctx.dryRun) return { ok: true };

  const supabase = createServiceClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id")
    .eq("id", config.document_id)
    .eq("property_id", ctx.propertyId)
    .maybeSingle();
  if (!doc) throw new Error("add_to_board: document not found");

  const { data: board } = await supabase
    .from("document_boards")
    .select("id")
    .eq("id", config.board_id)
    .eq("property_id", ctx.propertyId)
    .maybeSingle();
  if (!board) throw new Error("add_to_board: board not found");

  const position = await nextBoardItemPosition(config.board_id);
  const del = await supabase
    .from("document_board_items")
    .delete()
    .eq("document_id", config.document_id);
  if (del.error) throw new Error(`add_to_board failed: ${del.error.message}`);

  const { error } = await supabase.from("document_board_items").insert({
    board_id: config.board_id,
    document_id: config.document_id,
    position,
  });
  if (error) throw new Error(`add_to_board failed: ${error.message}`);
  return { ok: true };
};

type PostSummaryInChatConfig = { document_id: string; channel_id: string };

export const postSummaryInChatRunner: RunnerImpl<
  PostSummaryInChatConfig,
  { message: Record<string, unknown> }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return {
      message: {
        id: `dry-${ctx.stepId}`,
        channel_id: config.channel_id,
      },
    };
  }

  const supabase = createServiceClient();
  const { data: doc, error } = await supabase
    .from("documents")
    .select("title, body_text")
    .eq("id", config.document_id)
    .eq("property_id", ctx.propertyId)
    .maybeSingle();
  if (error || !doc) throw new Error("post_summary_in_chat: document not found");

  const source = [doc.title, doc.body_text].filter(Boolean).join("\n\n").trim();
  if (!source) throw new Error("post_summary_in_chat: document has no content to summarize");

  const { summary } = await aiSummarizeRunner({
    config: { input: source, length: "short" },
    ctx,
  });

  const stream = getStreamServer();
  const channel = stream.channel("team", config.channel_id);
  const botId = getBotUserId();
  const text = `📄 **${doc.title}**\n\n${summary}`;
  const res = await channel.sendMessage(
    {
      text,
      user_id: botId,
      ai_generated: true,
    } as unknown as Parameters<typeof channel.sendMessage>[0],
  );
  return { message: res.message as unknown as Record<string, unknown> };
};
