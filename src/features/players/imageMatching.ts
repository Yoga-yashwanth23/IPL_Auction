import { normalizeKey } from "@/lib/utils";
import type { ImageAsset, MatchResult, RawPlayerRecord, ImportSummary } from "@/types";

const REQUIRED_FIELDS: (keyof RawPlayerRecord)[] = ["player_id", "name", "base_price"];

/** Build normalized-filename -> asset lookup, keeping every asset that shares a key (for review). */
function buildImageIndex(assets: ImageAsset[]): Map<string, ImageAsset[]> {
  const index = new Map<string, ImageAsset[]>();
  for (const asset of assets) {
    const key = asset.normalizedKey;
    const bucket = index.get(key) ?? [];
    bucket.push(asset);
    index.set(key, bucket);
  }
  return index;
}

export function toImageAsset(file: File): ImageAsset {
  return {
    fileName: file.name,
    normalizedKey: normalizeKey(file.name),
    file,
    objectUrl: URL.createObjectURL(file),
  };
}

/**
 * Matches every dataset record to a manually-uploaded image by normalized filename.
 * Priority: (1) exact player_id === normalized image filename,
 *           (2) record's declared image_filename, normalized,
 *           (3) normalized player name as a last-resort fallback.
 * A key that maps to more than one uploaded file is flagged NEEDS_REVIEW rather
 * than guessed — a player must never end up wearing another player's photo.
 */
export function matchPlayerImages(records: RawPlayerRecord[], assets: ImageAsset[]): MatchResult[] {
  const imageIndex = buildImageIndex(assets);

  // Duplicate detection across the dataset itself, by normalized player_id.
  const idCounts = new Map<string, number>();
  for (const r of records) {
    const key = normalizeKey(String(r.player_id ?? ""));
    if (!key) continue;
    idCounts.set(key, (idCounts.get(key) ?? 0) + 1);
  }

  return records.map((record, rowIndex) => {
    const validationErrors: string[] = [];
    for (const field of REQUIRED_FIELDS) {
      if (record[field] === undefined || record[field] === null || record[field] === "") {
        validationErrors.push(`Missing "${field}"`);
      }
    }

    const idKey = normalizeKey(String(record.player_id ?? ""));
    const declaredFilenameKey = record.image_filename ? normalizeKey(String(record.image_filename)) : null;
    const nameKey = record.name ? normalizeKey(String(record.name)) : null;

    const isDuplicate = idKey ? (idCounts.get(idKey) ?? 0) > 1 : false;

    // If the dataset already supplies a hosted image_url, trust it directly.
    if (record.image_url && String(record.image_url).trim() !== "") {
      return {
        record,
        rowIndex,
        status: "matched" as const,
        matchReason: "player_id" as const,
        isDuplicate,
        duplicateKey: isDuplicate ? idKey : undefined,
        validationErrors,
      };
    }

    const tryKeys: { key: string | null; reason: MatchResult["matchReason"] }[] = [
      { key: idKey, reason: "player_id" },
      { key: declaredFilenameKey, reason: "filename" },
      { key: nameKey, reason: "filename" },
    ];

    for (const { key, reason } of tryKeys) {
      if (!key) continue;
      const candidates = imageIndex.get(key);
      if (!candidates || candidates.length === 0) continue;

      if (candidates.length > 1) {
        return {
          record,
          rowIndex,
          status: "needs_review" as const,
          matchReason: reason,
          isDuplicate,
          duplicateKey: isDuplicate ? idKey : undefined,
          validationErrors: [...validationErrors, `Multiple images match key "${key}" — pick one manually`],
        };
      }

      return {
        record,
        rowIndex,
        status: "matched" as const,
        matchedAsset: candidates[0],
        matchReason: reason,
        isDuplicate,
        duplicateKey: isDuplicate ? idKey : undefined,
        validationErrors,
      };
    }

    return {
      record,
      rowIndex,
      status: "missing" as const,
      matchReason: "none" as const,
      isDuplicate,
      duplicateKey: isDuplicate ? idKey : undefined,
      validationErrors,
    };
  });
}

/**
 * Lets a reviewer override a single row's photo by hand — used in the review table
 * when a player is missing a photo or was matched to the wrong one. A manual
 * override always wins over the local filename match.
 */
export function applyManualImageOverride(results: MatchResult[], rowIndex: number, asset: ImageAsset): MatchResult[] {
  return results.map((r) =>
    r.rowIndex === rowIndex
      ? { ...r, status: "matched" as const, matchReason: "manual_override" as const, matchedAsset: asset }
      : r
  );
}

export function summarizeMatches(results: MatchResult[]): ImportSummary {
  return {
    total: results.length,
    matched: results.filter((r) => r.status === "matched").length,
    missing: results.filter((r) => r.status === "missing").length,
    needsReview: results.filter((r) => r.status === "needs_review").length,
    duplicates: results.filter((r) => r.isDuplicate).length,
    invalid: results.filter((r) => r.validationErrors.length > 0).length,
  };
}
