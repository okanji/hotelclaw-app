import { z } from "zod";
import { type StepCatalogEntry, type TriggerCatalogEntry } from "./types";

const triggers: TriggerCatalogEntry[] = [
  {
    id: "doc.created",
    surface: "docs",
    category: "trigger",
    label: "Document created",
    description:
      "Fires when a new document is created in this property, with the document's details available to later steps.",
    examplePrompts: ["when a new doc is created", "every new document"],
    outputSchema: z.object({ document: z.record(z.string(), z.unknown()) }),
    explain: () => "When a document is created",
  },
  {
    id: "doc.archived",
    surface: "docs",
    category: "trigger",
    label: "Document archived",
    description: "Fires when a document is soft-deleted (archived_at set).",
    examplePrompts: ["when a doc is archived", "when a document is deleted"],
    outputSchema: z.object({ document: z.record(z.string(), z.unknown()) }),
    explain: () => "When a document is archived",
  },
];

const actions: StepCatalogEntry[] = [
  {
    id: "action.doc.create",
    surface: "docs",
    category: "action",
    label: "Create document",
    description:
      "Create a new document. Title is required. Optional body_markdown is converted to ProseMirror at insert time.",
    examplePrompts: ["create a new doc", "draft a meeting notes doc"],
    outputSchema: z.object({ document: z.record(z.string(), z.unknown()) }),
    explain: () => "Create a document",
  },
  {
    id: "action.doc.archive",
    surface: "docs",
    category: "action",
    label: "Archive document",
    description: "Soft-archive a document by id.",
    examplePrompts: ["archive this doc"],
    outputSchema: z.object({ document_id: z.string() }),
    explain: () => "Archive a document",
  },
  {
    id: "action.doc.add_to_board",
    surface: "docs",
    category: "action",
    label: "Add document to board",
    description: "Pin a document to a team document board.",
    examplePrompts: ["pin to the leadership board"],
    outputSchema: z.object({ ok: z.boolean() }),
    explain: () => "Pin doc to a board",
  },
  {
    id: "action.doc.post_summary_in_chat",
    surface: "docs",
    category: "action",
    label: "Post doc summary in chat",
    description:
      "Fetches the doc's plaintext body, generates a short summary, and posts it in a channel. Combines an AI summarize step with a chat post.",
    examplePrompts: ["share this doc in #leadership", "summarize and post"],
    outputSchema: z.object({ message: z.record(z.string(), z.unknown()) }),
    explain: () => "Post a doc summary in chat",
  },
];

export const DOCS_TRIGGERS = triggers;
export const DOCS_ACTIONS = actions;
