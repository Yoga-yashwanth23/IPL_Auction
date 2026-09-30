// Hand-written to match supabase/schema.sql.
// If you prefer generated types, run:
//   npx supabase gen types typescript --project-id <your-project-ref> > src/types/database.ts

export type ImageStatus = "matched" | "missing" | "needs_review";
export type AuctionStatus = "ready" | "live" | "bidding" | "completed" | "ended";
export type AuctionPlayerStatus = "pending" | "live" | "sold" | "unsold" | "re_auction";
export type TimerStatus = "running" | "paused" | "stopped";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          role: "admin" | "operator" | "viewer";
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["users"]["Row"]> & { id: string; email: string };
        Update: Partial<Database["public"]["Tables"]["users"]["Row"]>;
      };
      teams: {
        Row: {
          id: string;
          code: string;
          name: string;
          logo_url: string | null;
          primary_color: string | null;
          purse_total: number;
          purse_remaining: number;
          squad_size_limit: number;
          squad_size_min: number;
          overseas_limit: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["teams"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["teams"]["Row"]>;
      };
      players: {
        Row: {
          id: string;
          external_player_id: string;
          name: string;
          country: string | null;
          country_code: string | null;
          role: string | null;
          category: string | null;
          base_price: number;
          age: number | null;
          batting_style: string | null;
          bowling_style: string | null;
          stats: Record<string, unknown>;
          image_filename: string | null;
          image_url: string | null;
          image_status: ImageStatus;
          is_duplicate: boolean;
          duplicate_of: string | null;
          import_batch_id: string | null;
          discipline: "BA" | "AR" | "WK" | "FA" | "SP" | null;
          capped_status: "Capped" | "Uncapped" | null;
          is_marquee: boolean;
          set_code: "M1" | "M2" | "BA" | "AR" | "WK" | "FA" | "SP" | "UBA" | "UAR" | "UWK" | "UFA" | "USP" | null;
          set_order: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["players"]["Row"]> & {
          external_player_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["players"]["Row"]>;
      };
      auctions: {
        Row: {
          id: string;
          name: string;
          status: AuctionStatus;
          current_auction_player_id: string | null;
          current_bid: number;
          current_increment: number;
          highest_bidder_team_id: string | null;
          timer_seconds: number;
          timer_remaining: number;
          timer_status: TimerStatus;
          default_increment_options: number[];
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["auctions"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["auctions"]["Row"]>;
      };
      auction_players: {
        Row: {
          id: string;
          auction_id: string;
          player_id: string;
          order_index: number;
          status: AuctionPlayerStatus;
          final_price: number | null;
          sold_to_team_id: string | null;
          re_auction_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["auction_players"]["Row"]> & {
          auction_id: string;
          player_id: string;
          order_index: number;
        };
        Update: Partial<Database["public"]["Tables"]["auction_players"]["Row"]>;
      };
      bids: {
        Row: {
          id: string;
          auction_id: string;
          auction_player_id: string;
          team_id: string;
          amount: number;
          increment_used: number;
          placed_by: string | null;
          is_undone: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["bids"]["Row"]> & {
          auction_id: string;
          auction_player_id: string;
          team_id: string;
          amount: number;
          increment_used: number;
        };
        Update: Partial<Database["public"]["Tables"]["bids"]["Row"]>;
      };
      purchases: {
        Row: {
          id: string;
          auction_id: string;
          auction_player_id: string;
          player_id: string;
          team_id: string;
          price: number;
          is_overseas: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["purchases"]["Row"]> & {
          auction_id: string;
          auction_player_id: string;
          player_id: string;
          team_id: string;
          price: number;
        };
        Update: Partial<Database["public"]["Tables"]["purchases"]["Row"]>;
      };
      team_squads: {
        Row: {
          id: string;
          auction_id: string;
          team_id: string;
          player_id: string;
          price: number;
          is_overseas: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["team_squads"]["Row"]> & {
          auction_id: string;
          team_id: string;
          player_id: string;
          price: number;
        };
        Update: Partial<Database["public"]["Tables"]["team_squads"]["Row"]>;
      };
      auction_events: {
        Row: {
          id: string;
          auction_id: string;
          event_type: string;
          auction_player_id: string | null;
          team_id: string | null;
          payload: Record<string, unknown>;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["auction_events"]["Row"]> & {
          auction_id: string;
          event_type: string;
        };
        Update: Partial<Database["public"]["Tables"]["auction_events"]["Row"]>;
      };
    };
  };
}
