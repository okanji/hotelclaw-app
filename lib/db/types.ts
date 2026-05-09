// Generated DB types live here. For now we hand-write the minimal shape we use;
// once the Supabase project is provisioned, regenerate with:
//   pnpm dlx supabase gen types typescript --project-id <id> > lib/db/types.ts

export type Role = "owner" | "manager" | "staff";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface Database {
  public: {
    Tables: {
      properties: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_at?: string;
        };
        Update: Partial<{
          name: string;
          slug: string;
        }>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          full_name: string | null;
          avatar_url: string | null;
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
        };
        Update: Partial<{
          name: string;
          is_private: boolean;
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
        };
        Update: Partial<{
          title: string;
          description: string | null;
          status: TaskStatus;
          priority: TaskPriority;
          assignee_id: string | null;
          due_at: string | null;
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
