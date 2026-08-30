import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Accessibility,
  Box,
  Calculator,
  Contrast,
  Hammer,
  Keyboard,
  Lightbulb,
  MapPin,
  MessageSquare,
  Monitor,
  Presentation,
  Search,
  ShieldCheck,
  Sparkles,
  Type,
} from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { PageBanner } from '../components/PageBanner';
import { usePreferences, type Density, type TextSize } from '../store/preferences';
import { Segmented, Toggle } from '../components/ui';

/**
 * Help.
 *
 * Written for someone who has never used a 3D tool, because that is who the
 * brief is about. Two rules held throughout:
 *
 * **No jargon without a definition on the same line.** "Trim height" is not a
 * phrase to look up elsewhere.
 *
 * **Every answer says where to go, not just what exists.** "The estimator
 * measures LED area" is useless without "it is under Cost in the left rail".
 */
export function HelpPage() {
  const [query, setQuery] = useState('');

  // Deep links from elsewhere in the product — the command palette sends people
  // to /help#shortcuts, and that has to land on the shortcuts.
  useEffect(() => {
    if (window.location.hash) {
      const element = document.getElementById(window.location.hash.slice(1));
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const matches = (text: string) => !query || text.toLowerCase().includes(query.toLowerCase());

  return (
    <AppShell>
      <PageBanner
        slot="help-hero"
        title="How Novira works"
        lead={
          <>
            You do not need to have used a 3D tool before. The studio has nine sections down the left, each named for
            what you are doing rather than for what it is called in the trade — and you can reach any of them by
            pressing <kbd className="rounded border border-line px-1 font-mono text-[11px]">Ctrl</kbd>{' '}
            <kbd className="rounded border border-line px-1 font-mono text-[11px]">K</kbd> and typing a word.
          </>
        }
      />

      <div className="mb-6 max-w-md">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
          <input
            className="input pl-9"
            placeholder="Search this page…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search help"
          />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-8">
          {SECTIONS.filter((section) =>
            matches(section.title) || section.items.some((item) => matches(`${item.q} ${item.a}`))
          ).map((section) => (
            <section key={section.title} id={section.id}>
              <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
                {section.icon}
                {section.title}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">{section.intro}</p>

              <dl className="mt-3 space-y-3">
                {section.items
                  .filter((item) => matches(`${item.q} ${item.a}`))
                  .map((item) => (
                    <div key={item.q} className="card">
                      <dt className="text-sm font-semibold text-ink">{item.q}</dt>
                      <dd className="mt-1 text-sm leading-relaxed text-ink-muted">{item.a}</dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}

          <section id="shortcuts">
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
              <Keyboard className="h-5 w-5" />
              Keyboard shortcuts
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              The number keys are worth learning first — they move between the nine sections without your hand leaving
              the model.
            </p>

            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.title}>
                  <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-subtle">{group.title}</h3>
                  <dl className="space-y-1">
                    {group.items.map((item) => (
                      <div key={item.keys} className="flex items-baseline justify-between gap-3 text-sm">
                        <dt className="text-ink-muted">{item.does}</dt>
                        <dd className="shrink-0">
                          {item.keys.split(' ').map((key) => (
                            <kbd key={key} className="ml-1 rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-ink">
                              {key}
                            </kbd>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <div className="panel p-4">
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
              <Accessibility className="h-4 w-4" /> Make it easier to use
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              These are saved on this device, so a laptop in a dim venue can be set differently from a studio monitor.
            </p>
            <div className="mt-3">
              <AccessibilitySettings />
            </div>
          </div>

          <div className="panel p-4">
            <h2 className="text-sm font-bold text-ink">If you are stuck</h2>
            <ul className="mt-2 space-y-2 text-sm text-ink-muted">
              <li>
                Press <kbd className="rounded border border-line px-1 font-mono text-[11px]">Ctrl</kbd>{' '}
                <kbd className="rounded border border-line px-1 font-mono text-[11px]">K</kbd> and type what you want to
                do in plain words — "how much does this cost", "video", "safety".
              </li>
              <li>
                Press <kbd className="rounded border border-line px-1 font-mono text-[11px]">F</kbd> if you have lost the
                model. It pulls the camera back until everything is on screen.
              </li>
              <li>
                <kbd className="rounded border border-line px-1 font-mono text-[11px]">Ctrl</kbd>{' '}
                <kbd className="rounded border border-line px-1 font-mono text-[11px]">Z</kbd> undoes anything, including
                a whole generated layout.
              </li>
              <li>
                Every question-mark icon beside a control explains what that control does and what a sensible value is.
              </li>
            </ul>
          </div>

          <div className="panel p-4">
            <h2 className="text-sm font-bold text-ink">Elsewhere</h2>
            <ul className="mt-2 space-y-1.5 text-sm">
              <li>
                <Link to="/venues" className="text-primary hover:underline">
                  Venue library
                </Link>{' '}
                — record a building once
              </li>
              <li>
                <Link to="/rate-cards" className="text-primary hover:underline">
                  Your rates
                </Link>{' '}
                — what estimates are priced against
              </li>
              <li>
                <Link to="/insights" className="text-primary hover:underline">
                  Insights
                </Link>{' '}
                — which layouts win, and an ROI model
              </li>
              <li>
                <Link to="/marketplace" className="text-primary hover:underline">
                  Marketplace
                </Link>{' '}
                — buy and sell templates and packs
              </li>
              <li>
                <Link to="/specialists" className="text-primary hover:underline">
                  Specialists
                </Link>{' '}
                — hire help, with the plan attached
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function AccessibilitySettings() {
  const density = usePreferences((s) => s.density);
  const contrast = usePreferences((s) => s.contrast);
  const textSize = usePreferences((s) => s.textSize);
  const showHints = usePreferences((s) => s.showHints);
  const set = usePreferences((s) => s.set);
  const reset = usePreferences((s) => s.reset);
  const setTour = usePreferences((s) => s.set);

  return (
    <>
      <Segmented
        label="Text size"
        value={textSize}
        columns={3}
        options={[
          { value: 'normal', label: 'Normal' },
          { value: 'large', label: 'Large' },
          { value: 'larger', label: 'Largest' },
        ]}
        onChange={(value) => set('textSize', value as TextSize)}
      />

      <Segmented
        label="Spacing"
        value={density}
        columns={2}
        options={[
          { value: 'compact', label: 'Compact', hint: 'More on screen at once.' },
          { value: 'comfortable', label: 'Comfortable', hint: 'Bigger targets, easier to hit.' },
        ]}
        onChange={(value) => set('density', value as Density)}
      />

      <Toggle
        label="High contrast"
        checked={contrast === 'high'}
        onChange={(on) => set('contrast', on ? 'high' : 'normal')}
        hint="Strengthens borders and the text that would otherwise be grey."
      />

      <Toggle
        label="Show explanations"
        checked={showHints}
        onChange={(on) => set('showHints', on)}
        hint="The one-line notes under each control. Turn them off once you know your way around."
      />

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" className="btn-secondary btn-sm" onClick={() => setTour('tourCompleted', false)}>
          Run the tour again
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={reset}>
          Reset to defaults
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-ink-subtle">
        <Contrast className="mr-1 inline h-3 w-3" />
        Novira also follows your system's "reduce motion" setting — every animation here is decorative, so all of them
        stop when you ask for that.
        <Type className="ml-2 mr-1 inline h-3 w-3" />
        Dark and light follow your account setting under Account.
      </p>
    </>
  );
}

/* ── Content ───────────────────────────────────────────────────────────── */

const SECTIONS: Array<{
  id: string;
  title: string;
  intro: string;
  icon: JSX.Element;
  items: Array<{ q: string; a: string }>;
}> = [
  {
    id: 'basics',
    title: 'Moving around',
    intro: 'The 3D view is the whole product. Three gestures cover it.',
    icon: <Box className="h-5 w-5" />,
    items: [
      {
        q: 'How do I look around?',
        a: 'Drag with the left mouse button to orbit, drag with the right to slide the view sideways, and scroll to zoom in and out. On a trackpad, two fingers scroll and zoom.',
      },
      {
        q: 'I have lost the model — where did it go?',
        a: 'Press F. It pulls the camera back until everything in the plan is on screen. There is also a Fit button along the bottom bar.',
      },
      {
        q: 'What is the difference between Plan and 3D?',
        a: 'Plan looks straight down and is the right view for laying out a floor — distances read true and nothing hides behind anything. 3D is the perspective view you show a client. Press T and P to switch, or use the buttons at the bottom left.',
      },
      {
        q: 'How do I put something in the room?',
        a: 'Open Add in the left rail, find the item, click it once, then click the floor where you want it. Press Escape if you change your mind before placing it.',
      },
      {
        q: 'How do I move or rotate something?',
        a: 'Click it, then use the arrows that appear. The bar above the model switches between Move, Rotate and Scale, or press G, R and E. Rotation is deliberately limited to turning on the spot, because furniture in a room does not tip over.',
      },
    ],
  },
  {
    id: 'build',
    title: 'Building things to size',
    intro: 'Anything you specify rather than hire: staging, truss, screens, stands, tents and drapes.',
    icon: <Hammer className="h-5 w-5" />,
    items: [
      {
        q: 'What is the difference between Add and Build?',
        a: 'Add places things you hire — a chair is 450 mm wide because it was measured. Build makes things to a size you choose, and derives the parts list, weight and power as you change it. A truss run is Build; a truss-shaped 3D model would be Add.',
      },
      {
        q: 'What is "trim height"?',
        a: 'The height to the underside of a horizontal truss run. It is what a rigger means by trim, and everything hung from the truss starts there.',
      },
      {
        q: 'Why does it say my truss span is too long?',
        a: 'Every truss section has a published limit for how far it can go between supports. If the run is longer than that, the design is not buildable as drawn — add a support, or step up to a heavier section. The warning names the limit it applied.',
      },
      {
        q: 'Why did my 10 metre screen become 10.5 metres?',
        a: 'LED walls are built from whole cabinets, so a target size is fitted to the cabinet grid and the panel tells you what was actually built. Rounding silently would give you a plan promising a width the hardware cannot make.',
      },
      {
        q: 'What is pixel pitch?',
        a: 'The distance between LEDs, in millimetres. Smaller is sharper and more expensive, and it only matters if people stand close enough to tell — the rule of thumb is that the comfortable minimum viewing distance in metres is roughly the pitch in millimetres.',
      },
      {
        q: 'Can I lay out a whole exhibition floor at once?',
        a: 'Yes. In Build, choose Stands, then "A whole floor". Set how many across and deep, the aisle width, and whether rows go back to back — one aisle then serves two rows, which is how every hall plan is set out.',
      },
    ],
  },
  {
    id: 'site',
    title: 'The building',
    intro: 'The limits the design has to live inside. Getting these in early is what stops a rebuild on site.',
    icon: <MapPin className="h-5 w-5" />,
    items: [
      {
        q: 'What is the fastest way to set the site up?',
        a: 'Pick a venue from the library in the Site panel. Its clear height, pillars, rigging capacity, power points and truck route all arrive at once as real geometry, and everything you build afterwards is checked against them.',
      },
      {
        q: 'What is "clear height"?',
        a: 'The height under the lowest obstruction — a beam, a duct, a light — not the height at the ridge. It is the figure venues quote least accurately and the one everything depends on.',
      },
      {
        q: 'Why does the market setting matter?',
        a: 'It decides which truss sections are offered, which materials are locally available, what voltage the power figures assume, and which safety rules the check applies. A stand built to UK rules is not automatically legal at a US show, and the booth module sizes are different too.',
      },
      {
        q: 'I do not know the venue figures yet.',
        a: 'Record what you have and leave the rest. The check will tell you what it could not verify rather than pretending everything is fine — "no rigging points marked" is a more useful warning than silence.',
      },
    ],
  },
  {
    id: 'light',
    title: 'Lighting',
    intro: 'What separates a plan that looks like a plan from one that looks like the event.',
    icon: <Lightbulb className="h-5 w-5" />,
    items: [
      {
        q: 'What does "Light this scene" actually do?',
        a: 'It finds the stage, the screens and the tables, and rigs a key light on the subject, a fill to soften the shadow, a back light to separate people from the backdrop, a wash for the room and accents on anything worth picking out. Fixtures you placed by hand are kept.',
      },
      {
        q: 'What is a "look"?',
        a: 'A complete relationship between the key, fill, back light and the room — colours, contrast, haze and ambient level together. Changing one colour without the others is what makes lighting look amateur, so the looks change all of them at once.',
      },
      {
        q: 'Why can I not see any beams?',
        a: 'Beams are invisible without haze in the air. Raise Haze in the Light panel — and check whether the venue actually allows it, because plenty do not.',
      },
      {
        q: 'What is a gobo?',
        a: 'A pattern cut into metal or glass that a fixture projects. It is the cheapest way to make a bare wall look designed, and a client logo can be cut as one.',
      },
    ],
  },
  {
    id: 'cost',
    title: 'Cost',
    intro: 'Measured from the drawing, not estimated. This is the part that removes the most work.',
    icon: <Calculator className="h-5 w-5" />,
    items: [
      {
        q: 'Where do the quantities come from?',
        a: 'The geometry. LED area is cabinets times cabinet size, truss length follows the path, carpet is the floor less what stands on it. Click any line in the Cost panel and it shows exactly how that figure was arrived at.',
      },
      {
        q: 'Where do the prices come from?',
        a: 'A rate card. Until you make one, estimates use Novira’s built-in mid-market rates adjusted for the plan’s region, and every line is marked as indicative. Enter your own rates once and every estimate after that uses them.',
      },
      {
        q: 'Can I give a production team the quantities without the prices?',
        a: 'Yes — turn "Show prices" off in the Cost panel, or export the bill of quantities without them.',
      },
      {
        q: 'What is a "basis"?',
        a: 'The sentence under each measured line explaining how it was derived. A number nobody can trace is a number they will re-measure by hand anyway, at which point the feature has saved nothing.',
      },
    ],
  },
  {
    id: 'check',
    title: 'Safety and buildability',
    intro: 'Rules a planner would otherwise apply from memory, applied to the layout as drawn.',
    icon: <ShieldCheck className="h-5 w-5" />,
    items: [
      {
        q: 'What does it check?',
        a: 'Escape widths and travel distances, sightlines to the stage, screen distances and angles, aisle and gangway widths, crowd density, step-free access, floor loading and rigging capacity.',
      },
      {
        q: 'Is this a legal sign-off?',
        a: 'No, and it never claims to be. It is an automated check against published rules of thumb and the figures you recorded for the venue. Every finding names the rule it applied so you can check it against your own jurisdiction. The venue and the local authority still sign off.',
      },
      {
        q: 'What is the score?',
        a: 'A blunt number so you can watch it move while you fix things. Errors cost twelve points, warnings five, suggestions one. It is not a measure of design quality.',
      },
    ],
  },
  {
    id: 'ai',
    title: 'The AI features',
    intro: 'Where a model is used, what it is used for, and what it is deliberately not allowed to do.',
    icon: <Sparkles className="h-5 w-5" />,
    items: [
      {
        q: 'How does "generate a layout from a description" work?',
        a: 'The model reads your sentence into a structured brief — event type, size, seating, screens, truss. Everything after that is arithmetic. That is why the stage is exactly the size it says, and why the same brief always produces the same room.',
      },
      {
        q: 'Do I need credits to try it?',
        a: 'No. A preview appears as you type, free and instant, read by a built-in parser. Running it through the language model only helps with looser wording.',
      },
      {
        q: 'Is a Pro Render a real lighting simulation?',
        a: 'No, and this matters if a client asks. The layout is exact, because the frame comes from your plan. The realism is generated by an image model told to preserve the geometry and improve only materials and light. It is not physically accurate ray tracing.',
      },
      {
        q: 'What happens if an AI run fails?',
        a: 'Your credits are returned automatically. The same applies if you cancel it part way through.',
      },
      {
        q: 'What does the photo analysis do?',
        a: 'It identifies what is in a photograph of a space, estimates the room size, and matches what it saw against your catalogue — so what gets placed is a measured model rather than a reconstruction of unknown scale.',
      },
    ],
  },
  {
    id: 'present',
    title: 'Sending it out',
    intro: 'Everything that leaves the product, generated from the one plan.',
    icon: <Presentation className="h-5 w-5" />,
    items: [
      {
        q: 'How do I get a 4K image?',
        a: 'Present, then Images, then choose 4K and press Render. It is free and takes a second. If your graphics cannot allocate that size it renders as large as it can and tells you.',
      },
      {
        q: 'How do I make a walkthrough video?',
        a: 'Present, then Video. Pick a style and press Generate — the camera moves are worked out from your plan’s actual size. Adjust any shot, then export. Frames are rendered here and encoded on the server, which is why the video matches the preview exactly.',
      },
      {
        q: 'What file does a workshop need?',
        a: 'The DXF, under Present then Documents. It is real CAD geometry on named layers in millimetres, written in the revision every CAD and CAM system reads.',
      },
      {
        q: 'What is in the client deck?',
        a: 'Cover, concept, renders, the layout plan, a specification, the bill of quantities, commercials, a schedule and the compliance summary — all generated from this plan, and every slide editable before it goes out.',
      },
    ],
  },
  {
    id: 'review',
    title: 'Feedback and versions',
    intro: 'What replaces a thread of screenshots with arrows drawn on them.',
    icon: <MessageSquare className="h-5 w-5" />,
    items: [
      {
        q: 'How does a client comment on the plan?',
        a: 'Share a view-only link. They can leave comments pinned to whatever they were looking at, and reply to yours. No account needed.',
      },
      {
        q: 'What is an internal note?',
        a: 'A comment only your team can see. It never appears on a shared link — that is enforced when the comments are loaded, not hidden afterwards.',
      },
      {
        q: 'Can I compare two options?',
        a: 'Yes. Save each one as a version, then use Compare. Objects are matched by identity, so a table that moved reads as one change rather than as a deletion and an addition.',
      },
      {
        q: 'Is restoring an old version safe?',
        a: 'Yes. The current layout is always saved as a version first, automatically, so going back never loses anything.',
      },
    ],
  },
  {
    id: 'screens',
    title: 'Screens and sightlines',
    intro: 'The rules that decide whether an audience can actually see what you have put in front of them.',
    icon: <Monitor className="h-5 w-5" />,
    items: [
      {
        q: 'How far should the front row be from the screen?',
        a: 'At least twice the screen height. Closer than that and people crane to see the top.',
      },
      {
        q: 'How far is too far?',
        a: 'Beyond about eight screen heights, text on the screen stops being readable. The check flags it and suggests either a taller screen or a delay screen further back.',
      },
      {
        q: 'How high should the bottom of the screen be?',
        a: 'At least 1.2 m on a flat floor, and higher for a long room — otherwise everyone past the third row is looking at the back of the heads in front of them.',
      },
    ],
  },
];

const SHORTCUT_GROUPS: Array<{ title: string; items: Array<{ keys: string; does: string }> }> = [
  {
    title: 'Getting around',
    items: [
      { keys: 'Ctrl K', does: 'Search every feature by name' },
      { keys: '1 – 0', does: 'Jump to a section in the left rail' },
      { keys: 'F', does: 'Fit everything on screen' },
      { keys: 'T', does: 'Look straight down' },
      { keys: 'P', does: 'Perspective view' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: 'G', does: 'Move' },
      { keys: 'R', does: 'Rotate' },
      { keys: 'E', does: 'Scale' },
      { keys: 'L', does: 'Lock or unlock' },
      { keys: 'Del', does: 'Delete the selection' },
      { keys: 'Esc', does: 'Cancel, or deselect' },
    ],
  },
  {
    title: 'The document',
    items: [
      { keys: 'Ctrl S', does: 'Save' },
      { keys: 'Ctrl Z', does: 'Undo' },
      { keys: 'Ctrl Shift Z', does: 'Redo' },
      { keys: 'Ctrl D', does: 'Duplicate' },
    ],
  },
  {
    title: 'Drawing and playback',
    items: [
      { keys: 'S', does: 'Snap to the grid on or off' },
      { keys: 'Enter', does: 'Finish the shape you are drawing' },
      { keys: 'Space', does: 'Play or pause the walkthrough' },
    ],
  },
];
