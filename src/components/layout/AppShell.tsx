import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Anchor,
  LayoutDashboard,
  Users,
  UploadCloud,
  Shield,
  Gavel,
  History,
  BarChart3,
  Settings,
  Tv,
  Radio,
  Menu,
  X,
  ArrowLeft,
  ImageOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/operator", label: "Live Auction", icon: Gavel },
  { to: "/display", label: "Presentation", icon: Tv },
  { to: "/players", label: "Players", icon: Users },
  { to: "/players/import", label: "Import Players", icon: UploadCloud },
  { to: "/players/fix-images", label: "Fix Missing Photos", icon: ImageOff },
  { to: "/teams", label: "Teams", icon: Shield },
  { to: "/auction", label: "Auction Setup", icon: Radio },
  { to: "/history", label: "History", icon: History },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

function BrandMark() {
  return (
    <div className="flex items-center gap-2 px-6 py-6">
      <Anchor className="h-6 w-6 shrink-0 text-brass" strokeWidth={1.75} />
      <div>
        <p className="font-display text-lg leading-tight text-parchment">BidVoyage</p>
        <p className="text-[11px] uppercase tracking-wide text-lagoon/70">Ocean Adventure Auction</p>
      </div>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-1 px-3 py-4">
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-parchment/80 transition-colors hover:bg-cove hover:text-parchment",
              isActive && "bg-cove text-lagoon-bright shadow-deck"
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function BackButton() {
  const location = useLocation();
  const navigate = useNavigate();

  // No back button on the dashboard itself — you're already there.
  if (location.pathname === "/") return null;

  return (
    <div className="sticky top-0 z-20 border-b border-wood-light/15 bg-abyss/80 px-4 py-2 backdrop-blur-md sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={() => navigate("/")}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-parchment/70 transition-colors hover:bg-cove hover:text-parchment"
        aria-label="Back to dashboard"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </button>
    </div>
  );
}

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  // Close the drawer automatically whenever the route changes (e.g. back/forward nav).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Mobile top bar — replaces the sidebar below the md breakpoint */}
      <header className="flex items-center justify-between border-b border-wood-light/15 bg-deep/80 px-4 py-3 backdrop-blur-md md:hidden">
        <div className="flex items-center gap-2">
          <Anchor className="h-5 w-5 shrink-0 text-brass" strokeWidth={1.75} />
          <p className="font-display text-base leading-tight text-parchment">BidVoyage</p>
        </div>
        <Dialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              aria-label="Open navigation menu"
              className="rounded-md p-2 text-parchment hover:bg-cove"
            >
              <Menu className="h-5 w-5" />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-abyss/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
            <Dialog.Content
              className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-wood-light/15 bg-deep shadow-deck focus:outline-none"
              aria-describedby={undefined}
            >
              <Dialog.Title asChild>
                <span className="sr-only">Navigation menu</span>
              </Dialog.Title>
              <div className="flex items-start justify-between">
                <BrandMark />
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label="Close navigation menu"
                    className="mr-3 mt-4 h-8 w-8 shrink-0 rounded-md p-1.5 text-parchment/70 hover:bg-cove hover:text-parchment"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </Dialog.Close>
              </div>
              <div className="rope-divider mx-6" />
              <NavList onNavigate={() => setMobileNavOpen(false)} />
              <div className="px-6 py-4 text-[11px] text-parchment/40">Charted for smooth sailing ⚓</div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-wood-light/15 bg-deep/80 backdrop-blur-md md:flex md:flex-col">
        <BrandMark />
        <div className="rope-divider mx-6" />
        <NavList />
        <div className="px-6 py-4 text-[11px] text-parchment/40">Charted for smooth sailing ⚓</div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <BackButton />
        <Outlet />
      </main>
    </div>
  );
}
