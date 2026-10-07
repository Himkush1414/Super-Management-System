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

// "dispatcher" (0022) is retired: the database keeps the value, the app has
// no such role (lib/permissions.ts) and those accounts can't sign in.
export type UserRole = "head_admin" | "admin" | "marketing" | "production" | "dispatcher";

export type OrderStatus = "active" | "waiting_on_production_phone";

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  /** Marketing / production only; required before they can use the app (0016). */
  real_name: string | null;
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
  product_name: string;
  client_name: string;
  /** Free-text delivery destination (0021); '' when not given. */
  ship_to: string;
  transformer_rating: string;
  quantity: number;
  /** ISO date (YYYY-MM-DD), or null when not given. */
  expected_delivery: string | null;
  description: string;
  /**
   * Order subtotal = Σ(product price + 18% GST) + Additional Amount (0021).
   * null when the viewer isn't allowed to see it (production).
   */
  price: number | null;
  /**
   * One extra amount for the whole order, added at the very end — never part
   * of a product's price or GST (0021; replaces per-product FEAT). Same
   * visibility as price.
   */
  additional_amount: number | null;
  stage: number;
  status: OrderStatus;
  whatsapp_group_created: boolean;
  whatsapp_group_id: string | null;
  created_at: string;
  updated_at: string;
  /** When the assigned production account may advance to the next stage; null = may advance now. */
  stage_ready_at: string | null;
  /** Left from the retired dispatch review (0023); unused since 0024. */
  review_started_at: string | null;
  review_started_by: string | null;
  /** Production members this order was sent to (order_feed only). */
  assignee_ids: string[];
  /**
   * The order's products in entry order (order_feed only, 0019). The
   * product_name / transformer_rating / quantity / description columns above
   * mirror the FIRST product; `price` is the order total.
   */
  items: OrderItem[];
}

/** One product in an order (order_items, read via order_feed.items). */
export interface OrderItem {
  id: string;
  position: number;
  product_name: string;
  transformer_rating: string;
  quantity: number;
  /** null when not given, or when the viewer isn't allowed to see it. */
  price: number | null;
  /** 18% GST on this product's price (0021). Same visibility as price. */
  gst: number | null;
  description: string;
}

export interface OrderAssignee {
  order_id: string;
  profile_id: string;
  created_at: string;
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
      order_assignees: Row<OrderAssignee>;
      order_stage_events: Row<OrderStageEvent>;
      notifications: Row<NotificationRow>;
    };
    Views: {
      order_feed: { Row: Order; Relationships: [] };
    };
    Functions: Record<string, never>;
  };
}
