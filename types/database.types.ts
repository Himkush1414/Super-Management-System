/**
 * types/database.types.ts
 * Hand-maintained until `supabase gen types typescript` is wired up:
 *   npx supabase gen types typescript --project-id ywzwzrzlittjiosskmcy > types/database.types.ts
 * Keep in sync with supabase/migrations/.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole =
  | "head_admin"
  | "admin"
  | "manager"
  | "product_supervisor"
  | "maker";

export type UserStatus = "pending" | "active" | "rejected" | "suspended";
export type RequestStatus = "pending" | "approved" | "rejected";
export type ProjectStatus =
  | "draft"
  | "quoted"
  | "approved"
  | "in_production"
  | "quality_check"
  | "completed"
  | "on_hold"
  | "cancelled";
export type TaskStatus = "assigned" | "in_progress" | "completed";
export type TransformerType =
  | "distribution"
  | "power"
  | "dry_type"
  | "furnace"
  | "rectifier"
  | "isolation";

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  contact_method: "email" | "phone";
  role: UserRole;
  status: UserStatus;
  is_demo_account: boolean;
  last_active_at: string;
  created_at: string;
  updated_at: string;
}

export interface SignupRequest {
  id: string;
  profile_id: string;
  /** Null while pending — set by Head Admin at approval time. */
  requested_role: UserRole | null;
  status: RequestStatus;
  reviewer_id: string | null;
  reviewed_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  client_name: string;
  client_contact: string | null;
  status: ProjectStatus;
  transformer_kind: TransformerType;
  capacity_kva: number | null;
  primary_voltage: string | null;
  secondary_voltage: string | null;
  phase: number | null;
  frequency_hz: number | null;
  cooling_type: string | null;
  impedance_pct: number | null;
  requirements_notes: string;
  quantity: number;
  unit_price: number | null;
  material_cost: number | null;
  labour_cost: number | null;
  margin: number | null;
  total_price: number | null;
  assigned_manager: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectAssignment {
  id: string;
  project_id: string;
  user_id: string;
  role_at_assignment: UserRole;
  assigned_by: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  assigned_to: string | null;
  status: TaskStatus;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  project_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  actor_id: string | null;
  actor_label: string | null;
  /** Denormalised at write time; used only by audit_log_view's masking. */
  actor_role?: UserRole | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Json;
  after: Json;
  created_at: string;
}

export interface DirectConversation {
  id: string;
  user_a: string;
  user_b: string;
  last_message_at: string;
  created_at: string;
}

export interface DirectMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: "text" | "voice";
  body: string | null;
  voice_path: string | null;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

type Row<T> = { Row: T; Insert: Partial<T>; Update: Partial<T>; Relationships: [] };

export interface Database {
  public: {
    Tables: {
      profiles: Row<Profile>;
      signup_requests: Row<SignupRequest>;
      projects: Row<Project>;
      project_assignments: Row<ProjectAssignment>;
      tasks: Row<Task>;
      messages: Row<Message>;
      audit_log: Row<AuditEntry>;
      notifications: Row<NotificationRow>;
      direct_conversations: Row<DirectConversation>;
      direct_messages: Row<DirectMessage>;
    };
    Views: {
      audit_log_view: { Row: Omit<AuditEntry, "actor_role">; Relationships: [] };
    };
    Functions: {
      review_signup_request: {
        Args: {
          request_id: string;
          decision: RequestStatus;
          assigned_role?: UserRole | null;
          note?: string | null;
        };
        Returns: undefined;
      };
      reapply_signup: { Args: { requested?: UserRole | null }; Returns: undefined };
      set_user_role: { Args: { target: string; new_role: UserRole }; Returns: undefined };
      has_perm: { Args: { perm: string }; Returns: boolean };
      get_or_create_direct_conversation: { Args: { other: string }; Returns: string };
    };
    Enums: {
      user_role: UserRole;
      user_status: UserStatus;
      request_status: RequestStatus;
      project_status: ProjectStatus;
      task_status: TaskStatus;
      transformer_type: TransformerType;
    };
    CompositeTypes: Record<string, never>;
  };
}
