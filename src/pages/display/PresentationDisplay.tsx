import { useCallback, useEffect, useRef, useState } from "react";
import { Anchor, ArrowLeft, PartyPopper, XCircle, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AuctionRow, AuctionPlayerRow, TeamRow, PlayerRow } from "@/types";
import { cn, formatCr } from "@/lib/utils";

type CurrentAuctionPlayer = AuctionPlayerRow & { player: PlayerRow };

interface TickerItem {
  id: string;
  playerName: string;
  teamCode: string;
  teamColor: string | null;
  price: number;
}

interface FlashState {
  kind: "sold" | "unsold";
  playerName: string;
  teamName?: string;
  teamCode?: string;
  price?: number;
}

export default function PresentationDisplayPage() {
  const [auction, setAuction] = useState<AuctionRow | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [current, setCurrent] = useState<CurrentAuctionPlayer | null>(null);
  const [ticker, setTicker] = useState<TickerItem[]>([]);
  const [flash, setFlash] = useState<FlashState | null>(null);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ pending: 0, sold: 0, unsold: 0, total: 0 });

  const teamsRef = useRef<TeamRow[]>([]);
  useEffect(() => {
    teamsRef.current = teams;
  }, [teams]);

  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshCurrent = useCallback(async (auctionRow: AuctionRow) => {
    if (!auctionRow.current_auction_player_id) {
      setCurrent(null);
      return;
    }
    const { data } = await supabase
      .from("auction_players")
      .select("*, player:players(*)")
      .eq("id", auctionRow.current_auction_player_id)
      .maybeSingle();
    setCurrent((data as unknown as CurrentAuctionPlayer) ?? null);
  }, []);

  const refreshCounts = useCallback(async (auctionId: string) => {
    const [pending, sold, unsold, total] = await Promise.all([
      supabase.from("auction_players").select("*", { count: "exact", head: true }).eq("auction_id", auctionId).eq("status", "pending"),
      supabase.from("auction_players").select("*", { count: "exact", head: true }).eq("auction_id", auctionId).eq("status", "sold"),
      supabase.from("auction_players").select("*", { count: "exact", head: true }).eq("auction_id", auctionId).eq("status", "unsold"),
      supabase.from("auction_players").select("*", { count: "exact", head: true }).eq("auction_id", auctionId),
    ]);
    setCounts({ pending: pending.count ?? 0, sold: sold.count ?? 0, unsold: unsold.count ?? 0, total: total.count ?? 0 });
  }, []);

  const refreshTicker = useCallback(async (auctionId: string) => {
    const { data } = await supabase
      .from("purchases")
      .select("id, price, player:players(name), team:teams(code, primary_color)")
      .eq("auction_id", auctionId)
      .order("created_at", { ascending: false })
      .limit(8);
    const items: TickerItem[] = (data ?? []).map((row: any) => ({
      id: row.id,
      playerName: row.player?.name ?? "—",
      teamCode: row.team?.code ?? "—",
      teamColor: row.team?.primary_color ?? null,
      price: row.price,
    }));
    setTicker(items);
  }, []);

  const showFlash = (state: FlashState) => {
    setFlash(state);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 4200);
  };

  useEffect(() => {
    let auctionChannel: ReturnType<typeof supabase.channel> | null = null;
    let eventsChannel: ReturnType<typeof supabase.channel> | null = null;

    const init = async () => {
      setLoading(true);
      const { data: auctionRow } = await supabase
        .from("auctions")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!auctionRow) {
        setLoading(false);
        return;
      }

      const { data: teamRows } = await supabase.from("teams").select("*").order("name", { ascending: true });
      setAuction(auctionRow);
      setTeams(teamRows ?? []);
      await Promise.all([refreshCurrent(auctionRow), refreshCounts(auctionRow.id), refreshTicker(auctionRow.id)]);
      setLoading(false);

      auctionChannel = supabase
        .channel(`display-auctions-${auctionRow.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "auctions", filter: `id=eq.${auctionRow.id}` },
          (payload) => {
            const row = payload.new as AuctionRow;
            setAuction(row);
            refreshCurrent(row);
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "teams" },
          (payload) => {
            const row = payload.new as TeamRow;
            setTeams((prev) => prev.map((t) => (t.id === row.id ? row : t)));
          }
        )
        .subscribe();

      eventsChannel = supabase
        .channel(`display-events-${auctionRow.id}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "purchases", filter: `auction_id=eq.${auctionRow.id}` },
          async (payload) => {
            const row = payload.new as { id: string; player_id: string; team_id: string; price: number };
            const [{ data: player }, { data: team }] = await Promise.all([
              supabase.from("players").select("name").eq("id", row.player_id).maybeSingle(),
              supabase.from("teams").select("name, code").eq("id", row.team_id).maybeSingle(),
            ]);
            showFlash({ kind: "sold", playerName: player?.name ?? "—", teamName: team?.name, teamCode: team?.code, price: row.price });
            refreshTicker(auctionRow.id);
            refreshCounts(auctionRow.id);
          }
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "auction_events", filter: `auction_id=eq.${auctionRow.id}` },
          async (payload) => {
            const row = payload.new as { event_type: string; auction_player_id: string | null };
            if (row.event_type !== "unsold" || !row.auction_player_id) {
              if (row.event_type === "sold") refreshCounts(auctionRow.id);
              return;
            }
            const { data: ap } = await supabase
              .from("auction_players")
              .select("player:players(name)")
              .eq("id", row.auction_player_id)
              .maybeSingle();
            showFlash({ kind: "unsold", playerName: (ap as any)?.player?.name ?? "—" });
            refreshCounts(auctionRow.id);
          }
        )
        .subscribe();
    };

    init();

    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (auctionChannel) supabase.removeChannel(auctionChannel);
      if (eventsChannel) supabase.removeChannel(eventsChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-abyss text-parchment/60">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading presentation…
      </div>
    );
  }

  if (!auction) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-abyss text-center text-parchment/60">
        No auction has been configured yet.
      </div>
    );
  }

  const highestTeam = teams.find((t) => t.id === auction.highest_bidder_team_id);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-abyss px-6 py-8 sm:px-12 sm:py-10">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="rounded-md p-2 text-parchment/60 hover:bg-cove hover:text-parchment"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="h-5 w-5" />
          </a>
          <Anchor className="h-7 w-7 text-brass" strokeWidth={1.5} />
          <div>
            <p className="font-display text-xl text-parchment sm:text-2xl">{auction.name}</p>
            <p className="text-xs uppercase tracking-[0.2em] text-lagoon/70">Ocean Adventure Auction</p>
          </div>
        </div>
        <div className="flex gap-6 text-center text-xs uppercase tracking-wide text-parchment/50">
          <div>
            <p className="font-display text-2xl text-parchment">{counts.sold}</p>
            <p>Sold</p>
          </div>
          <div>
            <p className="font-display text-2xl text-parchment">{counts.unsold}</p>
            <p>Unsold</p>
          </div>
          <div>
            <p className="font-display text-2xl text-parchment">{counts.pending}</p>
            <p>Remaining</p>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        {auction.status === "ended" || (!current && counts.pending === 0 && counts.total > 0) ? (
          <div className="text-center">
            <p className="font-display text-4xl text-parchment">Auction complete</p>
            <p className="mt-2 text-parchment/60">
              {counts.sold} sold · {counts.unsold} unsold of {counts.total} players
            </p>
          </div>
        ) : current ? (
          <>
            <div className="h-64 w-64 shrink-0 overflow-hidden rounded-full border-4 border-wood-light/30 bg-cove shadow-deck sm:h-80 sm:w-80">
              {current.player.image_url ? (
                <img src={current.player.image_url} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.3em] text-lagoon-bright/80">{current.player.set_code ?? "—"}</p>
              <h1 className="mt-2 font-display text-6xl text-parchment sm:text-7xl">{current.player.name}</h1>
              <p className="mt-2 text-lg text-parchment/60">
                {current.player.country ?? "—"} · {current.player.role ?? "—"} · Base {formatCr(current.player.base_price)}
              </p>
            </div>
            <div className="rounded-2xl bg-deep/60 px-14 py-6 text-center shadow-deck">
              <p className="text-xs uppercase tracking-[0.3em] text-parchment/50">Current bid</p>
              <p className="mt-1 font-display text-6xl text-lagoon-bright sm:text-7xl">
                {auction.current_bid > 0 ? formatCr(auction.current_bid) : "—"}
              </p>
              {highestTeam && <p className="mt-2 text-xl text-parchment">{highestTeam.name}</p>}
            </div>
          </>
        ) : (
          <p className="font-display text-3xl text-parchment/50">Waiting for the next player…</p>
        )}
      </div>

      {/* Team scoreboard */}
      <div className="mt-10 grid grid-cols-5 gap-2 sm:grid-cols-10">
        {teams.map((team) => (
          <div
            key={team.id}
            className={cn(
              "rounded-lg border px-2 py-2 text-center",
              auction.highest_bidder_team_id === team.id
                ? "border-lagoon-bright bg-lagoon/20"
                : "border-wood-light/20 bg-deep/40"
            )}
          >
            <p
              className="font-display text-sm"
              style={{ color: auction.highest_bidder_team_id === team.id ? undefined : team.primary_color ?? undefined }}
            >
              {team.code}
            </p>
            <p className="text-[11px] text-parchment/50">{formatCr(team.purse_remaining)}</p>
          </div>
        ))}
      </div>

      {/* Recent sales ticker */}
      {ticker.length > 0 && (
        <div className="mt-4 flex gap-6 overflow-x-auto text-sm text-parchment/50">
          {ticker.map((item) => (
            <span key={item.id} className="shrink-0 whitespace-nowrap">
              <span className="text-parchment">{item.playerName}</span> → {item.teamCode} ·{" "}
              <span className="text-brass-bright">{formatCr(item.price)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Sold / unsold flash overlay */}
      {flash && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-abyss/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 text-center">
            {flash.kind === "sold" ? (
              <>
                <PartyPopper className="h-16 w-16 text-brass-bright" />
                <p className="text-lg uppercase tracking-[0.3em] text-parchment/60">Sold!</p>
                <p className="font-display text-6xl text-parchment">{flash.playerName}</p>
                <p className="font-display text-4xl text-lagoon-bright">
                  to {flash.teamName} ({flash.teamCode})
                </p>
                <p className="text-3xl text-brass-bright">{formatCr(flash.price ?? 0)}</p>
              </>
            ) : (
              <>
                <XCircle className="h-16 w-16 text-coral" />
                <p className="text-lg uppercase tracking-[0.3em] text-parchment/60">Unsold</p>
                <p className="font-display text-5xl text-parchment">{flash.playerName}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
