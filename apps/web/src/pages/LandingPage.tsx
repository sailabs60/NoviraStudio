import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Boxes,
  Brush,
  Calculator,
  Check,
  FileDown,
  Layers,
  Menu,
  MessageSquare,
  Play,
  Presentation,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useSession } from '../store/session';
import { HeroScene } from '../landing/HeroScene';
import { Wordmark } from '../components/Logo';
import { Figure, Marquee, Reveal, SectionHeading, StatRow, TiltCard } from '../landing/pieces';

/**
 * The landing page.
 *
 * Its job is to answer one question in under ten seconds: *what does this
 * thing do?* Everything on it is arranged around that, and the arrangement is
 * deliberate rather than decorative.
 *
 *  · **The hero shows the product working**, in the product's own renderer, on
 *    a loop. A stage assembles itself the way a real load-in happens. Nothing
 *    on a marketing page is as persuasive as the thing itself running.
 *  · **Every claim is a number that can be checked** — eighteen libraries,
 *    integer millimetres, six market rule sets — rather than an adjective.
 *  · **The sections follow the actual workflow**: find, build, finish, cost,
 *    check, deliver. Someone who reads it in order has been taught the product.
 *
 * Photography arrives as files dropped into `public/landing/`; until then each
 * slot renders a labelled placeholder at the correct aspect ratio, so the page
 * is never broken and the layout never shifts when the artwork lands.
 */

const SOURCES = [
  'Sketchfab',
  'BlenderKit',
  'Poly Haven',
  'ambientCG',
  'Poly Pizza',
  'Smithsonian',
  'Khronos',
  'Europeana',
  'NASA 3D',
  'Thingiverse',
  'MyMiniFactory',
  'Free3D',
  'Openverse',
  'Unsplash',
  'Pexels',
  'Pixabay',
  'Pinterest',
  'Open Source 3D',
];

export function LandingPage() {
  const status = useSession((s) => s.status);
  const signedIn = status === 'authenticated';

  return (
    <div className="min-h-full bg-bg">
      <LandingNav signedIn={signedIn} />

      <main id="main">
        <Hero signedIn={signedIn} />
        <SourceStrip />
        <WorkflowSection />
        <LibrarySection />
        <MaterialSection />
        <NumbersSection />
        <DeliverableSection />
        <AudienceSection />
        <ClosingSection signedIn={signedIn} />
      </main>

      <LandingFooter />
    </div>
  );
}

/* ── Navigation ────────────────────────────────────────────────────────── */

