import { useEffect, useMemo, useState } from "react";
import { Search, ChevronLeft, ChevronRight, Loader2, MoreVertical, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { PlayerRow } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { formatCr } from "@/lib/utils";
import { AUCTION_SET_SEQUENCE } from "@/features/auction/auctionSets";

const PAGE_SIZE = 25;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function PlayersPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [setFilter, setSetFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toDelete, setToDelete] = useState<PlayerRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Distinct roles for the filter dropdown — fetched once.
  useEffect(() => {
    supabase
      .from("players")
      .select("role")
      .not("role", "is", null)
      .then(({ data }) => {
        const unique = Array.from(new Set((data ?? []).map((r) => r.role).filter(Boolean))) as string[];
        setRoles(unique);
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    // Default sort follows the fixed Mega Auction running order (set_order, then
    // base_price desc, then name) rather than plain alphabetical, unless searching by name.
    let query = supabase
      .from("players")
      .select("*", { count: "exact" })
      .order("set_order", { ascending: true, nullsFirst: false })
      .order("base_price", { ascending: false })
      .order("name", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (debouncedSearch.trim()) {
      query = query.ilike("name", `%${debouncedSearch.trim()}%`);
    }
    if (roleFilter !== "all") {
      query = query.eq("role", roleFilter);
    }
    if (setFilter !== "all") {
      query = query.eq(
        "set_code",
        setFilter as NonNullable<PlayerRow["set_code"]>
      );
    }

    query.then(({ data, count }) => {
      setPlayers(data ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    });
  }, [debouncedSearch, roleFilter, setFilter, page, refreshKey]);

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);

    // Never delete a player who is on the block right now or already sold — that would
    // wipe their purchase / squad row without refunding the team's purse.
    const { data: blocking, error: blockErr } = await supabase
      .from("auction_players")
      .select("id, status")
      .eq("player_id", toDelete.id)
      .in("status", ["live", "sold"])
      .limit(1);
    if (blockErr) {
      setDeleteError(blockErr.message);
      setDeleting(false);
      return;
    }
    if (blocking && blocking.length > 0) {
      setDeleteError(
        blocking[0].status === "sold"
          ? "This player has already been sold in an auction, so they can't be deleted."
          : "This player is live on the auction block right now, so they can't be deleted."
      );
      setDeleting(false);
      return;
    }

    // ON DELETE CASCADE on auction_players removes this player from every auction queue,
    // so they will no longer show up in the Live Auction.
    const { data: deleted, error } = await supabase
      .from("players")
      .delete()
      .eq("id", toDelete.id)
      .select("id");

    if (error) {
      setDeleteError(error.message);
      setDeleting(false);
      return;
    }
    if (!deleted || deleted.length === 0) {
      // RLS silently filters rows you aren't allowed to delete — surface that instead of faking success.
      setDeleteError("Nothing was deleted. Your account probably doesn't have operator permission on the players table.");
      setDeleting(false);
      return;
    }

    setDeleting(false);
    setToDelete(null);
    // If that was the last row on this page, step back one page.
    if (players.length === 1 && page > 0) setPage((p) => p - 1);
    setRefreshKey((k) => k + 1);
  };

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-lagoon/70">Players</p>
          <h1 className="mt-1 font-display text-2xl text-parchment sm:text-3xl">The full manifest</h1>
          <p className="mt-1 text-sm text-parchment/60">{total.toLocaleString()} players charted</p>
        </div>
        <Button asChild className="self-start sm:self-auto">
          <a href="/players/import">Import players →</a>
        </Button>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-parchment/40" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search players by name…"
            className="w-full rounded-md border border-wood-light/30 bg-deep/60 py-2 pl-9 pr-3 text-sm text-parchment placeholder:text-parchment/40 focus:border-lagoon focus:outline-none"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(0);
          }}
          className="rounded-md border border-wood-light/30 bg-deep/60 px-3 py-2 text-sm text-parchment focus:border-lagoon focus:outline-none"
        >
          <option value="all">All roles</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={setFilter}
          onChange={(e) => {
            setSetFilter(e.target.value);
            setPage(0);
          }}
          className="rounded-md border border-wood-light/30 bg-deep/60 px-3 py-2 text-sm text-parchment focus:border-lagoon focus:outline-none"
        >
          <option value="all">All auction sets</option>
          {AUCTION_SET_SEQUENCE.map((s) => (
            <option key={s.code} value={s.code}>
              {s.order}. {s.label}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-parchment/50">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading players…
            </div>
          ) : players.length === 0 ? (
            <div className="py-16 text-center text-sm text-parchment/50">
              No players match yet — import a dataset to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-deep text-parchment/60">
                  <tr>
                    <th className="px-4 py-3 font-medium">Photo</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Country</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Base price</th>
                    <th className="px-4 py-3 font-medium">Auction set</th>
                    <th className="px-4 py-3 font-medium">Image</th>
                    <th className="w-12 px-2 py-3" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    <tr key={p.id} className="border-t border-wood-light/10 hover:bg-cove/40">
                      <td className="px-4 py-2">
                        <div className="h-10 w-10 overflow-hidden rounded-full border border-wood-light/30 bg-cove">
                          {p.image_url ? (
                            <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-parchment">{p.name}</td>
                      <td className="px-4 py-2 text-parchment/70">{p.country ?? "—"}</td>
                      <td className="px-4 py-2 text-parchment/70">{p.role ?? "—"}</td>
                      <td className="px-4 py-2 text-parchment/70">{formatCr(p.base_price)}</td>
                      <td className="px-4 py-2 text-parchment/70">{p.set_code ?? "—"}</td>
                      <td className="px-4 py-2">
                        <Badge
                          variant={
                            p.image_status === "matched" ? "matched" : p.image_status === "needs_review" ? "needs_review" : "missing"
                          }
                        >
                          {p.image_status.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${p.name}`}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-coral focus:text-coral"
                              onSelect={() => {
                                setDeleteError(null);
                                setToDelete(p);
                              }}
                            >
                              <Trash2 className="h-4 w-4" /> Delete player
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-col gap-3 text-sm text-parchment/60 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Page {page + 1} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && !deleting && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {toDelete?.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the player from the master list and from every auction queue, so they
              won't appear in the Live Auction. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-sm text-coral">{deleteError}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
