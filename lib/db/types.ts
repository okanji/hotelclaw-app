// Generated DB types live here. For now we hand-write the minimal shape we use;
// once the Supabase project is provisioned, regenerate with:
//   pnpm dlx supabase gen types typescript --project-id <id> > lib/db/types.ts

export type Role = "owner" | "manager" | "staff";

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
          archived_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          archived_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          name: string;
          slug: string;
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
        };
        Insert: {
          property_id: string;
          user_id: string;
          role: Role;
          created_at?: string;
        };
        Update: Partial<{
          role: Role;
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
          created_by?: string | null;
          created_at?: string;
          archived_at?: string | null;
        };
        Update: Partial<{
          name: string;
          is_private: boolean;
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
          created_by: string | null;
          last_edited_by: string | null;
          archived_at: string | null;
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
          created_by?: string | null;
          last_edited_by?: string | null;
          archived_at?: string | null;
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
          last_edited_by: string | null;
          archived_at: string | null;
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
        }>;
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
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          related_task_id: string;
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
        };
        Insert: {
          id?: string;
          property_id: string;
          email: string;
          role: Role;
          token: string;
          expires_at: string;
          created_by?: string | null;
        };
        Update: Partial<{
          accepted_at: string | null;
          expires_at: string;
          role: Role;
        }>;
        Relationships: [];
      };
      document_boards: {
        Row: {
          id: string;
          property_id: string;
          name: string;
          color: BoardColor;
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
          color: BoardColor;
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