function LandingNav({ signedIn }: { signedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [
    { href: '#how', label: 'How it works' },
    { href: '#libraries', label: 'Libraries' },
    { href: '#deliverables', label: 'What you get' },
    { href: '#who', label: 'Who it is for' },
  ];

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled ? 'border-b border-line bg-bg/85 backdrop-blur-xl' : 'border-b border-transparent'
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-5" aria-label="Main">
        <Link to="/" className="flex items-center gap-2" aria-label="Novira home">
          <Wordmark size={32} text="text-[17px]" />
        </Link>

        <ul className="ml-6 hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-muted transition hover:bg-surface-muted hover:text-ink"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          {signedIn ? (
            <Link to="/dashboard" className="btn-primary">
              Open the studio <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn-ghost">
                Sign in
              </Link>
              <Link to="/register" className="btn-primary">
                Start free <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="icon-btn ml-auto md:hidden"
          onClick={() => setMenu((v) => !v)}
          aria-expanded={menu}
          aria-label={menu ? 'Close the menu' : 'Open the menu'}
        >
          {menu ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </nav>

      {menu ? (
        <div className="nv-rise border-t border-line bg-bg px-5 py-3 md:hidden">
          <ul className="space-y-1">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setMenu(false)}
                  className="block rounded-lg px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Link to="/login" className="btn-secondary flex-1 justify-center">
              Sign in
            </Link>
            <Link to={signedIn ? '/dashboard' : '/register'} className="btn-primary flex-1 justify-center">
              {signedIn ? 'Open the studio' : 'Start free'}
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}



/* ── Hero ──────────────────────────────────────────────────────────────── */

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative overflow-hidden">
      {/*
        Two soft washes of the brand colour behind the hero, drifting slowly.
        On a white page this is the only place colour is allowed to be purely
        atmospheric, and it stays under 12 % so type never fights it.
      */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="nv-drift absolute -left-40 -top-52 h-[38rem] w-[38rem] rounded-full bg-primary/10 blur-3xl" />
        <div
          className="nv-drift absolute -right-52 top-24 h-[34rem] w-[34rem] rounded-full bg-info/10 blur-3xl"
          style={{ animationDelay: '-6s' }}
        />
        <div className="nv-grid-bg absolute inset-0 opacity-[0.55] [mask-image:radial-gradient(ellipse_at_center,#000_20%,transparent_72%)]" />
      </div>

      <div className="relative mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:pb-24 lg:pt-20">
        <div>
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-semibold text-ink-muted shadow-xs">
              <span className="flex h-1.5 w-1.5 rounded-full bg-success" />
              Eighteen asset libraries, searched live
            </span>
          </Reveal>

          <Reveal delay={70}>
            <h1 className="mt-5 text-balance text-4xl font-black leading-[1.03] tracking-tight text-ink sm:text-5xl lg:text-6xl">
              Design the event.
              <br />
              <span className="text-primary">Price it as you draw.</span>
            </h1>
          </Reveal>

          <Reveal delay={140}>
            <p className="mt-5 max-w-lg text-pretty text-base leading-relaxed text-ink-muted sm:text-lg">
              Novira is a 3D studio for events, exhibitions and stages. Lay out a room in real
              millimetres, drag in a chair from any library in the world, drop a material onto the
              exact surface you want it on — and watch the quantities, the costs and the safety
              checks keep up as you work.
            </p>
          </Reveal>

          <Reveal delay={210}>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to={signedIn ? '/dashboard' : '/register'} className="btn-primary btn-lg shadow-glow">
                {signedIn ? 'Open the studio' : 'Start designing free'} <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#how" className="btn-secondary btn-lg">
                <Play className="h-4 w-4" /> See how it works
              </a>
            </div>
          </Reveal>

          <Reveal delay={280}>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-subtle">
              {['No card to start', 'Runs in the browser', 'Exports CAD your workshop can build from'].map(
                (item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-success" />
                    {item}
                  </li>
                )
              )}
            </ul>
          </Reveal>
        </div>

        <Reveal delay={120}>
          <div className="relative">
            <div className="overflow-hidden rounded-3xl border border-line bg-gradient-to-b from-surface to-bg-soft shadow-modal">
              <HeroScene className="aspect-[4/3] w-full" />
            </div>

            {/*
              Two floating chips over the render. They are the two things that
              make this a tool rather than a picture: it is measured, and it is
              already priced.
            */}
            <div className="pointer-events-none absolute -left-3 bottom-8 hidden sm:block">
              <div className="nv-rise rounded-xl border border-line bg-surface px-3 py-2 shadow-pop">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Screen</p>
                <p className="text-sm font-bold tabular-nums text-ink">4 800 × 2 400 mm</p>
                <p className="text-[10px] text-ink-subtle">32 cabinets · 11.5 m²</p>
              </div>
            </div>
            <div className="pointer-events-none absolute -right-3 top-10 hidden sm:block">
              <div className="nv-rise rounded-xl border border-line bg-surface px-3 py-2 shadow-pop" style={{ animationDelay: '160ms' }}>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Running total</p>
                <p className="text-sm font-bold tabular-nums text-ink">£18 420</p>
                <p className="flex items-center gap-1 text-[10px] text-success">
                  <ShieldCheck className="h-3 w-3" /> All checks pass
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Sources ───────────────────────────────────────────────────────────── */

function SourceStrip() {
  return (
    <section className="border-y border-line bg-bg-soft py-6">
      <div className="mx-auto max-w-6xl px-5">
        <p className="mb-4 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
          One search box. Every library.
        </p>
        <Marquee items={SOURCES} />
      </div>
    </section>
  );
}

/* ── Workflow ──────────────────────────────────────────────────────────── */

const STEPS = [
  {
    icon: Boxes,
    title: 'Find it',
    body: 'Search a measured catalogue and eighteen public libraries at once. Scroll for as long as you like — the next page is already loading before you reach the bottom.',
    slot: 'step-find',
    alt: 'The library panel, mid-search, with a model being dragged into the plan',
  },
  {
    icon: Layers,
    title: 'Build it',
    body: 'Staging, truss, LED and stands are specified rather than picked. Type a span and the parts list, the weight, the power draw and the truck count all follow.',
    slot: 'step-build',
    alt: 'A stage with truss and an LED wall being built to size in the studio',
  },
  {
    icon: Brush,
    title: 'Finish it',
    body: 'Drag a material onto a surface and it lands on that part — the seat, not the whole chair. Tiling is in millimetres, so a 300 mm tile is 300 mm on anything.',
    slot: 'step-finish',
    alt: 'A material being dropped onto one part of an object in the 3D view',
  },
  {
    icon: Calculator,
    title: 'Cost it',
    body: 'Every square metre of LED, every metre of truss, every hour of labour, measured from the drawing itself and priced against your own rate card.',
    slot: 'step-cost',
    alt: 'The cost panel showing measured quantities and a priced bill',
  },
  {
    icon: ShieldCheck,
    title: 'Check it',
    body: 'Fire exits, sightlines, screen distances, aisle widths and step-free access, against the rules for your market. Every finding names the rule it applied.',
    slot: 'step-check',
    alt: 'The compliance panel showing findings against market rules',
  },
  {
    icon: Presentation,
    title: 'Send it',
    body: 'A render, a walkthrough, a dimensioned drawing, a DXF for the workshop, a bill of quantities and a client deck — all generated from the same plan, so all six agree.',
    slot: 'step-send',
    alt: 'Exported deliverables: a render, a technical drawing and a client deck',
  },
];

function WorkflowSection() {
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 lg:py-28">
      <Reveal>
        <SectionHeading
          eyebrow="How it works"
          title="Six steps, and the last five come free with the first."
          lead="Everything downstream is derived from the drawing. Move a screen and the quantities, the costs, the sightline check and the client deck all move with it — because none of them is a separate document."
        />
      </Reveal>

      <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <Reveal key={step.title} delay={index * 60} as="li">
              <TiltCard className="h-full">
                <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xs transition hover:shadow-card">
                  <Figure slot={step.slot} alt={step.alt} ratio="16 / 10" rounded="rounded-none" className="border-0 border-b" />
                  <div className="flex flex-1 flex-col p-5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <h3 className="mt-3 flex items-baseline gap-2 text-base font-bold text-ink">
                      <span className="text-xs font-black tabular-nums text-primary">{index + 1}</span>
                      {step.title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{step.body}</p>
                  </div>
                </article>
              </TiltCard>
            </Reveal>
          );
        })}
      </ol>
    </section>
  );
}

/* ── Libraries ─────────────────────────────────────────────────────────── */

function LibrarySection() {
  return (
    <section id="libraries" className="scroll-mt-20 border-y border-line bg-bg-soft py-20 lg:py-28">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 lg:grid-cols-2 lg:items-center">
        <Reveal>
          <SectionHeading
            eyebrow="The library"
            title="You are not limited to what we happen to own."
            lead="Novira searches its own measured catalogue and eighteen public libraries in one pass, merges them into a single ranked list, and pages through it endlessly. Drag anything into the plan and it is downloaded, measured and added to your library — so it still opens in a year."
          />

          <ul className="mt-7 space-y-3">
            {[
              ['Infinite scroll that never stalls', 'The next page is fetched while a screenful is still left to read, so the grid does not stop moving.'],
              ['Warm before you ask', 'The shelves you are most likely to open next are fetched quietly in the background while you browse.'],
              ['Honest about access', 'A model that needs an account on the source site says so on the card, before you drag it — not after.'],
              ['Measured on import', 'The file is opened and its real width, depth and height written down, so it can be costed and checked.'],
            ].map(([title, body], index) => (
              <Reveal key={title} delay={index * 60} as="li">
                <div className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
                    <Check className="h-3 w-3" />
                  </span>
                  <p className="text-sm leading-relaxed text-ink-muted">
                    <strong className="font-semibold text-ink">{title}.</strong> {body}
                  </p>
                </div>
              </Reveal>
            ))}
          </ul>
        </Reveal>

        {/*
          Two pictures, overlapped, rather than a grid of three.
          
          The models shot is the subject and gets the space; the environment
          sphere is the supporting note and sits on the corner of it. A row of
          equal thumbnails underneath would have given three images the same
          weight when only one of them is what the section is about.
        */}
        <Reveal delay={100}>
          <div className="relative pb-12 pr-6 sm:pb-16 sm:pr-12">
            <Figure
              slot="library-grid"
              alt="The Novira library panel, a dense grid of 3D models mid-scroll"
              ratio="4 / 3"
              className="shadow-card"
            />
            <div className="absolute bottom-0 right-0 w-36 sm:w-48">
              <Figure
                slot="library-hdri"
                alt="Environment maps: studio, warehouse and golden hour"
                ratio="1 / 1"
                className="shadow-panel ring-4 ring-bg"
              />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Materials ─────────────────────────────────────────────────────────── */

function MaterialSection() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 lg:py-28">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
        <Reveal className="lg:order-2">
          <SectionHeading
            eyebrow="Materials"
            title="Drop it on the part you meant."
            lead="A reception counter has a laminate top, a painted body and a metal kick. Painting the whole thing one colour is what a toy does. In Novira a finish lands on the surface you dropped it on, and every part keeps its own — on catalogue models, on truss, on stands, on walls, on the floor."
          />
          <dl className="mt-7 grid gap-4 sm:grid-cols-2">
            {[
              ['Tiled in millimetres', 'A 300 mm tile is 300 mm on a side table and on a 40 m backwall. Resize the object and the material does not stretch.'],
              ['Every object type', 'Catalogue models, procedural staging, truss, stands, drape, walls and the floor of the room itself.'],
              ['Priced by area', 'A specified finish is measured and costed with everything else, at your own rates.'],
              ['Seventy included', 'Ply, laminate, brushed steel, terrazzo, velvet, event carpet — plus thousands of scanned surfaces online.'],
            ].map(([title, body], index) => (
              <Reveal key={title} delay={index * 60}>
                <div>
                  <dt className="text-sm font-bold text-ink">{title}</dt>
                  <dd className="mt-1 text-[13px] leading-relaxed text-ink-muted">{body}</dd>
                </div>
              </Reveal>
            ))}
          </dl>
        </Reveal>

        <Reveal delay={100} className="lg:order-1">
          {/*
            Portrait, matching the photograph rather than cropping it. The shot
            is a chair with a fan of swatches on the floor beside it; squeezing
            it into a landscape band throws the swatches away, and they are the
            half of the picture this section is about.
          */}
          <Figure
            slot="materials-drop"
            alt="A material being dragged onto the seat of a chair, with the surface highlighted"
            ratio="4 / 5"
            className="mx-auto max-w-sm shadow-card lg:max-w-none"
          />
        </Reveal>
      </div>
    </section>
  );
}

/* ── Numbers ───────────────────────────────────────────────────────────── */

function NumbersSection() {
  return (
    <section className="border-y border-line bg-primary py-16 text-primary-fg">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <h2 className="max-w-2xl text-balance text-2xl font-black leading-tight tracking-tight sm:text-3xl">
            Everything in Novira is a number somebody can check.
          </h2>
        </Reveal>
        <div className="mt-10 [&_dt]:text-primary-fg [&_dd]:text-primary-fg/75">
          <StatRow
            items={[
              { value: '18', label: 'Asset libraries searched in one pass' },
              { value: '1 mm', label: 'Everything stored as integer millimetres' },
              { value: '6', label: 'Market rule sets for safety and compliance' },
              { value: '5', label: 'Deliverables generated from one plan' },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

/* ── Deliverables ──────────────────────────────────────────────────────── */

function DeliverableSection() {
  const items = [
    { icon: Presentation, title: 'Client deck', body: 'Fourteen slide types, laid out from the plan and your branding.' },
    { icon: FileDown, title: 'CAD (DXF)', body: 'R12 ASCII in millimetres. Opens in AutoCAD, Vectorworks and most CAM software.' },
    { icon: Calculator, title: 'Bill of quantities', body: 'Measured from the drawing, priced against your rate card, exported to a spreadsheet.' },
    { icon: Sparkles, title: 'Renders', body: 'Free instant frames at any size, or a photoreal pass that keeps your geometry exactly.' },
    { icon: Play, title: 'Walkthrough video', body: 'A camera path through the space, rendered to a file you can send.' },
    { icon: MessageSquare, title: 'A share link', body: 'A client opens it in a browser, walks the space and comments in place. No account needed.' },
  ];

  return (
    <section id="deliverables" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 lg:py-28">
      <Reveal>
        <SectionHeading
          align="center"
          eyebrow="What you get"
          title="Six documents, one drawing, and no chance of disagreement."
          lead="A technical drawing that contradicts the bill of quantities is worse than having neither. Everything Novira produces is generated from the same plan at the same moment, so they cannot drift."
        />
      </Reveal>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <Reveal key={item.title} delay={index * 55}>
              <div className="flex h-full gap-3.5 rounded-2xl border border-line bg-surface p-5 shadow-xs transition hover:-translate-y-0.5 hover:shadow-card">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-ink">{item.title}</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{item.body}</p>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>

      <Reveal delay={120}>
        <div className="mt-10">
          <Figure
            slot="deliverables-spread"
            alt="A printed spread: a dimensioned plan, a bill of quantities and a client deck"
            ratio="21 / 9"
            className="shadow-card"
          />
        </div>
      </Reveal>
    </section>
  );
}

/* ── Audience ──────────────────────────────────────────────────────────── */

function AudienceSection() {
  const audiences = [
    {
      slot: 'who-agency',
      title: 'Event agencies',
      body: 'Win the pitch with a walkthrough, then hand the same file to production with a bill of quantities attached.',
      alt: 'An agency team reviewing a 3D event design on a large screen',
    },
    {
      slot: 'who-exhibition',
      title: 'Exhibition contractors',
      body: 'Stands at real module sizes, drawn to the organiser’s height limit, with a cutting list a workshop can work from.',
      alt: 'An exhibition stand under construction on a trade show floor',
    },
    {
      slot: 'who-venue',
      title: 'Venues and hotels',
      body: 'Publish your rooms once, with their rigging points and capacities, and let every client lay out their own event correctly.',
      alt: 'An empty ballroom with rigging points and a set-up crew',
    },
  ];

  return (
    <section id="who" className="scroll-mt-20 border-t border-line bg-bg-soft py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <SectionHeading
            eyebrow="Who it is for"
            title="Anyone who has to explain a room before it exists."
          />
        </Reveal>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {audiences.map((audience, index) => (
            <Reveal key={audience.title} delay={index * 80}>
              <article className="group overflow-hidden rounded-2xl border border-line bg-surface shadow-xs transition hover:shadow-card">
                <Figure
                  slot={audience.slot}
                  alt={audience.alt}
                  ratio="4 / 3"
                  rounded="rounded-none"
                  className="border-0 border-b"
                />
                <div className="p-5">
                  <h3 className="text-base font-bold text-ink">{audience.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{audience.body}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Close ─────────────────────────────────────────────────────────────── */

function ClosingSection({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative overflow-hidden py-20 lg:py-28">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="nv-drift absolute left-1/2 top-0 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-3xl px-5 text-center">
        <Reveal>
          <h2 className="text-balance text-3xl font-black leading-tight tracking-tight text-ink sm:text-4xl">
            Draw the room. Novira does the rest of the paperwork.
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-ink-muted">
            Start with a blank floor, a saved hall or a photograph of the venue. There is nothing to install and
            nothing to configure before it is useful.
          </p>
        </Reveal>
        <Reveal delay={150}>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to={signedIn ? '/dashboard' : '/register'} className="btn-primary btn-lg shadow-glow">
              {signedIn ? 'Open the studio' : 'Start designing free'} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/login" className="btn-secondary btn-lg">
              Sign in
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-line bg-bg-soft py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Wordmark size={32} text="text-[17px]" />
          <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-ink-subtle">
            The spatial design platform for events, exhibitions and stages.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
          {[
            { to: '/login', label: 'Sign in' },
            { to: '/register', label: 'Create an account' },
            { to: '/help', label: 'Help' },
            { to: '/marketplace', label: 'Marketplace' },
            { to: '/specialists', label: 'Specialists' },
          ].map((link) => (
            <Link key={link.to} to={link.to} className="font-semibold text-ink-muted transition hover:text-primary">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <p className="mx-auto mt-8 max-w-6xl px-5 text-[11px] text-ink-subtle">
        Asset previews are served from their own libraries and remain under their own licences, which are shown on
        every result.
      </p>
    </footer>
  );
}
