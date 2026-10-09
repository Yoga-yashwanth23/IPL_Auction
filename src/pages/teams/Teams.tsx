import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Shield } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { TeamRow } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn, formatCr } from "@/lib/utils";
import { loadTeamsWithPurse } from "@/features/auction/teamPurses";
import { fetchVenueAuction, useVenueKey } from "@/lib/venue";

type TeamFormState = {
  name: string;
  logo_url: string;
  primary_color: string;
  purse_total: string;
  squad_size_limit: string;
  squad_size_min: string;
  overseas_limit: string;
};

function toFormState(team: TeamRow): TeamFormState {
  return {
    name: team.name,
    logo_url: team.logo_url ?? "",
    primary_color: team.primary_color ?? "#1FB6AC",
    purse_total: String(team.purse_total),
    squad_size_limit: String(team.squad_size_limit),
    squad_size_min: String(team.squad_size_min),
    overseas_limit: String(team.overseas_limit),
  };
}

export default function TeamsPage() {
  const venue = useVenueKey();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TeamRow | null>(null);
  const [form, setForm] = useState<TeamFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Purse figures shown here belong to the venue currently selected in the sidebar.
  const loadTeams = useCallback(async () => {
    setLoading(true);
    const { data: auctionRow } = await fetchVenueAuction(venue);
    if (auctionRow) {
      setTeams(await loadTeamsWithPurse(auctionRow.id));
    } else {
      const { data, error } = await supabase.from("teams").select("*").order("name", { ascending: true });
      if (error) setError(error.message);
      setTeams(data ?? []);
    }
    setLoading(false);
  }, [venue]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  const openEdit = (team: TeamRow) => {
    setEditing(team);
    setForm(toFormState(team));
    setError(null);
  };

  const closeEdit = () => {
    setEditing(null);
    setForm(null);
  };

  const handleSave = async () => {
    if (!editing || !form) return;
    setSaving(true);
    setError(null);

    const purseTotal = Number(form.purse_total);
    const squadLimit = Number(form.squad_size_limit);
    const squadMin = Number(form.squad_size_min);
    const overseasLimit = Number(form.overseas_limit);

    if ([purseTotal, squadLimit, squadMin, overseasLimit].some((n) => Number.isNaN(n))) {
      setError("All numeric fields must be valid numbers.");
      setSaving(false);
      return;
    }

    const { error } = await supabase
      .from("teams")
      .update({
        name: form.name.trim() || editing.name,
        logo_url: form.logo_url.trim() || null,
        primary_color: form.primary_color.trim() || null,
        purse_total: purseTotal,
        purse_remaining: purseTotal, // legacy column, unused: purses are derived per venue
        squad_size_limit: squadLimit,
        squad_size_min: squadMin,
        overseas_limit: overseasLimit,
      })
      .eq("id", editing.id);

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    closeEdit();
    loadTeams();
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-lagoon/70">Teams</p>
        <h1 className="mt-1 font-display text-2xl text-parchment sm:text-3xl">Crew the fleet</h1>
        <p className="mt-1 text-sm text-parchment/60">
          {teams.length > 0 ? `${teams.length} teams ready` : "No teams yet"} — set each team's purse and squad
          rules before the auction sets sail.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-parchment/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading teams…
        </div>
      ) : teams.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-parchment/50">
            No teams found. Run the seed section of <code>supabase/schema.sql</code> to add the 10 IPL teams.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => {
            const spent = team.purse_total - team.purse_remaining;
            const pct = team.purse_total > 0 ? Math.min(100, Math.round((spent / team.purse_total) * 100)) : 0;
            return (
              <Card key={team.id}>
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-wood-light/30 text-xs font-semibold text-abyss"
                        style={{ backgroundColor: team.primary_color ?? "#1FB6AC" }}
                      >
                        {team.logo_url ? (
                          <img src={team.logo_url} alt="" className="h-full w-full rounded-full object-cover" />
                        ) : (
                          team.code
                        )}
                      </div>
                      <div>
                        <p className="font-display text-base leading-tight text-parchment">{team.name}</p>
                        <p className="text-xs uppercase tracking-wide text-parchment/50">{team.code}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(team)} aria-label={`Edit ${team.name}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-parchment/60">
                      <span>Purse remaining</span>
                      <span>
                        {formatCr(team.purse_remaining)} / {formatCr(team.purse_total)}
                      </span>
                    </div>
                    <Progress value={pct} />
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-xs text-parchment/60">
                    <div className="rounded-md bg-deep/60 px-2 py-2">
                      <p className="font-display text-sm text-parchment">{team.squad_size_min}–{team.squad_size_limit}</p>
                      <p>Squad size</p>
                    </div>
                    <div className="rounded-md bg-deep/60 px-2 py-2">
                      <p className="font-display text-sm text-parchment">{team.overseas_limit}</p>
                      <p>Overseas cap</p>
                    </div>
                    <div className="rounded-md bg-deep/60 px-2 py-2">
                      <p className="font-display text-sm text-parchment">{pct}%</p>
                      <p>Purse spent</p>
                    </div>
                  </div>

                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent>
          {editing && form && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-lagoon-bright" /> Edit {editing.code}
                </DialogTitle>
                <DialogDescription>Update purse and squad rules for {editing.name}.</DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="team-name">Team name</Label>
                  <Input
                    id="team-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="team-logo">Logo URL</Label>
                  <Input
                    id="team-logo"
                    placeholder="https://…"
                    value={form.logo_url}
                    onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="team-color">Primary color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="team-color"
                      type="color"
                      value={form.primary_color}
                      onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                      className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-wood-light/30 bg-deep/60"
                    />
                    <Input
                      value={form.primary_color}
                      onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="purse-total">Purse total (₹ Lakh — 10000 = ₹100 Cr)</Label>
                  <Input
                    id="purse-total"
                    inputMode="decimal"
                    value={form.purse_total}
                    onChange={(e) => setForm({ ...form, purse_total: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="squad-min">Squad size (min)</Label>
                  <Input
                    id="squad-min"
                    inputMode="numeric"
                    value={form.squad_size_min}
                    onChange={(e) => setForm({ ...form, squad_size_min: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="squad-limit">Squad size (limit)</Label>
                  <Input
                    id="squad-limit"
                    inputMode="numeric"
                    value={form.squad_size_limit}
                    onChange={(e) => setForm({ ...form, squad_size_limit: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="overseas-limit">Overseas limit</Label>
                  <Input
                    id="overseas-limit"
                    inputMode="numeric"
                    value={form.overseas_limit}
                    onChange={(e) => setForm({ ...form, overseas_limit: e.target.value })}
                  />
                </div>
              </div>

              {error && <p className="mt-3 text-sm text-coral">{error}</p>}

              <DialogFooter>
                <Button variant="outline" onClick={closeEdit} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving} className={cn(saving && "opacity-70")}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
