import { useCallback, useMemo, useState } from "react";
import { UploadCloud, FileSpreadsheet, ImageIcon, CheckCircle2, AlertTriangle, XCircle, Loader2, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { parseDatasetFile } from "@/features/players/parseDataset";
import {
  matchPlayerImages,
  applyManualImageOverride,
  summarizeMatches,
  toImageAsset,
} from "@/features/players/imageMatching";
import { commitImport, type CommitProgress } from "@/features/players/commitImport";
import { assignAuctionSet } from "@/features/auction/auctionSets";
import type { ImageAsset, MatchResult, RawPlayerRecord } from "@/types";
import { cn, formatCr } from "@/lib/utils";

type Step = "upload" | "review" | "importing" | "done";

export default function PlayersImportPage() {
  const [step, setStep] = useState<Step>("upload");
  const [records, setRecords] = useState<RawPlayerRecord[]>([]);
  const [parseErrors, setParseErrors] = useState<{ rowIndex: number; message: string }[]>([]);
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [results, setResults] = useState<MatchResult[]>([]);
  const [filter, setFilter] = useState<"all" | "matched" | "missing" | "needs_review">("all");
  const [progress, setProgress] = useState<CommitProgress | null>(null);
  const [commitErrors, setCommitErrors] = useState<{ row: number; message: string }[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const summary = useMemo(() => summarizeMatches(results), [results]);
  const uniqueFailedRows = useMemo(() => new Set(commitErrors.map((e) => e.row)), [commitErrors]);

  const handleDatasetFile = useCallback(async (file: File) => {
    const parsed = await parseDatasetFile(file);
    setRecords(parsed.records);
    setParseErrors(parsed.errors);
  }, []);

  const handleImageFiles = useCallback((files: FileList) => {
    const newAssets = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map(toImageAsset);
    setAssets((prev) => [...prev, ...newAssets]);
  }, []);

  const runMatching = useCallback(() => {
    // Match every dataset record against the manually-uploaded photo folder.
    const matched = matchPlayerImages(records, assets);
    setResults(matched);
    setStep("review");
  }, [records, assets]);

  const overrideRowImage = useCallback((rowIndex: number, file: File) => {
    const asset = toImageAsset(file);
    setAssets((prev) => [...prev, asset]);
    setResults((prev) => applyManualImageOverride(prev, rowIndex, asset));
  }, []);

  const runImport = useCallback(async () => {
    setStep("importing");
    const id = crypto.randomUUID();
    setBatchId(id);
    const { failed } = await commitImport(results, id, setProgress);
    setCommitErrors(failed);
    setStep("done");
  }, [results]);

  const retryFailedRows = useCallback(async () => {
    if (!batchId || commitErrors.length === 0) return;
    setRetrying(true);
    const failedRowIndices = new Set(commitErrors.map((e) => e.row));
    const rowsToRetry = results.filter((r) => failedRowIndices.has(r.rowIndex));
    const { failed } = await commitImport(rowsToRetry, batchId, setProgress);
    // Drop every prior error for a retried row and replace with this attempt's outcome
    // (empty if it now succeeded).
    setCommitErrors((prev) => [...prev.filter((e) => !failedRowIndices.has(e.row)), ...failed]);
    setProgress(null);
    setRetrying(false);
  }, [batchId, commitErrors, results]);

  const visibleResults = useMemo(
    () => (filter === "all" ? results : results.filter((r) => r.status === filter)),
    [results, filter]
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-wide text-lagoon/70">Players</p>
        <h1 className="mt-1 font-display text-3xl text-parchment">Import dataset &amp; charts</h1>
        <p className="mt-2 max-w-2xl text-sm text-parchment/60">
          Bring aboard the player manifest (CSV, Excel, or JSON), then upload the matching photo folder —
          the platform matches each image to its player by filename. Every player is matched to their photo
          before the auction sets sail — nothing here is ever hard-coded.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <a href="/players/fix-images">Already imported? Add only the missing photos →</a>
        </Button>
      </header>

      <StepBar step={step} />

      {step === "upload" && (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <UploadCard
            icon={FileSpreadsheet}
            title="1. Player dataset"
            description="CSV, XLSX, or JSON — needs player_id, name, country, role, base_price (in ₹ Lakh, e.g. 50 = ₹50 L, 200 = ₹2 Cr). Add an is_marquee column (TRUE/FALSE) to flag Marquee Set players."
            accept=".csv,.xlsx,.xls,.json"
            onFiles={(files) => handleDatasetFile(files[0])}
            status={records.length > 0 ? `${records.length} rows loaded` : undefined}
          />
          <UploadCard
            icon={ImageIcon}
            title="2. Player photos"
            description="Upload the player photo folder — each image is matched to its player by player_id, declared image_filename, or name (normalized against the filename)."
            accept="image/*"
            multiple
            onFiles={handleImageFiles}
            status={assets.length > 0 ? `${assets.length} images loaded` : undefined}
          />

          {parseErrors.length > 0 && (
            <Card className="md:col-span-2 border-coral/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-coral">
                  <AlertTriangle className="h-4 w-4" /> {parseErrors.length} issue(s) in the dataset file
                </CardTitle>
              </CardHeader>
              <CardContent className="max-h-40 overflow-y-auto text-sm text-parchment/70">
                {parseErrors.slice(0, 20).map((e, i) => (
                  <p key={i}>
                    Row {e.rowIndex + 1}: {e.message}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="md:col-span-2 flex justify-end">
            <Button size="lg" disabled={records.length === 0} onClick={runMatching}>
              Match photos &amp; review →
            </Button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="mt-8 space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <SummaryTile label="Total" value={summary.total} onClick={() => setFilter("all")} active={filter === "all"} />
            <SummaryTile
              label="Matched"
              value={summary.matched}
              tone="matched"
              onClick={() => setFilter("matched")}
              active={filter === "matched"}
            />
            <SummaryTile
              label="Missing"
              value={summary.missing}
              tone="missing"
              onClick={() => setFilter("missing")}
              active={filter === "missing"}
            />
            <SummaryTile
              label="Needs review"
              value={summary.needsReview}
              tone="needs_review"
              onClick={() => setFilter("needs_review")}
              active={filter === "needs_review"}
            />
            <SummaryTile label="Duplicates" value={summary.duplicates} />
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="sticky top-0 bg-deep text-parchment/60">
                    <tr>
                      <th className="px-4 py-3 font-medium">Photo</th>
                      <th className="px-4 py-3 font-medium">Player</th>
                      <th className="px-4 py-3 font-medium">Country</th>
                      <th className="px-4 py-3 font-medium">Role</th>
                      <th className="px-4 py-3 font-medium">Base price</th>
                      <th className="px-4 py-3 font-medium">Auction set</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleResults.map((r) => {
                      const assignment = assignAuctionSet({
                        role: r.record.role ? String(r.record.role) : null,
                        bowlingStyle: r.record.bowling_style ? String(r.record.bowling_style) : null,
                        category: r.record.category ? String(r.record.category) : null,
                        country: r.record.country ? String(r.record.country) : null,
                        isMarquee: r.record.is_marquee === true,
                      });
                      return (
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
                            <label className="absolute -bottom-1 -right-1 flex cursor-pointer items-center justify-center rounded-full border border-cove bg-deep p-0.5 opacity-70 transition-opacity group-hover:opacity-100" title="Replace photo">
                              <Pencil className="h-3 w-3 text-parchment" />
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) overrideRowImage(r.rowIndex, file);
                                }}
                              />
                            </label>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-parchment">
                          {String(r.record.name)}
                          {r.isDuplicate && (
                            <Badge variant="missing" className="ml-2">
                              duplicate
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2 text-parchment/70">{String(r.record.country ?? "—")}</td>
                        <td className="px-4 py-2 text-parchment/70">{String(r.record.role ?? "—")}</td>
                        <td className="px-4 py-2 text-parchment/70">
                          {formatCr(Number(r.record.base_price) || 0)}
                        </td>
                        <td className="px-4 py-2 text-parchment/70">
                          <Badge variant="matched">{assignment.setCode}</Badge>{" "}
                          <span className="text-xs">{assignment.setLabel}</span>
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={r.status} />
                          {r.status === "matched" && (
                            <p className="mt-1 text-[11px] text-parchment/40">
                              {r.matchReason === "manual_override"
                                ? "manual override"
                                : r.matchReason === "player_id" || r.matchReason === "filename"
                                ? "uploaded photo"
                                : null}
                            </p>
                          )}
                          {r.validationErrors.length > 0 && (
                            <p className="mt-1 text-[11px] text-coral/80">{r.validationErrors[0]}</p>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="outline" onClick={() => setStep("upload")} className="w-full sm:w-auto">
              ← Back
            </Button>
            <Button size="lg" onClick={runImport} className="w-full sm:w-auto">
              Save {summary.total} players to the fleet →
            </Button>
          </div>
        </div>
      )}

      {step === "importing" && progress && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-lagoon" />
              {progress.phase === "uploading_images" ? "Uploading photos to the hold…" : "Saving players to the manifest…"}
            </CardTitle>
            <CardDescription>
              {progress.completed} / {progress.total}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={progress.total ? (progress.completed / progress.total) * 100 : 0} />
          </CardContent>
        </Card>
      )}

      {step === "done" && (
        <Card className="mt-8 border-lagoon/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lagoon-bright">
              <CheckCircle2 className="h-5 w-5" /> Import complete
            </CardTitle>
            <CardDescription>
              {summary.total - uniqueFailedRows.size} of {summary.total} players saved.
              {uniqueFailedRows.size > 0 && ` ${uniqueFailedRows.size} row(s) failed — see below.`}
            </CardDescription>
          </CardHeader>
          {commitErrors.length > 0 && (
            <CardContent className="max-h-40 overflow-y-auto text-sm text-coral/80">
              {commitErrors.slice(0, 20).map((e, i) => (
                <p key={i}>
                  Row {e.row + 1}: {e.message}
                </p>
              ))}
            </CardContent>
          )}
          {retrying && (
            <CardContent className="pt-0">
              <div className="flex items-center gap-2 text-sm text-parchment/60">
                <Loader2 className="h-4 w-4 animate-spin" />
                Retrying {uniqueFailedRows.size} row(s)…
                {progress && progress.total > 0 && ` (${progress.completed}/${progress.total})`}
              </div>
            </CardContent>
          )}
          <CardContent className="flex flex-col gap-3 pt-0 sm:flex-row">
            {commitErrors.length > 0 && (
              <Button variant="outline" onClick={retryFailedRows} disabled={retrying}>
                {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Retry failed rows
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setStep("upload");
                setRecords([]);
                setAssets([]);
                setResults([]);
                setProgress(null);
                setCommitErrors([]);
                setBatchId(null);
              }}
            >
              Import another batch
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

function StepBar({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: "Upload" },
    { key: "review", label: "Verify matching" },
    { key: "importing", label: "Import" },
    { key: "done", label: "Complete" },
  ];
  const currentIndex = steps.findIndex((s) => s.key === step);
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
      <div className="flex w-max items-center gap-2 sm:w-auto">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs",
                i <= currentIndex ? "border-lagoon bg-lagoon/20 text-lagoon-bright" : "border-wood-light/30 text-parchment/40"
              )}
            >
              {i + 1}
            </div>
            <span
              className={cn(
                "whitespace-nowrap text-xs",
                i <= currentIndex ? "text-parchment" : "text-parchment/40"
              )}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="mx-2 h-px w-8 shrink-0 bg-wood-light/20" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function UploadCard({
  icon: Icon,
  title,
  description,
  accept,
  multiple,
  onFiles,
  status,
}: {
  icon: typeof UploadCloud;
  title: string;
  description: string;
  accept: string;
  multiple?: boolean;
  onFiles: (files: FileList) => void;
  status?: string;
}) {
  const [isDragging, setIsDragging] = useState(false);
  return (
    <Card
      className={cn("border-dashed transition-colors", isDragging && "border-lagoon bg-cove/60")}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
      }}
    >
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Icon className="h-8 w-8 text-brass" strokeWidth={1.5} />
        <div>
          <p className="font-display text-base text-parchment">{title}</p>
          <p className="mt-1 text-xs text-parchment/60">{description}</p>
        </div>
        <label>
          <input
            type="file"
            accept={accept}
            multiple={multiple}
            className="hidden"
            onChange={(e) => e.target.files && onFiles(e.target.files)}
          />
          <span className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-wood-light/40 px-4 py-2 text-sm text-parchment hover:bg-cove">
            <UploadCloud className="h-4 w-4" /> Choose {multiple ? "files" : "file"}
          </span>
        </label>
        {status && <p className="text-xs text-lagoon-bright">{status}</p>}
      </CardContent>
    </Card>
  );
}

function SummaryTile({
  label,
  value,
  tone,
  onClick,
  active,
}: {
  label: string;
  value: number;
  tone?: "matched" | "missing" | "needs_review";
  onClick?: () => void;
  active?: boolean;
}) {
  const toneColor =
    tone === "matched" ? "text-lagoon-bright" : tone === "missing" ? "text-coral" : tone === "needs_review" ? "text-brass-bright" : "text-parchment";
  return (
    <button
      onClick={onClick}
      className={cn(
        "plank-panel rounded-lg px-4 py-3 text-left transition-shadow",
        active && "ring-2 ring-lagoon/60"
      )}
    >
      <p className="text-[11px] uppercase tracking-wide text-parchment/50">{label}</p>
      <p className={cn("mt-1 font-display text-2xl", toneColor)}>{value}</p>
    </button>
  );
}

function StatusBadge({ status }: { status: MatchResult["status"] }) {
  if (status === "matched")
    return (
      <Badge variant="matched">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Matched
      </Badge>
    );
  if (status === "needs_review")
    return (
      <Badge variant="needs_review">
        <AlertTriangle className="mr-1 h-3 w-3" /> Needs review
      </Badge>
    );
  return (
    <Badge variant="missing">
      <XCircle className="mr-1 h-3 w-3" /> Missing
    </Badge>
  );
}
