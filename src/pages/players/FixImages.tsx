import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Pencil, ImageIcon, UploadCloud } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toImageAsset } from "@/features/players/imageMatching";
import {
  fetchPlayersMissingImages,
  matchImagesToMissingPlayers,
  overrideFixMatch,
  commitImageFixes,
  type FixMatch,
  type FixProgress,
} from "@/features/players/fixMissingImages";
import type { ImageAsset, PlayerRow } from "@/types";
import { cn } from "@/lib/utils";

type Step = "loading" | "upload" | "review" | "saving" | "done";

export default function FixMissingImagesPage() {
  const [step, setStep] = useState<Step>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [results, setResults] = useState<FixMatch[]>([]);
  const [filter, setFilter] = useState<"all" | "matched" | "unmatched">("all");
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState<FixProgress | null>(null);
  const [outcome, setOutcome] = useState<{ updated: number; failed: { name: string; message: string }[] } | null>(null);

  const loadMissing = useCallback(async () => {
    setStep("loading");
    setLoadError(null);
    try {
      const missing = await fetchPlayersMissingImages();
      setPlayers(missing);
      setStep("upload");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load players");
      setStep("upload");
    }
  }, []);

  useEffect(() => {
    loadMissing();
  }, [loadMissing]);

  const handleImageFiles = useCallback((files: FileList) => {
    const newAssets = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map(toImageAsset);
    setAssets((prev) => [...prev, ...newAssets]);
  }, []);

  const runMatching = useCallback(() => {
    setResults(matchImagesToMissingPlayers(players, assets));
    setStep("review");
  }, [players, assets]);

  const overrideRow = useCallback((rowIndex: number, file: File) => {
    const asset = toImageAsset(file);
    setAssets((prev) => [...prev, asset]);
    setResults((prev) => overrideFixMatch(prev, rowIndex, asset));
  }, []);

  const matchedCount = useMemo(() => results.filter((r) => r.status === "matched").length, [results]);
  const unmatchedCount = results.length - matchedCount;

  // Uploaded images that matched no player — handy for spotting misspelt filenames.
  const unusedAssets = useMemo(() => {
    const used = new Set(results.map((r) => r.matchedAsset?.objectUrl).filter(Boolean));
    return assets.filter((a) => !used.has(a.objectUrl));
  }, [results, assets]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return results.filter((r) => {
      if (filter === "matched" && r.status !== "matched") return false;
      if (filter === "unmatched" && r.status === "matched") return false;
      if (q && !r.player.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [results, filter, search]);

  const save = useCallback(async () => {
    setStep("saving");
    const res = await commitImageFixes(results, setProgress);
    setOutcome(res);
    setStep("done");
  }, [results]);

  const reset = useCallback(() => {
    setAssets([]);
    setResults([]);
    setProgress(null);
    setOutcome(null);
    setFilter("all");
    setSearch("");
    loadMissing();
  }, [loadMissing]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-wide text-lagoon/70">Players</p>
        <h1 className="mt-1 font-display text-3xl text-parchment">Fix missing photos</h1>
        <p className="mt-2 max-w-2xl text-sm text-parchment/60">
          Upload only the photos for players who are still missing one. They are matched against the players
          already saved, and only those players are updated — everyone who already has a photo stays exactly as is.
        </p>
      </header>

      {step === "loading" && (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-parchment/70">
            <Loader2 className="h-4 w-4 animate-spin text-lagoon" /> Loading players without photos…
          </CardContent>
        </Card>
      )}

      {step === "upload" && (
        <div className="space-y-6">
          {loadError && (
            <Card className="border-coral/40">
              <CardContent className="py-4 text-sm text-coral">{loadError}</CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="flex flex-col items-start gap-1 py-5">
              <p className="font-display text-2xl text-brass-bright">{players.length}</p>
              <p className="text-sm text-parchment/70">
                saved player(s) are currently missing a photo.
              </p>
            </CardContent>
          </Card>

          {players.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Players missing a photo</CardTitle>
                <CardDescription className="text-xs">
                  Name each photo file after the player (or their player_id) so it can be matched.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="grid max-h-72 gap-x-6 gap-y-1 overflow-y-auto text-sm sm:grid-cols-2 lg:grid-cols-3">
                  {players.map((p) => (
                    <li key={p.id} className="flex items-baseline justify-between gap-2 border-b border-wood-light/10 py-1.5">
                      <span className="truncate text-parchment">{p.name}</span>
                      <span className="shrink-0 text-[11px] text-parchment/40">
                        {[p.role, p.country].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {players.length > 0 && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <ImageIcon className="h-8 w-8 text-brass" strokeWidth={1.5} />
                <div>
                  <p className="font-display text-base text-parchment">Photos for the missing players</p>
                  <p className="mt-1 text-xs text-parchment/60">
                    Name each file by player_id or player name (same rules as the main import). You can also
                    fix any player by hand in the next step.
                  </p>
                </div>
                <label>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => e.target.files && handleImageFiles(e.target.files)}
                  />
                  <span className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-wood-light/40 px-4 py-2 text-sm text-parchment hover:bg-cove">
                    <UploadCloud className="h-4 w-4" /> Choose files
                  </span>
                </label>
                {assets.length > 0 && <p className="text-xs text-lagoon-bright">{assets.length} images loaded</p>}
              </CardContent>
            </Card>
          )}

          {players.length === 0 && !loadError && (
            <Card className="border-lagoon/40">
              <CardContent className="flex items-center gap-2 py-6 text-sm text-lagoon-bright">
                <CheckCircle2 className="h-5 w-5" /> Every saved player already has a photo.
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button size="lg" disabled={players.length === 0} onClick={runMatching}>
              Match photos &amp; review →
            </Button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <Tile label="Missing players" value={results.length} active={filter === "all"} onClick={() => setFilter("all")} />
            <Tile label="Matched now" value={matchedCount} tone="text-lagoon-bright" active={filter === "matched"} onClick={() => setFilter("matched")} />
            <Tile label="Still unmatched" value={unmatchedCount} tone="text-coral" active={filter === "unmatched"} onClick={() => setFilter("unmatched")} />
          </div>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player name…"
            className="h-10 w-full rounded-md border border-wood-light/40 bg-transparent px-3 text-sm text-parchment placeholder:text-parchment/40 sm:max-w-xs"
          />

          {unusedAssets.length > 0 && (
            <Card className="border-brass/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm text-brass-bright">
                  <AlertTriangle className="h-4 w-4" /> {unusedAssets.length} uploaded image(s) matched no player
                </CardTitle>
                <CardDescription className="max-h-20 overflow-y-auto text-xs">
                  {unusedAssets.map((a) => a.fileName).join(", ")}
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          <Card>
            <CardContent className="p-0">
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="sticky top-0 bg-deep text-parchment/60">
                    <tr>
                      <th className="px-4 py-3 font-medium">Photo</th>
                      <th className="px-4 py-3 font-medium">Player</th>
                      <th className="px-4 py-3 font-medium">Country</th>
                      <th className="px-4 py-3 font-medium">Role</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.rowIndex} className="border-t border-wood-light/10">
                        <td className="px-4 py-2">
                          <div className="group relative h-10 w-10">
                            <div className="h-10 w-10 overflow-hidden rounded-full border border-wood-light/30 bg-cove">
                              {r.matchedAsset ? (
                                <img src={r.matchedAsset.objectUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[10px] text-parchment/40">
                                  N/A
                                </div>
                              )}
                            </div>
                            <label
                              className="absolute -bottom-1 -right-1 flex cursor-pointer items-center justify-center rounded-full border border-cove bg-deep p-0.5 opacity-70 transition-opacity group-hover:opacity-100"
                              title="Pick a photo for this player"
                            >
                              <Pencil className="h-3 w-3 text-parchment" />
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) overrideRow(r.rowIndex, file);
                                }}
                              />
                            </label>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-parchment">{r.player.name}</td>
                        <td className="px-4 py-2 text-parchment/70">{r.player.country ?? "—"}</td>
                        <td className="px-4 py-2 text-parchment/70">{r.player.role ?? "—"}</td>
                        <td className="px-4 py-2">
                          {r.status === "matched" ? (
                            <Badge variant="matched">
                              <CheckCircle2 className="mr-1 h-3 w-3" /> Matched
                            </Badge>
                          ) : r.status === "needs_review" ? (
                            <Badge variant="needs_review">
                              <AlertTriangle className="mr-1 h-3 w-3" /> Needs review
                            </Badge>
                          ) : (
                            <Badge variant="missing">
                              <XCircle className="mr-1 h-3 w-3" /> Still missing
                            </Badge>
                          )}
                          {r.validationErrors.length > 0 && r.status === "needs_review" && (
                            <p className="mt-1 text-[11px] text-coral/80">{r.validationErrors[r.validationErrors.length - 1]}</p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="outline" onClick={() => setStep("upload")} className="w-full sm:w-auto">
              ← Back
            </Button>
            <Button size="lg" disabled={matchedCount === 0} onClick={save} className="w-full sm:w-auto">
              Save {matchedCount} photo{matchedCount === 1 ? "" : "s"} →
            </Button>
          </div>
        </div>
      )}

      {step === "saving" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-lagoon" /> Saving photos…
            </CardTitle>
            <CardDescription>
              {progress?.completed ?? 0} / {progress?.total ?? matchedCount}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={progress && progress.total ? (progress.completed / progress.total) * 100 : 0} />
          </CardContent>
        </Card>
      )}

      {step === "done" && outcome && (
        <Card className="border-lagoon/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lagoon-bright">
              <CheckCircle2 className="h-5 w-5" /> Photos saved
            </CardTitle>
            <CardDescription>
              {outcome.updated} player(s) updated.
              {outcome.failed.length > 0 && ` ${outcome.failed.length} failed — see below.`}
            </CardDescription>
          </CardHeader>
          {outcome.failed.length > 0 && (
            <CardContent className="max-h-40 overflow-y-auto text-sm text-coral/80">
              {outcome.failed.slice(0, 20).map((f, i) => (
                <p key={i}>
                  {f.name}: {f.message}
                </p>
              ))}
            </CardContent>
          )}
          <CardContent className={cn("flex flex-col gap-3 pt-0 sm:flex-row")}>
            <Button variant="outline" onClick={reset}>
              Add more missing photos
            </Button>
            <Button asChild>
              <a href="/players">Go to Players →</a>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn("plank-panel rounded-lg px-4 py-3 text-left transition-shadow", active && "ring-2 ring-lagoon/60")}
    >
      <p className="text-[11px] uppercase tracking-wide text-parchment/50">{label}</p>
      <p className={cn("mt-1 font-display text-2xl", tone ?? "text-parchment")}>{value}</p>
    </button>
  );
}
