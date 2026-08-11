// Generated DB types live here. For now we hand-write the minimal shape we use;
// once the Supabase project is provisioned, regenerate with:
//   pnpm dlx supabase gen types typescript --project-id <id> > lib/db/types.ts

export type Role = "owner" | "manager" | "staff";

/**
 * A document change the AI staged (mirrors `ProposedDocEdit` in
 * lib/ai/bots/doc-bot.ts). Persisted on `doc_ai_messages.edit` so the
 * "Re-apply" / inline-diff affordance survives a reload.
 */
export type DocAiEdit = {
  op: "add" | "edit";
  mode: "insert" | "append";
  html: string;
};

/**
 * Recurrence rule for a meeting — a deliberate RRULE subset that covers
 * the standup/sync use cases without a full iCal parser. `byday` is
 * 1–7 (Mon=1, Sun=7) and `interval` defaults to 1 (every cycle).
 */
export type MeetingRecurrence = {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  until?: string;
  count?: number;
  byday?: number[];
};
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";

// ── Custom fields (migrations 0080, 0099) ───────────────────────────────────
/**
 * `select` is a single-choice dropdown; `multi_select` is the LABEL field —
 * the multiple-choice version of the same option list, scoped to this one
 * field (unlike the property-wide `labels` catalog, which is shared across
 * tasks, docs, projects and teams).
 */
export type CustomFieldType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "date"
  | "checkbox";
/**
 * Options for select / multi_select. Values store the option `id`, so labels
 * stay renameable and recolorable without touching stored data. `color` is
 * optional for rows written before 0099.
 */
export type CustomFieldOption = {
  id: string;
  label: string;
  color?: EntityColor;
};
/** jsonb value per field type: text/select/date → string, number → number,
 *  checkbox → boolean, multi_select → array of option ids. */
export type CustomFieldValue = string | number | boolean | string[];

// ── List view column layout (migration 0099) ────────────────────────────────
/**
 * One column in the tasks list view. `id` is a built-in key ("title",
 * "priority", …) or `field:<uuid>` for a custom field — the same addressing
 * the board's filter facets use.
 */
export type TaskViewColumn = { id: string; width: number; hidden?: boolean };
/** Active sort, or null for manual (drag-orderable) order. */
export type TaskViewSort = { columnId: string; dir: "asc" | "desc" } | null;

// ── Daily operations (migration 0082) ───────────────────────────────────────
/** Checklist item on a routine — ids are stable slugs so runs survive
 *  relabeling. */
export type RoutineItem = { id: string; label: string };
/** Accent colors shared by document boards, teams, and projects. */
export type EntityColor =
  | "slate"
  | "blue"
  | "green"
  | "amber"
  | "rose"
  | "violet";
export type ProjectStatus = "active" | "planned" | "completed" | "archived";
export type WorkflowMode = "instant" | "durable";
// Kept in sync with the CHECKs in migration 0057_forms.sql.
export type FormStatus = "draft" | "published" | "closed";
export type FormResponseSource = "direct" | "chat" | "workflow" | "onboarding" | "booking";

// Kept in sync with the CHECKs in migration 0061_chatbots.sql.
export type ChatbotStatus = "draft" | "published" | "paused";
export type AgentStatus = "active" | "paused";
export type ChatbotTemplateKind =
  | "front_desk"
  | "room_service"
  | "restaurant"
  | "custom";
export type ChatbotKnowledgeKind = "text" | "qa" | "document" | "url";
export type ChatbotKnowledgeStatus = "pending" | "trained" | "failed";
export type ChatbotConversationChannel = "web" | "test" | "whatsapp" | "sms";
export type ChatbotActionMethod = "GET" | "POST" | "PUT" | "DELETE";
export type ChatbotConversationStatus = "bot" | "human" | "closed";
export type ChatbotConversationOutcome =
  | "open"
  | "resolved"
  | "order_placed"
  | "booking_made"
  | "escalated"
  | "unresolved";

// Kept in sync with the CHECKs in migration 0065_bookings.sql + 0066.
export type BookableServiceKind =
  | "table"
  | "appointment"
  | "tour"
  | "event"
  | "rental"
  | "other";
export type BookingMode = "capacity" | "tables" | "rental";
export type ResourceShape = "rect" | "round";
export type BookingStatus =
  | "pending"
  | "confirmed"
  | "seated"
  | "completed"
  | "cancelled"
  | "no_show";
export type BookingSource = "chatbot" | "staff" | "web";
export type ChatbotMessageRole = "guest" | "bot" | "staff" | "system";

// Creation provenance (migration 0050) — what created the row. 'workflow'
// rows also carry source_workflow_id / source_workflow_run_id so the UI can
// badge automation output and link to the exact run.
export type RecordSource = "user" | "workflow" | "ai";
export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "filtered";
// Kept in sync with the CHECK in migration 0013_document_boards.sql.
export type BoardColor =
  | "slate"
  | "blue"
  | "green"
  | "amber"
  | "rose"
  | "violet";

