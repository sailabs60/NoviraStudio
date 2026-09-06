import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { FixtureLabPage } from './pages/FixtureLabPage';
import { useSession } from './store/session';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectPage } from './pages/ProjectPage';
import { EditorPage } from './pages/EditorPage';
import { AccountPage } from './pages/AccountPage';
import { CatalogPage } from './pages/CatalogPage';
import { SharePage } from './pages/SharePage';
import { AdminPage } from './pages/AdminPage';
import { BillingPage } from './pages/BillingPage';
import { TeamPage } from './pages/TeamPage';
import { VendorsPage } from './pages/VendorsPage';
import { GuestsPage } from './pages/GuestsPage';
import { ProposalsPage } from './pages/ProposalsPage';
import { ProposalPublicPage } from './pages/ProposalPublicPage';
import { VenuesPage } from './pages/VenuesPage';
import { RateCardsPage } from './pages/RateCardsPage';
import { InsightsPage } from './pages/InsightsPage';
import { MarketplacePage } from './pages/MarketplacePage';
import { SpecialistsPage } from './pages/SpecialistsPage';
import { HelpPage } from './pages/HelpPage';
import { WhiteLabelPage } from './pages/WhiteLabelPage';
import { AiStudioPage } from './pages/AiStudioPage';
import { Spinner } from './components/Spinner';
import { ToastHost } from './components/ui';

function RequireAuth({ children }: { children: JSX.Element }) {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'anonymous') {
    return <Navigate to={`/login?return_to=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return children;
}

function FullPageLoader() {
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <Spinner label="Loading Novira…" />
    </div>
  );
}

export default function App() {
  const bootstrap = useSession((s) => s.bootstrap);
  const status = useSession((s) => s.status);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'loading') return <FullPageLoader />;

  return (
    <>
      {/*
        The skip link. Someone navigating by keyboard should not have to tab
        through the whole header on every page to reach the content.
      */}
      <a href="#main" className="nv-skip-link">
        Skip to the main content
      </a>

      <Routes>
        {/*
          The landing page is the root and is public. It reads the session so a
          signed-in visitor is offered the studio rather than a sign-up form —
          redirecting them away outright would mean nobody could ever look at
          their own product's marketing page while logged in.
        */}
        {/*
          The fixture and truss workbench. Development only: it draws every
          fixture body and truss section on a neutral turntable next to a
          metre rule, which is the only way to check a silhouette and its
          size without a plan getting in the way.
        */}
        {import.meta.env.DEV ? <Route path="/lab" element={<FixtureLabPage />} /> : null}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/share/:token" element={<SharePage />} />
        {/* Client-facing and deliberately outside RequireAuth. */}
        <Route path="/proposal/:token" element={<ProposalPublicPage />} />

        <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
        <Route path="/projects/:projectId" element={<RequireAuth><ProjectPage /></RequireAuth>} />
        <Route path="/editor/:planId" element={<RequireAuth><EditorPage /></RequireAuth>} />
        <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
        <Route path="/catalog" element={<RequireAuth><CatalogPage /></RequireAuth>} />
        <Route path="/billing" element={<RequireAuth><BillingPage /></RequireAuth>} />
        <Route path="/team" element={<RequireAuth><TeamPage /></RequireAuth>} />
        <Route path="/vendors" element={<RequireAuth><VendorsPage /></RequireAuth>} />
        <Route path="/projects/:projectId/guests" element={<RequireAuth><GuestsPage /></RequireAuth>} />
        <Route path="/projects/:projectId/proposals" element={<RequireAuth><ProposalsPage /></RequireAuth>} />

        {/* ── The spatial platform ─────────────────────────────────────── */}
        <Route path="/venues" element={<RequireAuth><VenuesPage /></RequireAuth>} />
        <Route path="/rate-cards" element={<RequireAuth><RateCardsPage /></RequireAuth>} />
        <Route path="/insights" element={<RequireAuth><InsightsPage /></RequireAuth>} />
        <Route path="/marketplace" element={<RequireAuth><MarketplacePage /></RequireAuth>} />
        <Route path="/specialists" element={<RequireAuth><SpecialistsPage /></RequireAuth>} />
        <Route path="/white-label" element={<RequireAuth><WhiteLabelPage /></RequireAuth>} />
        <Route path="/ai-studio" element={<RequireAuth><AiStudioPage /></RequireAuth>} />
        <Route path="/help" element={<RequireAuth><HelpPage /></RequireAuth>} />

        <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to={status === 'authenticated' ? '/dashboard' : '/'} replace />} />
      </Routes>

      {/*
        One toast host for the whole app, outside the routes so a message
        survives a navigation — "saved" should not vanish because the save
        happened to be the last thing before a page change.
      */}
      <ToastHost />
    </>
  );
}
