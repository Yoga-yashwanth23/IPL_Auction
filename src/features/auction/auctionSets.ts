/**
 * Auction set sequencing — Mega Auction format.
 *
 * Fixed running order:
 *   1. Marquee Set 1 (M1) — marquee Indian players
 *   2. Marquee Set 2 (M2) — marquee overseas players
 *   3. Capped Batters (BA)
 *   4. Capped All-Rounders (AR)
 *   5. Capped Wicketkeepers (WK)
 *   6. Capped Fast Bowlers (FA)
 *   7. Capped Spin Bowlers (SP)
 *   8. Uncapped Batters (UBA)
 *   9. Uncapped All-Rounders (UAR)
 *  10. Uncapped Wicketkeepers (UWK)
 *  11. Uncapped Fast Bowlers (UFA)
 *  12. Uncapped Spin Bowlers (USP)
 *
 * This is the only place the sequence is defined — the import pipeline (commitImport.ts)
 * and any auction-setup screen should both read from here rather than re-deriving it.
 */

export type Discipline = "BA" | "AR" | "WK" | "FA" | "SP";
export type CappedStatus = "Capped" | "Uncapped";
export type SetCode = "M1" | "M2" | "BA" | "AR" | "WK" | "FA" | "SP" | "UBA" | "UAR" | "UWK" | "UFA" | "USP";

export interface AuctionSetDef {
  code: SetCode;
  label: string;
  group: "marquee" | "capped" | "uncapped";
  order: number; // position in the fixed running sequence, 1-based
}

/** The fixed running order of the whole auction. Do not reorder without re-numbering `order`. */
export const AUCTION_SET_SEQUENCE: AuctionSetDef[] = [
  { code: "M1", label: "Marquee Set 1", group: "marquee", order: 1 },
  { code: "M2", label: "Marquee Set 2", group: "marquee", order: 2 },
  { code: "BA", label: "Capped Batters", group: "capped", order: 3 },
  { code: "AR", label: "Capped All-Rounders", group: "capped", order: 4 },
  { code: "WK", label: "Capped Wicketkeepers", group: "capped", order: 5 },
  { code: "FA", label: "Capped Fast Bowlers", group: "capped", order: 6 },
  { code: "SP", label: "Capped Spin Bowlers", group: "capped", order: 7 },
  { code: "UBA", label: "Uncapped Batters", group: "uncapped", order: 8 },
  { code: "UAR", label: "Uncapped All-Rounders", group: "uncapped", order: 9 },
  { code: "UWK", label: "Uncapped Wicketkeepers", group: "uncapped", order: 10 },
  { code: "UFA", label: "Uncapped Fast Bowlers", group: "uncapped", order: 11 },
  { code: "USP", label: "Uncapped Spin Bowlers", group: "uncapped", order: 12 },
];

const SET_BY_CODE = new Map(AUCTION_SET_SEQUENCE.map((s) => [s.code, s]));

export function getSetDef(code: string | null | undefined): AuctionSetDef | undefined {
  if (!code) return undefined;
  return SET_BY_CODE.get(code as SetCode);
}

/** Batter / All-Rounder / Wicketkeeper pass straight through; Bowler splits into FA vs SP by bowling_style. */
export function deriveDiscipline(role: string | null | undefined, bowlingStyle: string | null | undefined): Discipline {
  const r = (role ?? "").trim().toLowerCase();
  if (r === "batter") return "BA";
  if (r === "wicketkeeper") return "WK";
  if (r === "all-rounder" || r === "all rounder" || r === "allrounder") return "AR";
  if (r === "bowler") {
    const bs = (bowlingStyle ?? "").toLowerCase();
    return bs.includes("spin") ? "SP" : "FA";
  }
  // Unknown/blank role: default to Batter rather than silently dropping the player from a set.
  return "BA";
}

/**
 * Capped/Uncapped from the dataset's `category` column. A blank category is treated as
 * Capped (rows in the source dataset with a blank category were all current internationals
 * for associate nations) — review this default if your dataset's blanks mean something else.
 */
export function deriveCappedStatus(category: string | null | undefined): CappedStatus {
  const c = (category ?? "").trim().toLowerCase();
  if (c === "uncapped") return "Uncapped";
  return "Capped";
}

/**
 * Marquee status is a human auction-committee call, not something derivable from stats —
 * it is never inferred here. Callers pass whatever the dataset/operator has explicitly flagged.
 */
export function deriveSetCode(
  discipline: Discipline,
  capped: CappedStatus,
  isMarquee: boolean,
  country: string | null | undefined
): SetCode {
  if (isMarquee) {
    return (country ?? "").trim().toLowerCase() === "india" ? "M1" : "M2";
  }
  return capped === "Capped" ? discipline : (("U" + discipline) as SetCode);
}

export interface AuctionSetAssignment {
  discipline: Discipline;
  cappedStatus: CappedStatus;
  setCode: SetCode;
  setLabel: string;
  setOrder: number;
}

/** Full derivation in one call — this is what commitImport.ts uses per player row. */
export function assignAuctionSet(input: {
  role: string | null | undefined;
  bowlingStyle: string | null | undefined;
  category: string | null | undefined;
  country: string | null | undefined;
  isMarquee: boolean;
}): AuctionSetAssignment {
  const discipline = deriveDiscipline(input.role, input.bowlingStyle);
  const cappedStatus = deriveCappedStatus(input.category);
  const setCode = deriveSetCode(discipline, cappedStatus, input.isMarquee, input.country);
  const def = getSetDef(setCode)!;
  return { discipline, cappedStatus, setCode, setLabel: def.label, setOrder: def.order };
}

/** Sorts players into full auction running order: by set sequence, then base_price desc, then name asc. */
export function sortByAuctionOrder<T extends { set_order: number | null; base_price: number; name: string }>(
  players: T[]
): T[] {
  return [...players].sort((a, b) => {
    const orderA = a.set_order ?? 999;
    const orderB = b.set_order ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    if (b.base_price !== a.base_price) return b.base_price - a.base_price;
    return a.name.localeCompare(b.name);
  });
}