export interface Database {
  public: {
    Tables: {
      properties: {
        Row: {
          id: string;
          name: string;
          slug: string;
          client_id: string | null;
          timezone: string;
          channel_creation: "everyone" | "management";
          archived_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          client_id?: string | null;
          timezone?: string;
          channel_creation?: "everyone" | "management";
          archived_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          name: string;
          slug: string;
          client_id: string | null;
          timezone: string;
          channel_creation: "everyone" | "management";
          archived_at: string | null;
        }>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          onboarded_at: string | null;
          time_format: "12h" | "24h";
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          onboarded_at?: string | null;
          time_format?: "12h" | "24h";
          created_at?: string;
        };
        Update: Partial<{
          full_name: string | null;
          avatar_url: string | null;
          onboarded_at: string | null;
          time_format: "12h" | "24h";
        }>;
        Relationships: [];
      };
      memberships: {
        Row: {
          property_id: string;
          user_id: string;
          role: Role;
          created_at: string;
          // Org chart (migration 0071): person hierarchy.
          title: string | null;
          manager_id: string | null;
          primary_space_id: string | null;
        };
        Insert: {
          property_id: string;
          user_id: string;
          role: Role;
          created_at?: string;
          title?: string | null;
          manager_id?: string | null;
          primary_space_id?: string | null;
        };
        Update: Partial<{
          role: Role;
          title: string | null;
          manager_id: string | null;
          primary_space_id: string | null;
        }>;
        Relationships: [];
      };
      chat_channels: {
        Row: {
          id: string;
          property_id: string;
          stream_channel_id: string;
          stream_channel_type: string;
          name: string;
          is_private: boolean;
          space_id: string | null;
          created_by: string | null;
          created_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          property_id: string;
          stream_channel_id: string;
          stream_channel_type?: string;
          name: string;
          is_private?: boolean;
          space_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          archived_at?: string | null;
        };
        Update: Partial<{
          name: string;
          is_private: boolean;
          space_id: string | null;
          archived_at: string | null;
        }>;
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          property_id: string;
          title: string;
          parent_id: string | null;
          position: number;
          // 'doc' = Tiptap rich-text (Yjs); 'sheet' = spreadsheet (Liveblocks
          // Storage). Added in migration 0024. Drives the editor-fork in
          // <DocumentsSurface>.
          kind: "doc" | "sheet";
          // Yjs binary update written by the Liveblocks `ydocUpdated` webhook
          // (see app/api/liveblocks/webhook/route.ts + migration 0018). bytea
          // surfaces as a Buffer / Uint8Array via supabase-js; for the rare
          // read site we mostly leave it null in selects to avoid the payload.
          body_state: Uint8Array | null;
          // Full plaintext snapshot — drives docs-home previews and the
          // body_fts tsvector (migration 0019's search_documents_keyword).
          body_text: string;
          // Tiptap ProseMirror JSON snapshot; nullable, useful for SSR/AI.
          body_json: unknown;
          body_updated_at: string | null;
          // Spreadsheet state — Liveblocks Storage snapshot serialized to
          // JSON by the `storageUpdated` webhook for `kind='sheet'` rows
          // (migration 0024). { columns, rows, cells }. Null for doc rows.
          sheet_state: unknown;
          // TSV plaintext rendering of the sheet body — drives body_fts.
          sheet_text: string | null;
          sheet_updated_at: string | null;
          // Concatenated extracted text of uploaded file attachments
          // (migration 0089, lib/documents/attachment-text.ts). Weight C
          // in body_fts; mirrored into the brain page.
          attachments_text: string;
          // Last successful mirror into the property's gbrain source
          // (migration 0088, lib/brain/doc-sync.ts). Null = never mirrored.
          brain_synced_at: string | null;
          space_id: string | null;
          project_id: string | null;
          created_by: string | null;
          last_edited_by: string | null;
          // Notion-style document header — both nullable, added in 0037.
          // `icon` is a single emoji or short symbol; `cover_url` is a URL
          // into the `documents-images` bucket.
          icon: string | null;
          cover_url: string | null;
          archived_at: string | null;
          source: RecordSource;
          source_workflow_id: string | null;
          source_workflow_run_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          title?: string;
          parent_id?: string | null;
          position?: number;
          kind?: "doc" | "sheet";
          body_state?: Uint8Array | null;
          body_text?: string;
          body_json?: unknown;
          body_updated_at?: string | null;
          sheet_state?: unknown;
          sheet_text?: string | null;
          sheet_updated_at?: string | null;
          attachments_text?: string;
          brain_synced_at?: string | null;
          space_id?: string | null;
          project_id?: string | null;
          created_by?: string | null;
          last_edited_by?: string | null;
          icon?: string | null;
          cover_url?: string | null;
          archived_at?: string | null;
          source?: RecordSource;
          source_workflow_id?: string | null;
          source_workflow_run_id?: string | null;
        };
        Update: Partial<{
          title: string;
          parent_id: string | null;
          position: number;
          kind: "doc" | "sheet";
          body_state: Uint8Array | null;
          body_text: string;
          body_json: unknown;
          body_updated_at: string | null;
          sheet_state: unknown;
          sheet_text: string | null;
          sheet_updated_at: string | null;
          attachments_text: string;
          brain_synced_at: string | null;
          space_id: string | null;
          project_id: string | null;
          last_edited_by: string | null;
          icon: string | null;
          cover_url: string | null;
          archived_at: string | null;
        }>;
        Relationships: [];
      };
      // Pre-replace snapshots of AI document writes (migration 0094) —
      // the undo safety net for update_document(mode: replace).
      document_ai_revisions: {
        Row: {
          id: string;
          property_id: string;
          document_id: string;
          body_json: unknown;
          body_text: string;
          note: string | null;
          replaced_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          document_id: string;
          body_json?: unknown;
          body_text?: string;
          note?: string | null;
          replaced_at?: string;
        };
        Update: Partial<{
          note: string | null;
        }>;
        Relationships: [];
      };
      // Extracted plaintext of files uploaded to the documents-files bucket
      // (migration 0089). Service-client writes; members read.
      document_attachment_texts: {
        Row: {
          id: string;
          property_id: string;
          document_id: string;
          storage_path: string;
          file_name: string;
          mime: string;
          text_content: string;
          extracted_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          document_id: string;
          storage_path: string;
          file_name: string;
          mime: string;
          text_content?: string;
          extracted_at?: string;
        };
        Update: Partial<{
          text_content: string;
          extracted_at: string;
        }>;
        Relationships: [];
      };
      doc_ai_chats: {
        Row: {
          id: string;
          document_id: string;
          property_id: string;
          created_by: string | null;
          title: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          property_id: string;
          created_by?: string | null;
          title?: string | null;
        };
        Update: Partial<{
          title: string | null;
        }>;
        Relationships: [];
      };
      doc_ai_messages: {
        Row: {
          id: string;
          chat_id: string;
          role: "user" | "assistant";
          content: string;
          edit: DocAiEdit | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          chat_id: string;
          role: "user" | "assistant";
          content: string;
          edit?: DocAiEdit | null;
        };
        Update: Partial<{
          content: string;
          edit: DocAiEdit | null;
        }>;
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          property_id: string;
          title: string;
          description: string | null;
          status: TaskStatus;
          priority: TaskPriority;
          assignee_id: string | null;
          created_by: string | null;
          due_at: string | null;
          // Time-block window — set when the task has been dragged onto the
          // calendar grid (migration 0017). Independent of `due_at`, which
          // remains the deadline.
          scheduled_start: string | null;
          scheduled_end: string | null;
          position: number;
          parent_id: string | null;
          labels: string[];
          project_name: string | null;
          space_id: string | null;
          project_id: string | null;
          overdue_notified_at: string | null;
          source: RecordSource;
          source_workflow_id: string | null;
          source_workflow_run_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          title: string;
          description?: string | null;
          status?: TaskStatus;
          priority?: TaskPriority;
          assignee_id?: string | null;
          created_by?: string | null;
          due_at?: string | null;
          scheduled_start?: string | null;
          scheduled_end?: string | null;
          position?: number;
          parent_id?: string | null;
          labels?: string[];
          project_name?: string | null;
          space_id?: string | null;
          project_id?: string | null;
          overdue_notified_at?: string | null;
          source?: RecordSource;
          source_workflow_id?: string | null;
          source_workflow_run_id?: string | null;
        };
        Update: Partial<{
          title: string;
          description: string | null;
          status: TaskStatus;
          priority: TaskPriority;
          assignee_id: string | null;
          due_at: string | null;
          scheduled_start: string | null;
          scheduled_end: string | null;
          position: number;
          parent_id: string | null;
          labels: string[];
          project_name: string | null;
          space_id: string | null;
          project_id: string | null;
          overdue_notified_at: string | null;
        }>;
        Relationships: [];
      };
      custom_fields: {
        Row: {
          id: string;
          property_id: string;
          space_id: string | null;
          name: string;
          type: CustomFieldType;
          options: CustomFieldOption[];
          position: number;
          created_by: string | null;
          created_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          property_id: string;
          space_id?: string | null;
          name: string;
          type: CustomFieldType;
          options?: CustomFieldOption[];
          position?: number;
          created_by?: string | null;
          archived_at?: string | null;
        };
        Update: Partial<{
          space_id: string | null;
          name: string;
          options: CustomFieldOption[];
          position: number;
          archived_at: string | null;
        }>;
        Relationships: [];
      };
      task_field_values: {
        Row: {
          task_id: string;
          field_id: string;
          property_id: string;
          value: CustomFieldValue;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          task_id: string;
          field_id: string;
          property_id: string;
          value: CustomFieldValue;
          updated_by?: string | null;
        };
        Update: Partial<{
          value: CustomFieldValue;
          updated_by: string | null;
        }>;
        Relationships: [];
      };
      task_view_columns: {
        Row: {
          user_id: string;
          property_id: string;
          view_key: string;
          columns: TaskViewColumn[];
          sort: TaskViewSort;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          property_id: string;
          view_key?: string;
          columns?: TaskViewColumn[];
          sort?: TaskViewSort;
          updated_at?: string;
        };
        Update: Partial<{
          columns: TaskViewColumn[];
          sort: TaskViewSort;
          updated_at: string;
        }>;
        Relationships: [];
      };
      routines: {
        Row: {
          id: string;
          property_id: string;
          space_id: string;
          name: string;
          items: RoutineItem[];
          days: number[];
          position: number;
          created_by: string | null;
          created_at: string;
          reviewed_at: string | null;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          property_id: string;
          space_id: string;
          name: string;
          items?: RoutineItem[];
          days?: number[];
          position?: number;
          created_by?: string | null;
          archived_at?: string | null;
        };
        Update: Partial<{
          name: string;
          items: RoutineItem[];
          days: number[];
          position: number;
          reviewed_at: string | null;
          archived_at: string | null;
        }>;
        Relationships: [];
      };
      org_change_proposals: {
        Row: {
          id: string;
          property_id: string;
          kind: "set_title" | "set_manager" | "set_home_team" | "set_team_lead";
          subject_user_id: string | null;
          subject_space_id: string | null;
          new_text: string | null;
          new_id: string | null;
          note: string | null;
          status: "pending" | "approved" | "rejected";
          created_by: string | null;
          created_at: string;
          decided_by: string | null;
          decided_at: string | null;
        };
        Insert: {
          id?: string;
          property_id: string;
          kind: "set_title" | "set_manager" | "set_home_team" | "set_team_lead";
          subject_user_id?: string | null;
          subject_space_id?: string | null;
          new_text?: string | null;
          new_id?: string | null;
          note?: string | null;
          status?: "pending" | "approved" | "rejected";
          created_by?: string | null;
        };
        Update: Partial<{
          status: "pending" | "approved" | "rejected";
          decided_by: string | null;
          decided_at: string | null;
        }>;
        Relationships: [];
      };
      routine_feedback: {
        Row: {
          id: string;
          property_id: string;
          routine_id: string;
          item_id: string | null;
          note: string;
          created_by: string | null;
          created_at: string;
          resolved_at: string | null;
          resolved_by: string | null;
        };
        Insert: {
          id?: string;
          property_id: string;
          routine_id: string;
          item_id?: string | null;
          note: string;
          created_by?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
        };
        Update: Partial<{
          note: string;
          resolved_at: string | null;
          resolved_by: string | null;
        }>;
        Relationships: [];
      };
      routine_runs: {
        Row: {
          id: string;
          property_id: string;
          routine_id: string;
          run_date: string;
          done_items: string[];
          completed_at: string | null;
          signed_off_by: string | null;
          signed_off_at: string | null;
          rating: number | null;
          rating_note: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          routine_id: string;
          run_date: string;
          done_items?: string[];
          completed_at?: string | null;
          signed_off_by?: string | null;
          signed_off_at?: string | null;
          rating?: number | null;
          rating_note?: string | null;
        };
        Update: Partial<{
          done_items: string[];
          completed_at: string | null;
          signed_off_by: string | null;
          signed_off_at: string | null;
          rating: number | null;
          rating_note: string | null;
        }>;
        Relationships: [];
      };
      labels: {
        Row: {
          id: string;
          property_id: string;
          name: string;
          color: EntityColor;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          name: string;
          color?: EntityColor;
          created_by?: string | null;
        };
        Update: Partial<{
          name: string;
          color: EntityColor;
        }>;
        Relationships: [];
      };
      document_labels: {
        Row: {
          document_id: string;
          label_id: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          document_id: string;
          label_id: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Record<string, never>>;
        Relationships: [];
      };
      project_labels: {
        Row: {
          project_id: string;
          label_id: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          project_id: string;
          label_id: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Record<string, never>>;
        Relationships: [];
      };
      space_labels: {
        Row: {
          space_id: string;
          label_id: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          space_id: string;
          label_id: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Record<string, never>>;
        Relationships: [];
      };
      spaces: {
        Row: {
          id: string;
          property_id: string;
          name: string;
          description: string | null;
          color: EntityColor;
          icon: string | null;
          position: number;
          created_by: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
          // Org chart (migration 0071): team hierarchy.
          parent_space_id: string | null;
          lead_user_id: string | null;
        };
        Insert: {
          id?: string;
          property_id: string;
          name: string;
          description?: string | null;
          color?: BoardColor;
          icon?: string | null;
          position?: number;
          created_by?: string | null;
          archived_at?: string | null;
          parent_space_id?: string | null;
          lead_user_id?: string | null;
        };
        Update: Partial<{
          name: string;
          description: string | null;
          color: EntityColor;
          icon: string | null;
          position: number;
          archived_at: string | null;
          parent_space_id: string | null;
          lead_user_id: string | null;
        }>;
        Relationships: [];
      };
      space_members: {
        Row: {
          space_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          space_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: Partial<Record<string, never>>;
        Relationships: [];
      };
      space_pinned_resources: {
        Row: {
          id: string;
          space_id: string;
          document_id: string | null;
          form_id: string | null;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          document_id?: string | null;
          form_id?: string | null;
          position: number;
          created_at?: string;
        };
        Update: Partial<{
          position: number;
        }>;
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          property_id: string;
          name: string;
          description: string | null;
          color: EntityColor;
          icon: string | null;
          status: ProjectStatus;
          start_date: string | null;
          target_date: string | null;
          position: number;
          created_by: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          name: string;
          description?: string | null;
          color?: BoardColor;
          icon?: string | null;
          status?: ProjectStatus;
          start_date?: string | null;
          target_date?: string | null;
          position?: number;
          created_by?: string | null;
          archived_at?: string | null;
        };
        Update: Partial<{
          name: string;
          description: string | null;
          color: EntityColor;
          icon: string | null;
          status: ProjectStatus;
          start_date: string | null;
          target_date: string | null;
          position: number;
          archived_at: string | null;
        }>;
        Relationships: [];
      };
      project_spaces: {
        Row: {
          project_id: string;
          space_id: string;
          created_at: string;
        };
        Insert: {
          project_id: string;
          space_id: string;
          created_at?: string;
        };
        Update: Partial<Record<string, never>>;
        Relationships: [];
      };
      task_links: {
        Row: {
          id: string;
          task_id: string;
          url: string;
          title: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          url: string;
          title?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          url: string;
          title: string | null;
        }>;
        Relationships: [];
      };
      task_relations: {
        Row: {
          id: string;
          task_id: string;
          related_task_id: string;
          kind: "related" | "blocks";
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          related_task_id: string;
          kind?: "related" | "blocks";
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          related_task_id: string;
        }>;
        Relationships: [];
      };
      task_favorites: {
        Row: {
          user_id: string;
          task_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          task_id: string;
          created_at?: string;
        };
        Update: Partial<Record<string, never>>;
        Relationships: [];
      };
      task_description_revisions: {
        Row: {
          id: string;
          task_id: string;
          description: string | null;
          edited_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          description?: string | null;
          edited_by?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          description: string | null;
        }>;
        Relationships: [];
      };
      task_notification_mutes: {
        Row: {
          user_id: string;
          task_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          task_id: string;
          created_at?: string;
        };
        Update: Partial<Record<string, never>>;
        Relationships: [];
      };
      task_reminders: {
        Row: {
          id: string;
          task_id: string;
          user_id: string;
          remind_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          user_id: string;
          remind_at: string;
          created_at?: string;
        };
        Update: Partial<{
          remind_at: string;
        }>;
        Relationships: [];
      };
      task_document_links: {
        Row: {
          id: string;
          task_id: string;
          document_id: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          document_id: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Record<string, never>>;
        Relationships: [];
      };
      task_attachments: {
        Row: {
          id: string;
          task_id: string;
          file_name: string;
          storage_path: string;
          mime_type: string | null;
          byte_size: number | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          file_name: string;
          storage_path: string;
          mime_type?: string | null;
          byte_size?: number | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          file_name: string;
        }>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          property_id: string | null;
          type: string;
          payload: Record<string, unknown>;
          seen_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          property_id?: string | null;
          type: string;
          payload?: Record<string, unknown>;
          seen_at?: string | null;
        };
        Update: Partial<{
          seen_at: string | null;
        }>;
        Relationships: [];
      };
      invites: {
        Row: {
          id: string;
          property_id: string;
          email: string;
          role: Role;
          token: string;
          expires_at: string;
          accepted_at: string | null;
          created_by: string | null;
          created_at: string;
          full_name: string | null;
          title: string | null;
          primary_space_id: string | null;
          manager_id: string | null;
        };
        Insert: {
          id?: string;
          property_id: string;
          email: string;
          role: Role;
          token: string;
          expires_at: string;
          created_by?: string | null;
          full_name?: string | null;
          title?: string | null;
          primary_space_id?: string | null;
          manager_id?: string | null;
        };
        Update: Partial<{
          accepted_at: string | null;
          expires_at: string;
          role: Role;
          full_name: string | null;
          title: string | null;
          primary_space_id: string | null;
          manager_id: string | null;
        }>;
        Relationships: [];
      };
      document_boards: {
        Row: {
          id: string;
          property_id: string;
          name: string;
          color: EntityColor;
          position: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          name?: string;
          color?: BoardColor;
          position: number;
          created_by?: string | null;
        };
        Update: Partial<{
          name: string;
          color: EntityColor;
          position: number;
        }>;
        Relationships: [];
      };
      document_board_items: {
        Row: {
          board_id: string;
          document_id: string;
          position: number;
          created_at: string;
        };
        Insert: {
          board_id: string;
          document_id: string;
          position: number;
        };
        Update: Partial<{
          position: number;
        }>;
        Relationships: [];
      };
      meetings: {
        Row: {
          id: string;
          property_id: string;
          channel_id: string | null;
          stream_call_id: string;
          stream_call_type: string;
          title: string;
          host_id: string | null;
          // 0017 made this nullable: scheduled-but-not-started meetings
          // exist for the calendar surface.
          started_at: string | null;
          ended_at: string | null;
          // Calendar fields (migration 0017). `scheduled_start`/`end`
          // distinguish planned events from walk-up calls; description,
          // location, all_day, and color drive the event dialog + grid.
          scheduled_start: string | null;
          scheduled_end: string | null;
          all_day: boolean;
          description: string | null;
          location: string | null;
          color: string | null;
          // Migration 0018 — recurrence rule. Null for a one-off event.
          recurrence: MeetingRecurrence | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          channel_id?: string | null;
          stream_call_id: string;
          stream_call_type?: string;
          title?: string;
          host_id?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          scheduled_start?: string | null;
          scheduled_end?: string | null;
          all_day?: boolean;
          description?: string | null;
          location?: string | null;
          color?: string | null;
          recurrence?: MeetingRecurrence | null;
        };
        Update: Partial<{
          title: string;
          ended_at: string | null;
          scheduled_start: string | null;
          scheduled_end: string | null;
          all_day: boolean;
          description: string | null;
          location: string | null;
          color: string | null;
          stream_call_type: string;
          recurrence: MeetingRecurrence | null;
        }>;
        Relationships: [];
      };
      meeting_attendees: {
        Row: {
          meeting_id: string;
          user_id: string;
          response: "pending" | "accepted" | "declined" | "tentative";
          is_organizer: boolean;
          created_at: string;
        };
        Insert: {
          meeting_id: string;
          user_id: string;
          response?: "pending" | "accepted" | "declined" | "tentative";
          is_organizer?: boolean;
        };
        Update: Partial<{
          response: "pending" | "accepted" | "declined" | "tentative";
          is_organizer: boolean;
        }>;
        Relationships: [];
      };
      calendar_connections: {
        Row: {
          id: string;
          user_id: string;
          provider: "google" | "microsoft";
          account_email: string;
          access_token: string;
          refresh_token: string | null;
          expires_at: string | null;
          sync_state: Record<string, unknown>;
          push_subscription: Record<string, unknown> | null;
          push_expires_at: string | null;
          last_synced_at: string | null;
          last_sync_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider: "google" | "microsoft";
          account_email: string;
          access_token: string;
          refresh_token?: string | null;
          expires_at?: string | null;
          sync_state?: Record<string, unknown>;
          push_subscription?: Record<string, unknown> | null;
          push_expires_at?: string | null;
          last_synced_at?: string | null;
          last_sync_error?: string | null;
        };
        Update: Partial<{
          access_token: string;
          refresh_token: string | null;
          expires_at: string | null;
          sync_state: Record<string, unknown>;
          push_subscription: Record<string, unknown> | null;
          push_expires_at: string | null;
          last_synced_at: string | null;
          last_sync_error: string | null;
        }>;
        Relationships: [];
      };
      external_calendars: {
        Row: {
          id: string;
          connection_id: string;
          external_id: string;
          name: string;
          description: string | null;
          color: string | null;
          is_primary: boolean;
          selected: boolean;
          sync_token: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          connection_id: string;
          external_id: string;
          name: string;
          description?: string | null;
          color?: string | null;
          is_primary?: boolean;
          selected?: boolean;
          sync_token?: string | null;
        };
        Update: Partial<{
          name: string;
          description: string | null;
          color: string | null;
          is_primary: boolean;
          selected: boolean;
          sync_token: string | null;
        }>;
        Relationships: [];
      };
      external_events: {
        Row: {
          id: string;
          calendar_id: string;
          external_id: string;
          title: string;
          description: string | null;
          location: string | null;
          start_at: string;
          end_at: string;
          all_day: boolean;
          etag: string | null;
          status: string;
          busy_status:
            | "free"
            | "busy"
            | "tentative"
            | "oof"
            | "workingElsewhere";
          html_link: string | null;
          organizer_email: string | null;
          organizer_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          calendar_id: string;
          external_id: string;
          title?: string;
          description?: string | null;
          location?: string | null;
          start_at: string;
          end_at: string;
          all_day?: boolean;
          etag?: string | null;
          status?: string;
          busy_status?:
            | "free"
            | "busy"
            | "tentative"
            | "oof"
            | "workingElsewhere";
          html_link?: string | null;
          organizer_email?: string | null;
          organizer_name?: string | null;
        };
        Update: Partial<{
          title: string;
          description: string | null;
          location: string | null;
          start_at: string;
          end_at: string;
          all_day: boolean;
          etag: string | null;
          status: string;
          busy_status:
            | "free"
            | "busy"
            | "tentative"
            | "oof"
            | "workingElsewhere";
          html_link: string | null;
          organizer_email: string | null;
          organizer_name: string | null;
        }>;
        Relationships: [];
      };
      meeting_transcripts: {
        Row: {
          id: string;
          meeting_id: string;
          source_url: string;
          raw_jsonl: string | null;
          speakers: Array<{ id: string; name: string }>;
          duration_seconds: number | null;
          status: "pending" | "fetched" | "failed";
          fetched_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          source_url: string;
          raw_jsonl?: string | null;
          speakers?: Array<{ id: string; name: string }>;
          duration_seconds?: number | null;
          status?: "pending" | "fetched" | "failed";
          fetched_at?: string | null;
        };
        Update: Partial<{
          raw_jsonl: string | null;
          status: "pending" | "fetched" | "failed";
          fetched_at: string | null;
        }>;
        Relationships: [];
      };
      meeting_summaries: {
        Row: {
          id: string;
          meeting_id: string;
          transcript_id: string | null;
          model: string;
          summary_md: string;
          action_items: Array<{ text: string; owner: string | null }>;
          decisions: string[];
          document_id: string | null;
          chat_message_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          transcript_id?: string | null;
          model: string;
          summary_md: string;
          action_items?: Array<{ text: string; owner: string | null }>;
          decisions?: string[];
          document_id?: string | null;
          chat_message_id?: string | null;
        };
        Update: Partial<{
          summary_md: string;
          action_items: Array<{ text: string; owner: string | null }>;
          decisions: string[];
        }>;
        Relationships: [];
      };

      // ─── Workflows (migration 0026) ────────────────────────────────────
      // The spec/payload columns are intentionally typed as Record<string, unknown>
      // — the strict shape lives in lib/workflows/spec.ts (Zod). The DB type just
      // carries it as a JSON blob.

      insight_briefs: {
        Row: {
          property_id: string;
          scope: string;
          insights: Record<string, unknown>[];
          summary: string | null;
          fingerprint: string;
          model: string;
          generated_at: string;
        };
        Insert: {
          property_id: string;
          scope?: string;
          insights: Record<string, unknown>[];
          summary?: string | null;
          fingerprint: string;
          model: string;
          generated_at?: string;
        };
        Update: Partial<{
          scope: string;
          insights: Record<string, unknown>[];
          summary: string | null;
          fingerprint: string;
          model: string;
          generated_at: string;
        }>;
        Relationships: [];
      };

      task_suggestions: {
        Row: {
          id: string;
          property_id: string;
          task_id: string;
          field: "space" | "assignee" | "priority";
          suggested_value: string;
          display_value: string;
          reasoning: string;
          confidence: "low" | "medium" | "high";
          status: "pending" | "accepted" | "dismissed" | "auto_applied";
          model: string | null;
          created_at: string;
          resolved_at: string | null;
          resolved_by: string | null;
        };
        Insert: {
          id?: string;
          property_id: string;
          task_id: string;
          field: "space" | "assignee" | "priority";
          suggested_value: string;
          display_value: string;
          reasoning: string;
          confidence: "low" | "medium" | "high";
          status?: "pending" | "accepted" | "dismissed" | "auto_applied";
          model?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
        };
        Update: Partial<{
          status: "pending" | "accepted" | "dismissed" | "auto_applied";
          resolved_at: string | null;
          resolved_by: string | null;
        }>;
        Relationships: [];
      };

      triage_settings: {
        Row: {
          property_id: string;
          auto_apply: Record<string, boolean>;
          updated_at: string;
        };
        Insert: {
          property_id: string;
          auto_apply?: Record<string, boolean>;
          updated_at?: string;
        };
        Update: Partial<{
          auto_apply: Record<string, boolean>;
          updated_at: string;
        }>;
        Relationships: [];
      };

      insight_prompts: {
        Row: {
          id: string;
          property_id: string;
          user_id: string;
          prompt: string;
          scope: string;
          answer_md: string | null;
          fingerprint: string | null;
          generated_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          user_id: string;
          prompt: string;
          scope?: string;
          answer_md?: string | null;
          fingerprint?: string | null;
          generated_at?: string | null;
        };
        Update: Partial<{
          prompt: string;
          scope: string;
          answer_md: string | null;
          fingerprint: string | null;
          generated_at: string | null;
        }>;
        Relationships: [];
      };

      email_prefs: {
        Row: {
          user_id: string;
          unsubscribe_token: string;
          digests_enabled: boolean;
          alerts_enabled: boolean;
          unsubscribed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          unsubscribe_token?: string;
          digests_enabled?: boolean;
          alerts_enabled?: boolean;
          unsubscribed_at?: string | null;
        };
        Update: Partial<{
          digests_enabled: boolean;
          alerts_enabled: boolean;
          unsubscribed_at: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };

      insight_follows: {
        Row: {
          id: string;
          user_id: string;
          property_id: string;
          scope: string;
          cadence: "daily" | "weekly";
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          property_id: string;
          scope: string;
          cadence: "daily" | "weekly";
        };
        Update: Partial<{
          cadence: "daily" | "weekly";
        }>;
        Relationships: [];
      };

      insight_alert_rules: {
        Row: {
          id: string;
          user_id: string;
          property_id: string;
          scope: string;
          metric:
            | "overdue_count"
            | "blocked_count"
            | "unassigned_urgent_count"
            | "project_at_risk";
          threshold: number | null;
          enabled: boolean;
          last_state: Record<string, unknown>;
          last_triggered_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          property_id: string;
          scope: string;
          metric:
            | "overdue_count"
            | "blocked_count"
            | "unassigned_urgent_count"
            | "project_at_risk";
          threshold?: number | null;
          enabled?: boolean;
          last_state?: Record<string, unknown>;
          last_triggered_at?: string | null;
        };
        Update: Partial<{
          scope: string;
          metric:
            | "overdue_count"
            | "blocked_count"
            | "unassigned_urgent_count"
            | "project_at_risk";
          threshold: number | null;
          enabled: boolean;
          last_state: Record<string, unknown>;
          last_triggered_at: string | null;
          updated_at: string;
        }>;
        Relationships: [];
      };

      insight_email_log: {
        Row: {
          id: string;
          user_id: string;
          property_id: string;
          kind: "digest_daily" | "digest_weekly" | "alert";
          dedupe_key: string;
          resend_id: string | null;
          sent_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          property_id: string;
          kind: "digest_daily" | "digest_weekly" | "alert";
          dedupe_key: string;
          resend_id?: string | null;
        };
        Update: Partial<{
          resend_id: string | null;
        }>;
        Relationships: [];
      };

      handovers: {
        Row: {
          id: string;
          property_id: string;
          author_id: string;
          body_md: string;
          window_start: string | null;
          window_end: string | null;
          channel_id: string | null;
          chat_message_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          author_id: string;
          body_md: string;
          window_start?: string | null;
          window_end?: string | null;
          channel_id?: string | null;
          chat_message_id?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          body_md: string;
          chat_message_id: string | null;
        }>;
        Relationships: [];
      };

      api_tokens: {
        Row: {
          id: string;
          property_id: string;
          name: string;
          token_hash: string;
          created_by: string;
          allowed_tools: string[];
          created_at: string;
          last_used_at: string | null;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          property_id: string;
          name: string;
          token_hash: string;
          created_by: string;
          allowed_tools?: string[];
          last_used_at?: string | null;
          revoked_at?: string | null;
        };
        Update: Partial<{
          name: string;
          allowed_tools: string[];
          last_used_at: string | null;
          revoked_at: string | null;
        }>;
        Relationships: [];
      };

      catch_ups: {
        Row: {
          property_id: string;
          user_id: string;
          subject_kind: "project" | "space";
          subject_id: string;
          last_seen_at: string;
          payload: Record<string, unknown>;
          summary_md: string | null;
          fingerprint: string | null;
          generated_at: string | null;
        };
        Insert: {
          property_id: string;
          user_id: string;
          subject_kind: "project" | "space";
          subject_id: string;
          last_seen_at?: string;
          payload?: Record<string, unknown>;
          summary_md?: string | null;
          fingerprint?: string | null;
          generated_at?: string | null;
        };
        Update: Partial<{
          last_seen_at: string;
          payload: Record<string, unknown>;
          summary_md: string | null;
          fingerprint: string | null;
          generated_at: string | null;
        }>;
        Relationships: [];
      };

      shift_briefs: {
        Row: {
          property_id: string;
          user_id: string;
          last_seen_at: string;
          payload: Record<string, unknown>;
          summary_md: string | null;
          fingerprint: string | null;
          generated_at: string | null;
        };
        Insert: {
          property_id: string;
          user_id: string;
          last_seen_at?: string;
          payload?: Record<string, unknown>;
          summary_md?: string | null;
          fingerprint?: string | null;
          generated_at?: string | null;
        };
        Update: Partial<{
          last_seen_at: string;
          payload: Record<string, unknown>;
          summary_md: string | null;
          fingerprint: string | null;
          generated_at: string | null;
        }>;
        Relationships: [];
      };

      insight_alert_state: {
        Row: {
          property_id: string;
          subject_kind: "project_pace" | "task_slip" | "meta";
          subject_id: string;
          state: string;
          updated_at: string;
        };
        Insert: {
          property_id: string;
          subject_kind: "project_pace" | "task_slip" | "meta";
          subject_id: string;
          state: string;
          updated_at?: string;
        };
        Update: Partial<{
          state: string;
          updated_at: string;
        }>;
        Relationships: [];
      };

      insight_annotations: {
        Row: {
          property_id: string;
          subject_kind: "project";
          subject_id: string;
          cache_key: string;
          note: string;
          model: string;
          created_at: string;
        };
        Insert: {
          property_id: string;
          subject_kind: "project";
          subject_id: string;
          cache_key: string;
          note: string;
          model: string;
        };
        Update: Partial<{
          cache_key: string;
          note: string;
          model: string;
          created_at: string;
        }>;
        Relationships: [];
      };

      insight_reports: {
        Row: {
          id: string;
          property_id: string;
          period_start: string;
          period_end: string;
          audience: "management" | "staff";
          summary_md: string;
          metrics: Record<string, unknown>;
          anomalies: Record<string, unknown>[];
          model: string;
          trace: Record<string, unknown> | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          period_start: string;
          period_end: string;
          audience: "management" | "staff";
          summary_md: string;
          metrics: Record<string, unknown>;
          anomalies?: Record<string, unknown>[];
          model: string;
          trace?: Record<string, unknown> | null;
          created_by?: string | null;
        };
        Update: Partial<{
          summary_md: string;
          metrics: Record<string, unknown>;
          anomalies: Record<string, unknown>[];
          model: string;
          trace: Record<string, unknown> | null;
          created_by: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };

      workflows: {
        Row: {
          id: string;
          property_id: string;
          name: string;
          description: string | null;
          enabled: boolean;
          mode: "instant" | "durable";
          current_version_id: string | null;
          folder_id: string | null;
          created_by: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
          last_run_at: string | null;
          last_run_status: string | null;
          archived_at: string | null;
          webhook_token: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          name: string;
          description?: string | null;
          enabled?: boolean;
          mode?: "instant" | "durable";
          current_version_id?: string | null;
          folder_id?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          webhook_token?: string;
        };
        Update: Partial<{
          name: string;
          description: string | null;
          enabled: boolean;
          mode: "instant" | "durable";
          current_version_id: string | null;
          last_run_at: string | null;
          last_run_status: string | null;
          archived_at: string | null;
          updated_by: string | null;
        }>;
        Relationships: [];
      };

      workflow_versions: {
        Row: {
          id: string;
          workflow_id: string;
          version: number;
          spec: Record<string, unknown>;
          spec_hash: string;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workflow_id: string;
          version: number;
          spec: Record<string, unknown>;
          spec_hash: string;
          notes?: string | null;
          created_by?: string | null;
        };
        Update: Partial<{
          spec: Record<string, unknown>;
          spec_hash: string;
          notes: string | null;
        }>;
        Relationships: [];
      };

      workflow_events: {
        Row: {
          id: string;
          property_id: string;
          source: string;
          event_type: string;
          entity_id: string | null;
          entity_kind: string | null;
          payload: Record<string, unknown>;
          received_at: string;
          dispatched_at: string | null;
          matched_workflow_ids: string[];
          filtered_reason: Record<string, string>;
        };
        Insert: {
          id?: string;
          property_id: string;
          source: string;
          event_type: string;
          entity_id?: string | null;
          entity_kind?: string | null;
          payload?: Record<string, unknown>;
        };
        Update: Partial<{
          dispatched_at: string | null;
          matched_workflow_ids: string[];
          filtered_reason: Record<string, string>;
        }>;
        Relationships: [];
      };

      workflow_runs: {
        Row: {
          id: string;
          workflow_id: string;
          workflow_version_id: string | null;
          property_id: string;
          trigger_event_id: string | null;
          trigger_kind: string | null;
          status:
            | "queued"
            | "running"
            | "waiting"
            | "succeeded"
            | "failed"
            | "cancelled"
            | "filtered";
          mode: "instant" | "durable";
          durable_run_id: string | null;
          triggered_by_user_id: string | null;
          input: Record<string, unknown>;
          output: Record<string, unknown> | null;
          error: string | null;
          error_step_id: string | null;
          is_dry_run: boolean;
          started_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          workflow_id: string;
          workflow_version_id?: string | null;
          property_id: string;
          trigger_event_id?: string | null;
          trigger_kind?: string | null;
          status: WorkflowRunStatus;
          mode: "instant" | "durable";
          durable_run_id?: string | null;
          triggered_by_user_id?: string | null;
          input?: Record<string, unknown>;
          is_dry_run?: boolean;
        };
        Update: Partial<{
          status: WorkflowRunStatus;
          durable_run_id: string | null;
          output: Record<string, unknown> | null;
          error: string | null;
          error_step_id: string | null;
          finished_at: string | null;
        }>;
        Relationships: [];
      };

      workflow_step_runs: {
        Row: {
          id: string;
          run_id: string;
          step_id: string;
          step_type: string;
          status: "queued" | "running" | "succeeded" | "failed" | "skipped";
          attempt: number;
          input: Record<string, unknown>;
          output: Record<string, unknown> | null;
          error: Record<string, unknown> | null;
          ai_trace: Record<string, unknown> | null;
          started_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          run_id: string;
          step_id: string;
          step_type: string;
          status: "queued" | "running" | "succeeded" | "failed" | "skipped";
          attempt?: number;
          input?: Record<string, unknown>;
          output?: Record<string, unknown> | null;
          error?: Record<string, unknown> | null;
          ai_trace?: Record<string, unknown> | null;
          started_at?: string;
          finished_at?: string | null;
        };
        Update: Partial<{
          status: "queued" | "running" | "succeeded" | "failed" | "skipped";
          attempt: number;
          output: Record<string, unknown> | null;
          error: Record<string, unknown> | null;
          ai_trace: Record<string, unknown> | null;
          finished_at: string | null;
        }>;
        Relationships: [];
      };

      workflow_schedules: {
        Row: {
          workflow_id: string;
          cron_expression: string;
          timezone: string;
          next_run_at: string | null;
          pg_cron_jobid: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workflow_id: string;
          cron_expression: string;
          timezone?: string;
          next_run_at?: string | null;
          pg_cron_jobid?: number | null;
        };
        Update: Partial<{
          cron_expression: string;
          timezone: string;
          next_run_at: string | null;
          pg_cron_jobid: number | null;
        }>;
        Relationships: [];
      };

      workflow_templates: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string;
          category: string;
          surfaces: string[];
          spec: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description: string;
          category: string;
          surfaces?: string[];
          spec: Record<string, unknown>;
        };
        Update: Partial<{
          name: string;
          description: string;
          category: string;
          surfaces: string[];
          spec: Record<string, unknown>;
        }>;
        Relationships: [];
      };

      workflow_suggestions: {
        Row: {
          id: string;
          property_id: string;
          proposed_spec: Record<string, unknown>;
          pattern_summary: string;
          est_savings: string | null;
          dismissed_at: string | null;
          dismissed_by: string | null;
          applied_workflow_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          proposed_spec: Record<string, unknown>;
          pattern_summary: string;
          est_savings?: string | null;
        };
        Update: Partial<{
          dismissed_at: string | null;
          dismissed_by: string | null;
          applied_workflow_id: string | null;
        }>;
        Relationships: [];
      };

      workflow_waits: {
        Row: {
          id: string;
          workflow_id: string;
          run_id: string;
          step_id: string;
          property_id: string;
          token: string;
          event_type: string;
          correlate: Record<string, string>;
          timeout_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workflow_id: string;
          run_id: string;
          step_id: string;
          property_id: string;
          token: string;
          event_type: string;
          correlate?: Record<string, string>;
          timeout_at?: string | null;
        };
        Update: Partial<{
          correlate: Record<string, string>;
          timeout_at: string | null;
        }>;
        Relationships: [];
      };

      entity_types: {
        Row: {
          id: string;
          property_id: string;
          name: string;
          display_name: string;
          schema: Record<string, unknown>;
          display_config: Record<string, unknown>;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          name: string;
          display_name: string;
          schema?: Record<string, unknown>;
          display_config?: Record<string, unknown>;
          created_by?: string | null;
        };
        Update: Partial<{
          name: string;
          display_name: string;
          schema: Record<string, unknown>;
          display_config: Record<string, unknown>;
        }>;
        Relationships: [];
      };

      entities: {
        Row: {
          id: string;
          property_id: string;
          entity_type_id: string;
          data: Record<string, unknown>;
          created_by: string | null;
          source: RecordSource;
          source_workflow_id: string | null;
          source_workflow_run_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          entity_type_id: string;
          data?: Record<string, unknown>;
          created_by?: string | null;
          source?: RecordSource;
          source_workflow_id?: string | null;
          source_workflow_run_id?: string | null;
        };
        Update: Partial<{
          data: Record<string, unknown>;
        }>;
        Relationships: [];
      };
      forms: {
        Row: {
          id: string;
          property_id: string;
          title: string;
          description: string | null;
          icon: string | null;
          schema: Record<string, unknown>;
          status: FormStatus;
          allow_multiple: boolean;
          anonymous: boolean;
          space_id: string | null;
          created_by: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          title: string;
          description?: string | null;
          icon?: string | null;
          schema?: Record<string, unknown>;
          status?: FormStatus;
          allow_multiple?: boolean;
          anonymous?: boolean;
          space_id?: string | null;
          created_by?: string | null;
        };
        Update: Partial<{
          title: string;
          description: string | null;
          icon: string | null;
          schema: Record<string, unknown>;
          status: FormStatus;
          allow_multiple: boolean;
          anonymous: boolean;
          space_id: string | null;
          archived_at: string | null;
        }>;
        Relationships: [];
      };
      form_responses: {
        Row: {
          id: string;
          form_id: string;
          property_id: string;
          respondent_id: string | null;
          answers: Record<string, unknown>;
          source: FormResponseSource;
          created_at: string;
        };
        Insert: {
          id?: string;
          form_id: string;
          property_id: string;
          respondent_id?: string | null;
          answers?: Record<string, unknown>;
          source?: FormResponseSource;
          created_at?: string;
        };
        Update: Partial<Record<string, never>>;
        Relationships: [];
      };
      property_profiles: {
        Row: {
          property_id: string;
          property_type: string | null;
          team_size: string | null;
          departments: unknown[];
          priorities: unknown[];
          role_title: string | null;
          answers: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          property_id: string;
          property_type?: string | null;
          team_size?: string | null;
          departments?: unknown[];
          priorities?: unknown[];
          role_title?: string | null;
          answers?: Record<string, unknown>;
        };
        Update: Partial<{
          property_type: string | null;
          team_size: string | null;
          departments: unknown[];
          priorities: unknown[];
          role_title: string | null;
          answers: Record<string, unknown>;
        }>;
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          slug: string;
          name: string;
          brain_source: string;
          brain_client_id: string;
          brain_client_secret_ref: string;
          status: "active" | "paused" | "offboarded";
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          brain_source?: string;
          brain_client_id?: string;
          brain_client_secret_ref?: string;
          status?: "active" | "paused" | "offboarded";
        };
        Update: Partial<{
          slug: string;
          name: string;
          brain_source: string;
          brain_client_id: string;
          brain_client_secret_ref: string;
          status: "active" | "paused" | "offboarded";
        }>;
        Relationships: [];
      };
      bots: {
        Row: {
          id: string;
          client_id: string;
          bot_id: string;
          display_name: string;
          persona_fallback: string | null;
          tool_set: string[];
          model_tier: "standard" | "advanced";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          bot_id: string;
          display_name: string;
          persona_fallback?: string | null;
          tool_set?: string[];
          model_tier?: "standard" | "advanced";
        };
        Update: Partial<{
          display_name: string;
          persona_fallback: string | null;
          tool_set: string[];
          model_tier: "standard" | "advanced";
        }>;
        Relationships: [];
      };
      bot_chat_sessions: {
        Row: {
          id: string;
          client_id: string;
          property_id: string;
          bot_id: string;
          channel_id: string;
          eve_session_id: string | null;
          eve_continuation_token: string | null;
          last_turn_at: string | null;
          status: "idle" | "awaiting_approval";
          pending_approval: Record<string, unknown> | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          property_id: string;
          bot_id: string;
          channel_id: string;
          eve_session_id?: string | null;
          eve_continuation_token?: string | null;
          last_turn_at?: string | null;
          status?: "idle" | "awaiting_approval";
          pending_approval?: Record<string, unknown> | null;
        };
        Update: Partial<{
          eve_session_id: string | null;
          eve_continuation_token: string | null;
          last_turn_at: string | null;
          status: "idle" | "awaiting_approval";
          pending_approval: Record<string, unknown> | null;
        }>;
        Relationships: [];
      };
      property_brains: {
        Row: {
          property_id: string;
          source: string;
          client_id: string;
          client_secret_enc: string;
          created_at: string;
        };
        Insert: {
          property_id: string;
          source: string;
          client_id: string;
          client_secret_enc: string;
        };
        Update: Partial<{
          source: string;
          client_id: string;
          client_secret_enc: string;
        }>;
        Relationships: [];
      };
      channel_bot_sessions: {
        Row: {
          id: string;
          property_id: string;
          channel_id: string;
          thread_key: string;
          eve_session_id: string | null;
          eve_continuation_token: string | null;
          status: "idle" | "awaiting_approval";
          pending_approval: Record<string, unknown> | null;
          // Runtime build that created the eve session (0091) — mismatch
          // means start fresh, never resume (tool registries don't survive
          // across builds).
          runtime_tag: string | null;
          // Event-driven delivery accumulator (0092) — written by the eve
          // channel's events handlers (agent/lib/channel-delivery.ts).
          channel_type: "team" | "messaging";
          turn_nonce: string | null;
          reply_candidate: string | null;
          ui_spec: unknown;
          delivered_nonce: string | null;
          // Turn claim + background jobs (0093).
          turn_state: "idle" | "running";
          turn_started_at: string | null;
          kind: "chat" | "job";
          job_headline: string | null;
          // Progress line for the chat thinking row (0095) — short human
          // label the runtime advances per tool batch, null between turns.
          turn_activity: string | null;
          // Stream message id of the question this session parked on (0098).
          // A reply in that message's thread routes the answer back here —
          // the only path a background job can be answered by.
          question_message_id: string | null;
          last_turn_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          channel_id: string;
          thread_key?: string;
          eve_session_id?: string | null;
          eve_continuation_token?: string | null;
          status?: "idle" | "awaiting_approval";
          pending_approval?: Record<string, unknown> | null;
          runtime_tag?: string | null;
          channel_type?: "team" | "messaging";
          turn_nonce?: string | null;
          reply_candidate?: string | null;
          ui_spec?: unknown;
          delivered_nonce?: string | null;
          turn_state?: "idle" | "running";
          turn_started_at?: string | null;
          kind?: "chat" | "job";
          job_headline?: string | null;
          turn_activity?: string | null;
          question_message_id?: string | null;
          last_turn_at?: string | null;
        };
        Update: Partial<{
          eve_session_id: string | null;
          eve_continuation_token: string | null;
          status: "idle" | "awaiting_approval";
          pending_approval: Record<string, unknown> | null;
          runtime_tag: string | null;
          channel_type: "team" | "messaging";
          turn_nonce: string | null;
          reply_candidate: string | null;
          ui_spec: unknown;
          delivered_nonce: string | null;
          turn_state: "idle" | "running";
          turn_started_at: string | null;
          kind: "chat" | "job";
          job_headline: string | null;
          turn_activity: string | null;
          question_message_id: string | null;
          last_turn_at: string | null;
        }>;
        Relationships: [];
      };
      channel_bot_activity: {
        Row: {
          id: string;
          property_id: string;
          channel_id: string;
          thread_key: string;
          // channel_bot_sessions.turn_nonce this step belongs to (0096).
          turn_nonce: string;
          label: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          channel_id: string;
          thread_key?: string;
          turn_nonce: string;
          label: string;
        };
        Update: Partial<{ label: string }>;
        Relationships: [];
      };
      channel_bot_queue: {
        Row: {
          id: string;
          property_id: string;
          channel_id: string;
          thread_key: string;
          message: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          channel_id: string;
          thread_key?: string;
          message: Record<string, unknown>;
        };
        Update: Partial<{
          message: Record<string, unknown>;
        }>;
        Relationships: [];
      };
      agents: {
        Row: {
          id: string;
          property_id: string;
          name: string;
          config: Record<string, unknown>;
          status: AgentStatus;
          created_by: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          name: string;
          config?: Record<string, unknown>;
          status?: AgentStatus;
          created_by?: string | null;
        };
        Update: Partial<{
          name: string;
          config: Record<string, unknown>;
          status: AgentStatus;
          archived_at: string | null;
        }>;
        Relationships: [];
      };
      agent_sessions: {
        Row: {
          id: string;
          agent_id: string;
          property_id: string;
          user_id: string;
          title: string;
          continuation_token: string | null;
          last_message_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          agent_id: string;
          property_id: string;
          user_id: string;
          title?: string;
          continuation_token?: string | null;
          last_message_at?: string;
        };
        Update: Partial<{
          title: string;
          continuation_token: string | null;
          last_message_at: string;
        }>;
        Relationships: [];
      };
      chatbots: {
        Row: {
          id: string;
          property_id: string;
          name: string;
          public_slug: string;
          template: ChatbotTemplateKind;
          config: Record<string, unknown>;
          status: ChatbotStatus;
          daily_message_cap: number;
          session_message_cap: number;
          allowed_domains: string[];
          twilio_number: string | null;
          last_trained_at: string | null;
          created_by: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          name: string;
          public_slug?: string;
          template?: ChatbotTemplateKind;
          config?: Record<string, unknown>;
          status?: ChatbotStatus;
          daily_message_cap?: number;
          session_message_cap?: number;
          allowed_domains?: string[];
          twilio_number?: string | null;
          created_by?: string | null;
        };
        Update: Partial<{
          name: string;
          public_slug: string;
          template: ChatbotTemplateKind;
          config: Record<string, unknown>;
          status: ChatbotStatus;
          daily_message_cap: number;
          session_message_cap: number;
          allowed_domains: string[];
          twilio_number: string | null;
          last_trained_at: string | null;
          archived_at: string | null;
        }>;
        Relationships: [];
      };
      chatbot_knowledge_sources: {
        Row: {
          id: string;
          chatbot_id: string;
          property_id: string;
          kind: ChatbotKnowledgeKind;
          title: string;
          content: string | null;
          question: string | null;
          document_id: string | null;
          url: string | null;
          status: ChatbotKnowledgeStatus;
          error: string | null;
          char_count: number;
          last_trained_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          chatbot_id: string;
          property_id: string;
          kind: ChatbotKnowledgeKind;
          title: string;
          content?: string | null;
          question?: string | null;
          document_id?: string | null;
          url?: string | null;
          status?: ChatbotKnowledgeStatus;
          error?: string | null;
          char_count?: number;
          last_trained_at?: string | null;
        };
        Update: Partial<{
          title: string;
          content: string | null;
          question: string | null;
          document_id: string | null;
          url: string | null;
          status: ChatbotKnowledgeStatus;
          error: string | null;
          char_count: number;
          last_trained_at: string | null;
        }>;
        Relationships: [];
      };
      chatbot_knowledge_chunks: {
        Row: {
          id: string;
          source_id: string;
          chatbot_id: string;
          property_id: string;
          content: string;
          embedding: unknown | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          source_id: string;
          chatbot_id: string;
          property_id: string;
          content: string;
          embedding?: unknown | null;
        };
        Update: Partial<{
          content: string;
          embedding: unknown | null;
        }>;
        Relationships: [];
      };
      chatbot_conversations: {
        Row: {
          id: string;
          chatbot_id: string;
          property_id: string;
          session_token: string;
          channel: ChatbotConversationChannel;
          guest_name: string | null;
          guest_email: string | null;
          guest_phone: string | null;
          room_number: string | null;
          status: ChatbotConversationStatus;
          outcome: ChatbotConversationOutcome;
          outcome_meta: Record<string, unknown>;
          message_count: number;
          last_message_at: string | null;
          topic: string | null;
          sentiment: "positive" | "neutral" | "negative" | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          chatbot_id: string;
          property_id: string;
          session_token: string;
          channel?: ChatbotConversationChannel;
          guest_name?: string | null;
          guest_email?: string | null;
          guest_phone?: string | null;
          room_number?: string | null;
          status?: ChatbotConversationStatus;
          outcome?: ChatbotConversationOutcome;
          outcome_meta?: Record<string, unknown>;
          message_count?: number;
          last_message_at?: string | null;
        };
        Update: Partial<{
          guest_name: string | null;
          guest_email: string | null;
          guest_phone: string | null;
          room_number: string | null;
          status: ChatbotConversationStatus;
          outcome: ChatbotConversationOutcome;
          outcome_meta: Record<string, unknown>;
          message_count: number;
          last_message_at: string | null;
          topic: string | null;
          sentiment: "positive" | "neutral" | "negative" | null;
        }>;
        Relationships: [];
      };
      bookable_services: {
        Row: {
          id: string;
          property_id: string;
          name: string;
          description: string | null;
          emoji: string | null;
          kind: BookableServiceKind;
          booking_mode: BookingMode;
          schedule: Record<string, unknown>;
          timezone: string;
          active: boolean;
          public_bookable: boolean;
          created_by: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          name: string;
          description?: string | null;
          emoji?: string | null;
          kind?: BookableServiceKind;
          booking_mode?: BookingMode;
          schedule?: Record<string, unknown>;
          timezone?: string;
          active?: boolean;
          public_bookable?: boolean;
          created_by?: string | null;
        };
        Update: Partial<{
          name: string;
          description: string | null;
          emoji: string | null;
          kind: BookableServiceKind;
          booking_mode: BookingMode;
          schedule: Record<string, unknown>;
          timezone: string;
          active: boolean;
          public_bookable: boolean;
          archived_at: string | null;
        }>;
        Relationships: [];
      };
      service_resources: {
        Row: {
          id: string;
          service_id: string;
          property_id: string;
          name: string;
          seats: number;
          min_party: number;
          shape: ResourceShape;
          x: number;
          y: number;
          w: number;
          h: number;
          zone: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          service_id: string;
          property_id: string;
          name: string;
          seats?: number;
          min_party?: number;
          shape?: ResourceShape;
          x?: number;
          y?: number;
          w?: number;
          h?: number;
          zone?: string | null;
          active?: boolean;
        };
        Update: Partial<{
          name: string;
          seats: number;
          min_party: number;
          shape: ResourceShape;
          x: number;
          y: number;
          w: number;
          h: number;
          zone: string | null;
          active: boolean;
        }>;
        Relationships: [];
      };
      bookings: {
        Row: {
          id: string;
          property_id: string;
          service_id: string;
          reference: string;
          guest_name: string;
          guest_phone: string | null;
          guest_email: string | null;
          party_size: number;
          starts_at: string;
          ends_at: string;
          status: BookingStatus;
          notes: string | null;
          source: BookingSource;
          chatbot_id: string | null;
          conversation_id: string | null;
          resource_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          service_id: string;
          reference: string;
          guest_name: string;
          guest_phone?: string | null;
          guest_email?: string | null;
          party_size?: number;
          starts_at: string;
          ends_at: string;
          status?: BookingStatus;
          notes?: string | null;
          source?: BookingSource;
          chatbot_id?: string | null;
          conversation_id?: string | null;
          resource_id?: string | null;
          created_by?: string | null;
        };
        Update: Partial<{
          guest_name: string;
          guest_phone: string | null;
          guest_email: string | null;
          party_size: number;
          starts_at: string;
          ends_at: string;
          status: BookingStatus;
          notes: string | null;
          resource_id: string | null;
        }>;
        Relationships: [];
      };
      chatbot_channel_deployments: {
        Row: {
          id: string;
          chatbot_id: string;
          property_id: string;
          stream_channel_id: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          chatbot_id: string;
          property_id: string;
          stream_channel_id: string;
          created_by?: string | null;
        };
        Update: Partial<Record<string, never>>;
        Relationships: [];
      };
      chatbot_messages: {
        Row: {
          id: string;
          conversation_id: string;
          property_id: string;
          role: ChatbotMessageRole;
          content: string;
          tool_calls: unknown[] | null;
          attachments: unknown;
          tokens: number | null;
          feedback: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          property_id: string;
          role: ChatbotMessageRole;
          content: string;
          tool_calls?: unknown[] | null;
          attachments?: unknown;
          tokens?: number | null;
          feedback?: number | null;
          created_at?: string;
        };
        Update: Partial<{
          feedback: number | null;
        }>;
        Relationships: [];
      };
      chatbot_custom_actions: {
        Row: {
          id: string;
          chatbot_id: string;
          property_id: string;
          name: string;
          when_to_use: string | null;
          method: ChatbotActionMethod;
          url: string;
          headers: { name: string; value_encrypted: string }[];
          body_template: string | null;
          param_schema: {
            id: string;
            name: string;
            type: "string" | "number" | "boolean";
            description: string;
            required: boolean;
          }[];
          response_allowlist: string[];
          enabled: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          chatbot_id: string;
          property_id: string;
          name: string;
          when_to_use?: string | null;
          method?: ChatbotActionMethod;
          url: string;
          headers?: { name: string; value_encrypted: string }[];
          body_template?: string | null;
          param_schema?: {
            id: string;
            name: string;
            type: "string" | "number" | "boolean";
            description: string;
            required: boolean;
          }[];
          response_allowlist?: string[];
          enabled?: boolean;
          created_by?: string | null;
        };
        Update: Partial<{
          name: string;
          when_to_use: string | null;
          method: ChatbotActionMethod;
          url: string;
          headers: { name: string; value_encrypted: string }[];
          body_template: string | null;
          param_schema: {
            id: string;
            name: string;
            type: "string" | "number" | "boolean";
            description: string;
            required: boolean;
          }[];
          response_allowlist: string[];
          enabled: boolean;
        }>;
        Relationships: [];
      };
      chatbot_usage_daily: {
        Row: {
          chatbot_id: string;
          property_id: string;
          day: string;
          messages: number;
          tokens: number;
        };
        Insert: {
          chatbot_id: string;
          property_id: string;
          day: string;
          messages?: number;
          tokens?: number;
        };
        Update: Partial<{
          messages: number;
          tokens: number;
        }>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_member: {
        Args: { prop_id: string };
        Returns: boolean;
      };
      archive_document_tree: {
        Args: { root: string };
        Returns: undefined;
      };
      restore_document_tree: {
        Args: { root: string };
        Returns: undefined;
      };
      // Free/busy aggregator for the team availability overlay. RLS would
      // block reading another user's external_events directly; this
      // SECURITY DEFINER fn returns only time ranges + busy flag — no
      // titles, descriptions, or attendees. Caller is verified as a
      // member of `property_id` inside the function. Migration 0018.
      calendar_free_busy: {
        Args: {
          user_ids: string[];
          from_ts: string;
          to_ts: string;
          property_id: string;
        };
        Returns: Array<{
          user_id: string;
          start_at: string;
          end_at: string;
          busy: "busy" | "tentative" | "free";
        }>;
      };
      // Keyword search over title + body_text (migration 0019). RLS-aware
      // via security invoker; clamps `match_count` to [1, 50] server-side.
      search_documents_keyword: {
        Args: {
          property_id_param: string;
          query_text: string;
          match_count?: number;
        };
        Returns: Array<{
          id: string;
          title: string;
          preview: string;
          updated_at: string;
          rank: number;
        }>;
      };
      // Workflow scheduling — migration 0028.
      workflows_schedule_cron: {
        Args: {
          p_workflow_id: string;
          p_cron: string;
          p_timezone?: string;
        };
        Returns: number;
      };
      workflows_unschedule_cron: {
        Args: { p_workflow_id: string };
        Returns: undefined;
      };
      workflows_emit_cron_event: {
        Args: { p_workflow_id: string };
        Returns: undefined;
      };
      // Chatbots — migration 0061.
      increment_chatbot_usage: {
        Args: {
          p_chatbot_id: string;
          p_property_id: string;
          p_day: string;
          p_messages: number;
          p_tokens: number;
        };
        Returns: number;
      };
      search_chatbot_chunks: {
        Args: {
          p_chatbot_id: string;
          p_query: string;
          p_limit?: number;
        };
        Returns: Array<{
          content: string;
          source_title: string;
          rank: number;
        }>;
      };
      // Vector + FTS RRF merge — migration 0062. p_embedding is the
      // pgvector text form ("[0.1,0.2,…]").
      search_chatbot_chunks_hybrid: {
        Args: {
          p_chatbot_id: string;
          p_query: string;
          p_embedding: string;
          p_limit?: number;
        };
        Returns: Array<{
          content: string;
          source_title: string;
          rank: number;
        }>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
