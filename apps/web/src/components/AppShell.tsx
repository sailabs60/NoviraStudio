import { useState, type ReactNode } from 'react';
import { Wordmark } from './Logo';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Boxes,
  Building2,
  ChevronDown,
  Command,
  CreditCard,
  HelpCircle,
  LayoutGrid,
  LogOut,
  Package,
  Palette,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  User,
  Users,
} from 'lucide-react';
import { useSession } from '../store/session';
import { CommandPalette, useCommandPalette } from './CommandPalette';

const TIER_STYLE: Record<string, string> = {
  free: 'bg-surface-muted text-ink-muted',
  plus: 'bg-primary-soft text-primary',
  pro: 'bg-primary text-primary-fg',
  admin: 'bg-primary text-primary-fg',
};

/**
 * Primary navigation.
 *
 * Split into two groups because the product now does two distinct jobs, and a
 * flat list of nine links would make neither of them findable: **Work** is what
 * you do on a project, **Business** is what the agency runs on. The command
 * palette covers everything either way, and is advertised in the header rather
 * than left to be discovered.
 */
const WORK_LINKS = [
  { to: '/dashboard', label: 'Projects', icon: LayoutGrid },
  { to: '/catalog', label: 'Catalogue', icon: Package },
  { to: '/venues', label: 'Venues', icon: Building2 },
  { to: '/ai-studio', label: 'AI studio', icon: Sparkles },
];

const BUSINESS_LINKS = [
  { to: '/rate-cards', label: 'Rates', icon: Receipt, note: 'What estimates are priced against' },
  { to: '/vendors', label: 'Suppliers & stock', icon: Boxes, note: 'Who you buy from, what you own' },
  { to: '/insights', label: 'Insights', icon: TrendingUp, note: 'What wins, and an ROI model' },
  { to: '/marketplace', label: 'Marketplace', icon: ShoppingBag, note: 'Buy and sell templates and packs' },
  { to: '/specialists', label: 'Specialists', icon: Users, note: 'Hire help, with the plan attached' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const user = useSession((s) => s.user);
  const logout = useSession((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const palette = useCommandPalette();

  const initials = user ? `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase() : '';
  const tier = user?.role === 'super_admin' ? 'admin' : (user?.planTier ?? 'free');
  const active = (to: string) => location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <div className="flex min-h-full flex-col bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link to="/dashboard" className="flex shrink-0 items-center gap-2" aria-label="Novira — projects">
            {/* The same mark as the studio and the landing page. One identity. */}
            <Wordmark size={28} text="text-[15px]" />
          </Link>

          <nav aria-label="Primary" className="ml-2 hidden items-center gap-0.5 lg:flex">
            {WORK_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                aria-current={active(link.to) ? 'page' : undefined}
                className={`btn-ghost btn-sm ${active(link.to) ? 'bg-surface-muted text-ink' : ''}`}
              >
                <link.icon className="h-3.5 w-3.5" /> {link.label}
              </Link>
            ))}

            <div className="relative">
              <button
                type="button"
                onClick={() => setMoreOpen((o) => !o)}
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                className={`btn-ghost btn-sm ${BUSINESS_LINKS.some((l) => active(l.to)) ? 'bg-surface-muted text-ink' : ''}`}
              >
                Business <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {moreOpen ? (
                <>
                  <button type="button" className="fixed inset-0 z-10 cursor-default" aria-hidden onClick={() => setMoreOpen(false)} />
                  <div role="menu" className="panel absolute left-0 z-20 mt-1 w-64 overflow-hidden p-1">
                    {BUSINESS_LINKS.map((link) => (
                      <Link
                        key={link.to}
                        to={link.to}
                        onClick={() => setMoreOpen(false)}
                        className="flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left hover:bg-surface-muted"
                      >
                        <link.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink">{link.label}</span>
                          <span className="block text-[11px] leading-snug text-ink-muted">{link.note}</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => palette.setOpen(true)}
              className="btn-ghost btn-sm"
              title="Search every feature by name (Ctrl+K)"
            >
              <Command className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="ml-1 hidden rounded border border-line px-1 font-mono text-[9px] text-ink-subtle xl:inline">
                Ctrl K
              </kbd>
            </button>

            <Link to="/help" className="btn-ghost btn-sm" title="How everything works">
              <HelpCircle className="h-3.5 w-3.5" />
              <span className="sr-only">Help</span>
            </Link>

            {user && user.planTier !== 'free' ? (
              <Link to="/billing" className="hidden text-xs text-ink-muted hover:text-ink sm:inline">
                <strong className="font-semibold text-ink">{user.creditsRemaining}</strong> credits
              </Link>
            ) : null}

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-surface-muted"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary">
                  {initials}
                </span>
                <span className="hidden text-left sm:block">
                  <span className={`block rounded px-1 text-[10px] font-bold uppercase leading-tight ${TIER_STYLE[tier] ?? TIER_STYLE.free}`}>
                    {tier}
                  </span>
                  <span className="block text-xs font-medium text-ink">{user?.displayName ?? user?.firstName}</span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-ink-subtle" />
              </button>

              {menuOpen ? (
                <>
                  <button type="button" className="fixed inset-0 z-10 cursor-default" aria-hidden onClick={() => setMenuOpen(false)} />
                  <div role="menu" className="panel absolute right-0 z-20 mt-2 w-56 overflow-hidden p-1">
                    <MenuLink to="/account" icon={User} label="Account" onClick={() => setMenuOpen(false)} />
                    <MenuLink to="/billing" icon={CreditCard} label="Plan & credits" onClick={() => setMenuOpen(false)} />
                    <MenuLink to="/help" icon={HelpCircle} label="Help & shortcuts" onClick={() => setMenuOpen(false)} />

                    {user?.company ? (
                      <>
                        <div className="my-1 h-px bg-line" />
                        <MenuLink to="/team" icon={Users} label="Team" onClick={() => setMenuOpen(false)} />
                        <MenuLink to="/white-label" icon={Palette} label="White label" onClick={() => setMenuOpen(false)} />
                      </>
                    ) : null}

                    {user?.role === 'super_admin' ? (
                      <>
                        <div className="my-1 h-px bg-line" />
                        <MenuLink to="/admin" icon={ShieldCheck} label="Admin console" onClick={() => setMenuOpen(false)} accent />
                      </>
                    ) : null}

                    <div className="my-1 h-px bg-line" />
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        logout();
                        navigate('/login');
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-danger hover:bg-danger/10"
                    >
                      <LogOut className="h-4 w-4" /> Log out
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {/* Small screens: the primary links move to a scrolling row below. */}
        <nav aria-label="Sections" className="flex gap-1 overflow-x-auto border-t border-line px-4 py-1.5 lg:hidden">
          {[...WORK_LINKS, ...BUSINESS_LINKS].map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`btn-ghost btn-sm shrink-0 ${active(link.to) ? 'bg-surface-muted text-ink' : ''}`}
            >
              <link.icon className="h-3.5 w-3.5" /> {link.label}
            </Link>
          ))}
        </nav>
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>

      <CommandPalette open={palette.open} onClose={() => palette.setOpen(false)} />
    </div>
  );
}

function MenuLink({
  to,
  icon: Icon,
  label,
  onClick,
  accent,
}: {
  to: string;
  icon: typeof User;
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-surface-muted ${
        accent ? 'text-primary' : 'text-ink-muted hover:text-ink'
      }`}
    >
      <Icon className="h-4 w-4" /> {label}
    </Link>
  );
}
