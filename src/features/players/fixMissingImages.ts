import { supabase } from "@/lib/supabase";
import type { MatchResult, PlayerRow, RawPlayerRecord, ImageAsset } from "@/types";
import { matchPlayerImages } from "@/features/players/imageMatching";

const FETCH_PAGE = 1000; // Supabase returns at most 1000 rows per request
const UPLOAD_CONCURRENCY = 6;
const UPLOAD_RETRIES = 2;
const RETRY_DELAY_MS = 400;

export interface FixProgress {
  completed: number;
  total: number;
}

export interface FixMatch extends MatchResult {
  player: PlayerRow;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Every saved player that still has no photo (image_url empty), across all pages. */
export async function fetchPlayersMissingImages(): Promise<PlayerRow[]> {
  const all: PlayerRow[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .or("image_url.is.null,image_url.eq.")
      .order("name", { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < FETCH_PAGE) break;
  }
  return all;
}

/**
 * Matches only the newly-uploaded photos against players already in the database
 * that are missing one. Reuses the exact same matching rules as the full import
 * (player_id, declared image_filename, then name), so behaviour is identical.
 */
export function matchImagesToMissingPlayers(players: PlayerRow[], assets: ImageAsset[]): FixMatch[] {
  const records: RawPlayerRecord[] = players.map((p) => ({
    player_id: p.external_player_id,
    name: p.name,
    image_filename: p.image_filename ?? undefined,
    base_price: p.base_price,
  }));
  return matchPlayerImages(records, assets).map((r) => ({ ...r, player: players[r.rowIndex] }));
}

/** Manual override for one player (when a filename just doesn't match the name). */
export function overrideFixMatch(results: FixMatch[], rowIndex: number, asset: ImageAsset): FixMatch[] {
  return results.map((r) =>
    r.rowIndex === rowIndex
      ? { ...r, status: "matched" as const, matchReason: "manual_override" as const, matchedAsset: asset }
      : r
  );
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, concurrency: number, onDone?: (n: number) => void) {
  let cursor = 0;
  let done = 0;
  async function next(): Promise<void> {
    const i = cursor++;
    if (i >= items.length) return;
    await worker(items[i]);
    done += 1;
    onDone?.(done);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

/**
 * Uploads each matched photo and updates ONLY that player's image columns.
 * Players that already have photos — and all other player data (sets, prices,
 * stats) — are never touched, so the saved list simply gains the missing images.
 */
export async function commitImageFixes(
  results: FixMatch[],
  onProgress?: (p: FixProgress) => void
): Promise<{ updated: number; failed: { name: string; message: string }[] }> {
  await supabase.auth.getSession();

  const toSave = results.filter((r) => r.status === "matched" && r.matchedAsset);
  const failed: { name: string; message: string }[] = [];
  let updated = 0;

  await runPool(
    toSave,
    async (r) => {
      const asset = r.matchedAsset!;
      const ext = asset.fileName.split(".").pop() || "jpg";
      // Player's own uuid + timestamp: unique path, and no stale browser cache of an old image.
      const path = `fixes/${r.player.id}_${Date.now()}.${ext}`;

      let lastError: string | null = null;
      for (let attempt = 0; attempt <= UPLOAD_RETRIES; attempt++) {
        if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);
        const { error: upErr } = await supabase.storage.from("player-images").upload(path, asset.file, {
          upsert: true,
          contentType: asset.file.type || "image/jpeg",
        });
        if (upErr) {
          lastError = `Image upload failed: ${upErr.message}`;
          continue;
        }
        const { data } = supabase.storage.from("player-images").getPublicUrl(path);
        const { error: dbErr } = await supabase
          .from("players")
          .update({
            image_url: data.publicUrl,
            image_filename: asset.fileName,
            image_status: "matched",
          })
          .eq("id", r.player.id);
        if (dbErr) {
          lastError = `Saving failed: ${dbErr.message}`;
          continue;
        }
        lastError = null;
        updated += 1;
        break;
      }
      if (lastError) failed.push({ name: r.player.name, message: lastError });
    },
    UPLOAD_CONCURRENCY,
    (done) => onProgress?.({ completed: done, total: toSave.length })
  );

  return { updated, failed };
}
