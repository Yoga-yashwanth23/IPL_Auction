import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, Download, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn, formatCr } from "@/lib/utils";
import { fetchVenueAuction, useVenueKey } from "@/lib/venue";

interface HistoryRow {
  id: string;
  playerName: string;
  setCode: string | null;
  country: string | null;
  role: string | null;
  status: "sold" | "unsold";
  teamName: string | null;
  teamCode: string | null;
  price: number | null;
  at: string;
}

type Filter = "all" | "sold" | "unsold";

function toCsv(rows: HistoryRow[]): string {
  const header = ["Player", "Set", "Country", "Role", "Result", "Team", "Price", "Timestamp"];
  const lines = rows.map((r) =>
    [
      r.playerName,
      r.setCode ?? "",
      r.country ?? "",
      r.role ?? "",
      r.status,
      r.teamName ?? "",
      r.price ?? "",
      new Date(r.at).toISOString(),
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

export default function HistoryPage() {
  const venue = useVenueKey();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: auctionRow } = await fetchVenueAuction(venue);

    if (!auctionRow) {
      setLoading(false);
      return;
    }

    const [{ data: sold, error: soldError }, { data: unsold, error: unsoldError }] = await Promise.all([
      supabase
        .from("purchases")
        .select("id, price, created_at, player:players(name, set_code, country, role), team:teams(name, code)")
        .eq("auction_id", auctionRow.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("auction_players")
        .select("id, updated_at, player:players(name, set_code, country, role)")
        .eq("auction_id", auctionRow.id)
        .eq("status", "unsold")
        .order("updated_at", { ascending: false }),
    ]);

    if (soldError || unsoldError) {
      setError(soldError?.message ?? unsoldError?.message ?? "Could not load history.");
      setLoading(false);
      return;
    }

    const soldRows: HistoryRow[] = (sold ?? []).map((r: any) => ({
      id: `sold-${r.id}`,
      playerName: r.player?.name ?? "—",
      setCode: r.player?.set_code ?? null,
      country: r.player?.country ?? null,
      role: r.player?.role ?? null,
      status: "sold",
      teamName: r.team?.name ?? null,
      teamCode: r.team?.code ?? null,
      price: r.price,
      at: r.created_at,
    }));

    const unsoldRows: HistoryRow[] = (unsold ?? []).map((r: any) => ({
      id: `unsold-${r.id}`,
      playerName: r.player?.name ?? "—",
      setCode: r.player?.set_code ?? null,
      country: r.player?.country ?? null,
      role: r.player?.role ?? null,
      status: "unsold",
      teamName: null,
      teamCode: null,
      price: null,
      at: r.updated_at,
    }));

    const combined = [...soldRows, ...unsoldRows].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    setRows(combined);
    setLoading(false);
  }, [venue]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!q) return true;
      return (
        r.playerName.toLowerCase().includes(q) ||
        (r.teamName ?? "").toLowerCase().includes(q) ||
        (r.teamCode ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, filter, search]);

  const exportCsv = () => {
    const csv = toCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "auction-history.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-lagoon/70">History</p>
          <h1 className="mt-1 font-display text-2xl text-parchment sm:text-3xl">The ship's log</h1>
          <p className="mt-1 text-sm text-parchment/60">Every player called, sold or unsold, in order.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </header>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {(["all", "sold", "unsold"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
                filter === f
                  ? "border-lagoon-bright bg-lagoon/20 text-lagoon-bright"
                  : "border-wood-light/25 bg-deep/40 text-parchment/60 hover:bg-cove"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-parchment/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player or team…"
            className="pl-9"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-coral/40 bg-coral/10 px-4 py-3 text-sm text-coral">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-parchment/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-parchment/50">
            {rows.length === 0 ? "No results yet — nothing has been sold or marked unsold." : "No matches for that search."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="max-h-[600px] overflow-y-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-deep text-parchment/60">
                <tr>
                  <th className="px-4 py-2 font-medium">Player</th>
                  <th className="px-4 py-2 font-medium">Set</th>
                  <th className="px-4 py-2 font-medium">Result</th>
                  <th className="px-4 py-2 font-medium">Team</th>
                  <th className="px-4 py-2 font-medium">Price</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-wood-light/10 hover:bg-cove/40">
                    <td className="px-4 py-2 text-parchment">
                      {r.playerName}
                      <span className="ml-2 text-xs text-parchment/40">
                        {r.country ?? "—"} · {r.role ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-parchment/60">{r.setCode ?? "—"}</td>
                    <td className="px-4 py-2">
                      {r.status === "sold" ? (
                        <Badge variant="matched" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Sold
                        </Badge>
                      ) : (
                        <Badge variant="missing" className="gap-1">
                          <XCircle className="h-3 w-3" /> Unsold
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-parchment/70">{r.teamName ?? "—"}</td>
                    <td className="px-4 py-2 text-parchment/70">{r.price != null ? formatCr(r.price) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
