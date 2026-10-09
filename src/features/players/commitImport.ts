import { supabase } from "@/lib/supabase";
import type { MatchResult } from "@/types";
import { assignAuctionSet } from "@/features/auction/auctionSets";

const BATCH_SIZE = 500;
const UPLOAD_CONCURRENCY = 6;
const UPLOAD_RETRIES = 2; // extra attempts after the first, for transient storage/auth hiccups
const RETRY_DELAY_MS = 400;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CommitProgress {
  phase: "uploading_images" | "saving_players" | "done";
  completed: number;
  total: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Simple bounded-concurrency pool so 10,000 image uploads don't fire all at once. */
async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, concurrency: number, onProgress?: (done: number) => void) {
  let cursor = 0;
  let done = 0;
  async function next(): Promise<void> {
    const i = cursor++;
    if (i >= items.length) return;
    await worker(items[i]);
    done += 1;
    onProgress?.(done);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

/**
 * Uploads matched images to the `player-images` bucket and upserts every player
 * row (matched, missing, or needs_review — missing images never block the import).
 */
export async function commitImport(
  results: MatchResult[],
  importBatchId: string,
  onProgress?: (progress: CommitProgress) => void
): Promise<{ inserted: number; failed: { row: number; message: string }[] }> {
  const failed: { row: number; message: string }[] = [];

  // Make sure the client has a fully-loaded (and, if needed, refreshed) auth session
  // before firing off a burst of concurrent storage requests — otherwise the very
  // first wave of uploads can race ahead of session restoration and get rejected by
  // the storage RLS policy before the operator's auth token is attached.
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error("Not signed in — reload the page and try again.");

  // 1. Upload images for anything with a matched local asset.
  const toUpload = results.filter((r) => r.status === "matched" && r.matchedAsset);
  const uploadedUrls = new Map<number, string>(); // rowIndex -> public URL

  await runPool(
    toUpload,
    async (r) => {
      const asset = r.matchedAsset!;
      // rowIndex is folded into the path so two rows that share (or are both missing)
      // a player_id can never collide on the same storage object.
      // Images live in this visitor's own folder (storage rules only allow writes there).
      const path = `${uid}/${importBatchId}/${normalizedFileName(r.rowIndex, r.record.player_id, asset.fileName)}`;

      let lastError: string | null = null;
      for (let attempt = 0; attempt <= UPLOAD_RETRIES; attempt++) {
        if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);
        const { error } = await supabase.storage.from("player-images").upload(path, asset.file, {
          upsert: true,
          contentType: asset.file.type || "image/jpeg",
        });
        if (!error) {
          const { data } = supabase.storage.from("player-images").getPublicUrl(path);
          uploadedUrls.set(r.rowIndex, data.publicUrl);
          lastError = null;
          break;
        }
        lastError = error.message;
      }
      if (lastError) {
        failed.push({ row: r.rowIndex, message: `Image upload failed: ${lastError}` });
      }
    },
    UPLOAD_CONCURRENCY,
    (done) => onProgress?.({ phase: "uploading_images", completed: done, total: toUpload.length })
  );

  // 2. Build player rows for upsert.
  const rows = results.map((r) => {
    const rawUrl = (r.record.image_url as string | undefined)?.trim();
    // Priority: dataset-declared URL > uploaded/overridden file (just hosted above).
    const imageUrl = rawUrl || uploadedUrls.get(r.rowIndex) || null;
    const country = r.record.country ? String(r.record.country) : null;
    const role = r.record.role ? String(r.record.role) : null;
    const category = r.record.category ? String(r.record.category) : null;
    const bowlingStyle = r.record.bowling_style ? String(r.record.bowling_style) : null;
    const isMarquee = r.record.is_marquee === true;

    // Every player is placed into its Mega Auction set (M1/M2 → capped BA/AR/WK/FA/SP →
    // uncapped UBA/UAR/UWK/UFA/USP) right here at import time, using the single fixed
    // sequence defined in auctionSets.ts — never re-derived or hard-coded elsewhere.
    const assignment = assignAuctionSet({
      role,
      bowlingStyle,
      category,
      country,
      isMarquee,
    });

    return {
      owner_id: uid,
      external_player_id: String(r.record.player_id),
      name: String(r.record.name),
      country,
      country_code: r.record.country_code ? String(r.record.country_code) : null,
      role,
      category,
      base_price: Number(r.record.base_price) || 0,
      age: r.record.age ? Number(r.record.age) : null,
      batting_style: r.record.batting_style ? String(r.record.batting_style) : null,
      bowling_style: bowlingStyle,
      stats: typeof r.record.stats === "object" ? r.record.stats ?? {} : {},
      image_filename: r.matchedAsset?.fileName ?? (r.record.image_filename as string | undefined) ?? null,
      image_url: imageUrl,
      image_status: imageUrl ? "matched" : r.status,
      is_duplicate: r.isDuplicate,
      import_batch_id: importBatchId,
      discipline: assignment.discipline,
      capped_status: assignment.cappedStatus,
      is_marquee: isMarquee,
      set_code: assignment.setCode,
      set_order: assignment.setOrder,
    };
  });

  // 3. Upsert in batches on external_player_id (never hard-coded — always from the dataset).
  let inserted = 0;
  const batches = chunk(rows, BATCH_SIZE);
  for (let b = 0; b < batches.length; b++) {
    const { error } = await supabase
      .from("players")
      .upsert(batches[b], { onConflict: "owner_id,external_player_id" });
    if (error) {
      batches[b].forEach((_, i) => failed.push({ row: b * BATCH_SIZE + i, message: error.message }));
    } else {
      inserted += batches[b].length;
    }
    onProgress?.({ phase: "saving_players", completed: (b + 1) * BATCH_SIZE, total: rows.length });
  }

  onProgress?.({ phase: "done", completed: rows.length, total: rows.length });
  return { inserted, failed };
}

function normalizedFileName(rowIndex: number, playerId: unknown, originalName: string): string {
  const ext = originalName.split(".").pop() || "jpg";
  const rawId = String(playerId ?? "").trim();
  const safeId = rawId ? rawId.replace(/[^a-zA-Z0-9_-]/g, "_") : "player";
  return `${safeId}_${rowIndex}.${ext}`;
}
