import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import Dashboard from "@/pages/Dashboard";
import PlayersPage from "@/pages/players/Players";
import PlayersImportPage from "@/pages/players/Import";
import TeamsPage from "@/pages/teams/Teams";
import AuctionSetupPage from "@/pages/auction/AuctionSetup";
import LiveAuctionPage from "@/pages/operator/LiveAuction";
import PresentationDisplayPage from "@/pages/display/PresentationDisplay";
import HistoryPage from "@/pages/history/History";
import AnalyticsPage from "@/pages/analytics/Analytics";
import SettingsPage from "@/pages/settings/Settings";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* /operator and /display get their own full-bleed shells in later stages */}
        <Route path="/operator" element={<LiveAuctionPage />} />
        <Route path="/display" element={<PresentationDisplayPage />} />

        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/players/import" element={<PlayersImportPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/auction" element={<AuctionSetupPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
