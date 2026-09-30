import { useEffect, useState } from "react";
import { Users, Shield, Gavel, ImageOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [missingImages, setMissingImages] = useState<number | null>(null);
  const [teamCount, setTeamCount] = useState<number | null>(null);

  useEffect(() => {
    supabase.from("players").select("*", { count: "exact", head: true }).then(({ count }) => setPlayerCount(count ?? 0));
    supabase
      .from("players")
      .select("*", { count: "exact", head: true })
      .eq("image_status", "missing")
      .then(({ count }) => setMissingImages(count ?? 0));
    supabase.from("teams").select("*", { count: "exact", head: true }).then(({ count }) => setTeamCount(count ?? 0));
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-wood-light/20 shadow-deck sm:mb-8">
        <img
          src="/images/dashboard-hero.webp"
          alt="Oceanic Arena — the IPL Mock Auction stadium at sunset"
          className="h-40 w-full object-cover sm:h-56 lg:h-72"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-abyss via-abyss/60 to-transparent" />
        <header className="absolute inset-x-0 bottom-0 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
          <p className="text-xs font-medium uppercase tracking-wide text-lagoon-bright/90">BidVoyage</p>
          <h1 className="mt-1 font-display text-xl text-parchment drop-shadow-md sm:text-2xl lg:text-3xl">
            Welcome aboard
          </h1>
          <p className="mt-2 max-w-xl text-xs text-parchment/80 sm:text-sm">
            Chart your players, crew the teams, and set sail on the live auction from here.
          </p>
        </header>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Users} label="Players charted" value={playerCount} />
        <StatCard icon={Shield} label="Teams ready" value={teamCount} />
        <StatCard icon={ImageOff} label="Missing photos" value={missingImages} tone={missingImages ? "warn" : undefined} />
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button size="lg" asChild>
          <a href="/players/import">
            <span className="flex items-center gap-2">Import players</span>
          </a>
        </Button>
        <Button size="lg" variant="outline" asChild>
          <a href="/auction">Configure auction</a>
        </Button>
        <Button size="lg" variant="brass" asChild>
          <a href="/operator">
            <Gavel className="h-4 w-4" /> Open operator console
          </a>
        </Button>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: number | null;
  tone?: "warn";
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-6">
        <div className="rounded-full bg-cove p-3">
          <Icon className={tone === "warn" ? "h-5 w-5 text-coral" : "h-5 w-5 text-lagoon-bright"} />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-parchment/50">{label}</p>
          <p className="font-display text-2xl text-parchment">{value === null ? "—" : value.toLocaleString()}</p>
        </div>
      </CardContent>
    </Card>
  );
}
