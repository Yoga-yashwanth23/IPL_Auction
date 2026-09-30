import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, TrendingUp, Users, Trophy, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { TeamRow } from "@/types";
import { AUCTION_SET_SEQUENCE } from "@/features/auction/auctionSets";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn, formatCr } from "@/lib/utils";

interface PurchaseRow {
  price: number;
  team_id: string;
  is_overseas: boolean;
  player: { name: string; set_code: string | null } | null;
  team: { name: string; code: string } | null;
}

export default function AnalyticsPage() {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [unsoldCount, setUnsoldCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [setTotals, setSetTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: auctionRow } = await supabase
      .from("auctions")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!auctionRow) {
      setLoading(false);
      return;
    }

    const [{ data: teamRows }, { data: purchaseRows, error: purchaseError }, { count: unsold }, { count: pending }, { data: allSetCodes }] =
      await Promise.all([
        supabase.from("teams").select("*").order("name", { ascending: true }),
        supabase
          .from("purchases")
          .select("price, team_id, is_overseas, player:players(name, set_code), team:teams(name, code)")
          .eq("auction_id", auctionRow.id),
        supabase.from("auction_players").select("*", { count: "exact", head: true }).eq("auction_id", auctionRow.id).eq("status", "unsold"),
        supabase.from("auction_players").select("*", { count: "exact", head: true }).eq("auction_id", auctionRow.id).eq("status", "pending"),
        supabase.from("players").select("set_code"),
      ]);

    if (purchaseError) {
      setError(purchaseError.message);
      setLoading(false);
      return;
    }

    setTeams(teamRows ?? []);
    setPurchases((purchaseRows ?? []) as unknown as PurchaseRow[]);
    setUnsoldCount(unsold ?? 0);
    setPendingCount(pending ?? 0);

    const totals: Record<string, number> = {};
    (allSetCodes ?? []).forEach((row) => {
      const code = row.set_code ?? "—";
      totals[code] = (totals[code] ?? 0) + 1;
    });
    setSetTotals(totals);

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalSpend = useMemo(() => purchases.reduce((sum, p) => sum + p.price, 0), [purchases]);
  const avgPrice = purchases.length > 0 ? totalSpend / purchases.length : 0;
  const topBuy = useMemo(
    () => [...purchases].sort((a, b) => b.price - a.price)[0] ?? null,
    [purchases]
  );

  const teamSpend = useMemo(() => {
    const map = new Map<string, { spent: number; count: number; overseas: number }>();
    purchases.forEach((p) => {
      const entry = map.get(p.team_id) ?? { spent: 0, count: 0, overseas: 0 };
      entry.spent += p.price;
      entry.count += 1;
      if (p.is_overseas) entry.overseas += 1;
      map.set(p.team_id, entry);
    });
    return teams
      .map((t) => ({ team: t, ...(map.get(t.id) ?? { spent: 0, count: 0, overseas: 0 }) }))
      .sort((a, b) => b.spent - a.spent);
  }, [teams, purchases]);

  const maxTeamSpend = Math.max(1, ...teamSpend.map((t) => t.spent));

  const setBreakdown = useMemo(() => {
    const soldBySet = new Map<string, { count: number; spend: number }>();
    purchases.forEach((p) => {
      const code = p.player?.set_code ?? "—";
      const entry = soldBySet.get(code) ?? { count: 0, spend: 0 };
      entry.count += 1;
      entry.spend += p.price;
      soldBySet.set(code, entry);
    });
    return AUCTION_SET_SEQUENCE.map((s) => ({
      ...s,
      total: setTotals[s.code] ?? 0,
      sold: soldBySet.get(s.code)?.count ?? 0,
      spend: soldBySet.get(s.code)?.spend ?? 0,
    }));
  }, [purchases, setTotals]);

  const topBuys = useMemo(() => [...purchases].sort((a, b) => b.price - a.price).slice(0, 5), [purchases]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-parchment/50">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading analytics…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-lagoon/70">Analytics</p>
        <h1 className="mt-1 font-display text-2xl text-parchment sm:text-3xl">The numbers behind the auction</h1>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-coral/40 bg-coral/10 px-4 py-3 text-sm text-coral">{error}</div>
      )}

      {/* Top stats */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Wallet} label="Total spend" value={formatCr(totalSpend)} />
        <StatCard icon={Users} label="Players sold" value={`${purchases.length}`} sub={`${unsoldCount} unsold · ${pendingCount} left`} />
        <StatCard icon={TrendingUp} label="Average sale" value={formatCr(avgPrice)} />
        <StatCard
          icon={Trophy}
          label="Highest sale"
          value={topBuy ? formatCr(topBuy.price) : "—"}
          sub={topBuy ? `${topBuy.player?.name} · ${topBuy.team?.code}` : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Team spend */}
        <Card>
          <CardHeader>
            <CardTitle>Purse spent by team</CardTitle>
            <CardDescription>Sorted by total spend, most to least.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {teamSpend.map(({ team, spent, count, overseas }) => (
              <div key={team.id}>
                <div className="mb-1 flex items-center justify-between text-xs text-parchment/60">
                  <span className="font-medium text-parchment">
                    {team.code} · {count} players ({overseas} ovs)
                  </span>
                  <span>{formatCr(spent)}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-cove">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-lagoon to-brass"
                    style={{ width: `${Math.max(2, (spent / maxTeamSpend) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Set breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Progress by set</CardTitle>
            <CardDescription>Sold vs. total players in each auction set.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {setBreakdown.map((s) => (
              <div key={s.code}>
                <div className="mb-1 flex items-center justify-between text-xs text-parchment/60">
                  <span className="font-medium text-parchment">
                    {s.code} · {s.label}
                  </span>
                  <span>
                    {s.sold}/{s.total} · {formatCr(s.spend)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-cove">
                  <div
                    className={cn("h-full rounded-full bg-lagoon-bright")}
                    style={{ width: `${s.total > 0 ? Math.max(2, (s.sold / s.total) * 100) : 2}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Top buys */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Top 5 buys</CardTitle>
          <CardDescription>The most expensive purchases of the auction so far.</CardDescription>
        </CardHeader>
        <CardContent>
          {topBuys.length === 0 ? (
            <p className="py-6 text-center text-sm text-parchment/50">No sales yet.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {topBuys.map((p, i) => (
                <li key={i} className="flex items-center justify-between rounded-md bg-deep/40 px-4 py-2 text-sm">
                  <span className="text-parchment/50">#{i + 1}</span>
                  <span className="flex-1 px-3 text-parchment">{p.player?.name}</span>
                  <span className="px-3 text-parchment/60">{p.team?.code}</span>
                  <span className="font-display text-brass-bright">{formatCr(p.price)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-6">
        <div className="rounded-full bg-cove p-3">
          <Icon className="h-5 w-5 text-lagoon-bright" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-parchment/50">{label}</p>
          <p className="font-display text-xl text-parchment">{value}</p>
          {sub && <p className="text-xs text-parchment/40">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
