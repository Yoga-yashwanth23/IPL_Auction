import type { Database, ImageStatus, AuctionPlayerStatus } from "./database";

export type { AuctionPlayerStatus };
export type PlayerRow = Database["public"]["Tables"]["players"]["Row"];
export type TeamRow = Database["public"]["Tables"]["teams"]["Row"];
export type AuctionRow = Database["public"]["Tables"]["auctions"]["Row"];
export type AuctionPlayerRow = Database["public"]["Tables"]["auction_players"]["Row"];
export type BidRow = Database["public"]["Tables"]["bids"]["Row"];

/** A single row parsed from an uploaded CSV / Excel / JSON dataset, before validation. */
export interface RawPlayerRecord {
  player_id: string;
  name: string;
  country?: string;
  /** Indian domestic state the player represents — used to disambiguate same-named Indian players in photo search. */
  state?: string;
  role?: string;
  base_price?: number | string;
  country_code?: string;
  category?: string;
  age?: number | string;
  batting_style?: string;
  bowling_style?: string;
  image_filename?: string;
  image_url?: string;
  stats?: Record<string, unknown> | string;
  /** Auction-committee flag — whether this player goes into Marquee Set 1/2. Never derived from stats. */
  is_marquee?: boolean | string;
  [key: string]: unknown;
}

export interface ParsedDataset {
  records: RawPlayerRecord[];
  errors: DatasetError[];
  sourceFileName: string;
}

export interface DatasetError {
  rowIndex: number;
  message: string;
}

export interface ImageAsset {
  fileName: string;
  normalizedKey: string;
  file: File;
  objectUrl: string;
}

export interface MatchResult {
  record: RawPlayerRecord;
  rowIndex: number;
  status: ImageStatus;
  /** A locally-uploaded file: either matched by filename/player_id, or a manual per-row override. */
  matchedAsset?: ImageAsset;
  matchReason: "player_id" | "filename" | "manual_override" | "none";
  isDuplicate: boolean;
  duplicateKey?: string;
  validationErrors: string[];
}

export interface ImportSummary {
  total: number;
  matched: number;
  missing: number;
  needsReview: number;
  duplicates: number;
  invalid: number;
}
