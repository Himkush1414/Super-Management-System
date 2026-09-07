/**
 * types/database.types.ts
 * Hand-maintained. Keep in sync with supabase/migrations/.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "head_admin" | "admin" | "marketing" | "production";

export type OrderStatus = "active" | "waiting_on_production_phone";

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface ProductionSettings {
  profile_id: string;
  phone: string | null;
  confirmed_at: string | null;
  updated_at: string;
}

export interface Order {
  id: string;
  created_by: string;
  assigned_to: string;
  product_name: string;
  quality: string;
  quantity: number;
  power_type: string;
  description: string;
  /** null when the viewer isn't allowed to see it (production). */
  price: number | null;
  stage: number;
  status: OrderStatus;
  whatsapp_group_created: boolean;
  whatsapp_group_id: string | null;
  production_phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderStageEvent {
  id: string;
  order_id: string;
  from_stage: number | null;
  to_stage: number;
  changed_by: string | null;
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
      production_settings: Row<ProductionSettings>;
      orders: Row<Order>;
      order_stage_events: Row<OrderStageEvent>;
      notifications: Row<NotificationRow>;
    };
    Views: {
      order_feed: { Row: Order; Relationships: [] };
    };
    Functions: Record<string, never>;
  };
}
