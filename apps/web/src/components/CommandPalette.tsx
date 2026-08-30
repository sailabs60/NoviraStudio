import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Building2,
  Calculator,
  Command,
  CreditCard,
  Frame,
  Hammer,
  HelpCircle,
  Keyboard,
  LayoutGrid,
  Lightbulb,
  MapPin,
  MessageSquare,
  Monitor,
  Package,
  Presentation,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useAssistant } from '../editor/assistantStore';
import { useEditor } from '../editor/editorStore';
import { createBooth, createLedScreen, createLight, createTruss } from '../editor/factories';

/**
 * The command palette.
 *
 * Every feature in the product is reachable by typing a word for it. That
 * matters most for exactly the people the brief is about — someone who has
 * never used the product does not know where "bill of quantities" lives, but
 * they do know to type it.
 *
 * Two rules keep it useful rather than decorative:
 *
 * **Every command says what it does**, not just its name. A list of verbs with
 * no explanation is a list you have to already understand.
 *
 * **Matching is on the description as well as the title.** Someone searching
 * "how much does this cost" should find the estimator even though the word
 * "cost" is the only overlap.
 */

export interface Command {
  id: string;
  title: string;
  description: string;
  group: string;
  icon: ReactNode;
  /** Extra words that should match this command. */
  keywords?: string;
  shortcut?: string;
  run: () => void;
  /** Hidden when this returns false — commands that need an open plan. */
  available?: () => boolean;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useCommands(navigate, onClose);

  const filtered = useMemo(() => {
    const available = commands.filter((command) => !command.available || command.available());
    const q = query.trim().toLowerCase();
    if (!q) return available;

    const terms = q.split(/\s+/);
    return available
      .map((command) => {
        const haystack = `${command.title} ${command.description} ${command.group} ${command.keywords ?? ''}`.toLowerCase();
        // Every term must appear somewhere, and a title hit ranks above a
        // description hit — otherwise "cost" surfaces six panels that mention
        // it in passing before the estimator itself.
        if (!terms.every((term) => haystack.includes(term))) return null;
        const titleHits = terms.filter((term) => command.title.toLowerCase().includes(term)).length;
        return { command, score: titleHits * 10 + (command.title.toLowerCase().startsWith(q) ? 5 : 0) };
      })
      .filter(Boolean)
      .sort((a, b) => b!.score - a!.score)
      .map((entry) => entry!.command);
  }, [commands, query]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      // A frame, so the input exists before focus is asked for.
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;

  const grouped = filtered.reduce<Record<string, Command[]>>((acc, command) => {
    (acc[command.group] ??= []).push(command);
    return acc;
  }, {});

  let running = -1;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm" />

      <div role="dialog" aria-modal="true" aria-label="Command palette" className="panel relative w-full max-w-xl overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-subtle" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
            placeholder="What do you want to do?"
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={filtered[index] ? `command-${filtered[index].id}` : undefined}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const command = filtered[index];
                if (command) {
                  command.run();
                  onClose();
                }
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
          />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-subtle sm:block">Esc</kbd>
        </div>

        <div ref={listRef} id="command-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-muted">
              Nothing matches “{query}”. Try a plainer word — “cost”, “video”, “safety”, “stand”.
            </p>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="mb-1.5">
                <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">{group}</p>
                {items.map((command) => {
                  running += 1;
                  const active = running === index;
                  return (
                    <button
                      key={command.id}
                      id={`command-${command.id}`}
                      role="option"
                      aria-selected={active}
                      data-active={active}
                      type="button"
                      onMouseEnter={() => setIndex(filtered.indexOf(command))}
                      onClick={() => {
                        command.run();
                        onClose();
                      }}
                      className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                        active ? 'bg-primary/15' : 'hover:bg-surface-muted'
                      }`}
                    >
                      <span className={`mt-0.5 shrink-0 ${active ? 'text-primary' : 'text-ink-subtle'}`}>{command.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink">{command.title}</span>
                        <span className="block text-[11px] leading-snug text-ink-muted">{command.description}</span>
                      </span>
                      {command.shortcut ? (
                        <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-subtle">
                          {command.shortcut}
                        </kbd>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-3.5 py-2 text-[10px] text-ink-subtle">
          <span>
            <kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> to move
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> to run
          </span>
          <span className="ml-auto">{filtered.length} available</span>
        </div>
      </div>
    </div>
  );
}

/* ── The commands ──────────────────────────────────────────────────────── */

function useCommands(navigate: ReturnType<typeof useNavigate>, close: () => void): Command[] {
  return useMemo(() => {
    const editor = () => useEditor.getState();
    const inPlan = () => useEditor.getState().planId !== null;

    const panel = (key: Parameters<ReturnType<typeof useEditor.getState>['setWorkPanel']>[0]) => () => {
      editor().setWorkPanel(key);
      close();
    };

    return [
      /* ── Build ─────────────────────────────────────────────────────── */
      {
        id: 'add-truss',
        title: 'Add truss',
        description: 'A goalpost, grid or arch, with the span checked against the section.',
        group: 'Build',
        icon: <Frame className="h-4 w-4" />,
        keywords: 'rigging goalpost grid gantry structure',
        available: inPlan,
        run: () => {
          editor().addObjects([createTruss()]);
          editor().setWorkPanel('build');
        },
      },
      {
        id: 'add-led',
        title: 'Add an LED screen',
        description: 'Built from real cabinets, with resolution, weight and power derived.',
        group: 'Build',
        icon: <Monitor className="h-4 w-4" />,
        keywords: 'screen video wall display projection',
        available: inPlan,
        run: () => {
          editor().addObjects([createLedScreen()]);
          editor().setWorkPanel('build');
        },
      },
      {
        id: 'add-booth',
        title: 'Add an exhibition stand',
        description: 'A stand at a standard module size, checked against the organiser rules.',
        group: 'Build',
        icon: <Store className="h-4 w-4" />,
        keywords: 'booth exhibition expo shell scheme',
        available: inPlan,
        run: () => {
          editor().addObjects([createBooth()]);
          editor().setWorkPanel('build');
        },
      },
      {
        id: 'add-light',
        title: 'Add a lighting fixture',
        description: 'One fixture. Use Light this scene to rig the whole room at once.',
        group: 'Build',
        icon: <Lightbulb className="h-4 w-4" />,
        keywords: 'spotlight wash par beam fixture',
        available: inPlan,
        run: () => {
          editor().addObjects([createLight({ position: { x: 0, y: 5000, z: 0 } })]);
          editor().setWorkPanel('light');
        },
      },

      /* ── Panels ────────────────────────────────────────────────────── */
      {
        id: 'panel-add',
        title: 'Open the catalogue',
        description: 'Furniture, decor and everything you place rather than build.',
        group: 'Go to',
        icon: <Box className="h-4 w-4" />,
        keywords: 'items models chairs tables catalogue library',
        shortcut: '1',
        available: inPlan,
        run: panel('add'),
      },
      {
        id: 'panel-build',
        title: 'Open Build',
        description: 'Staging, truss, LED, stands, tents and drapes.',
        group: 'Go to',
        icon: <Hammer className="h-4 w-4" />,
        shortcut: '2',
        available: inPlan,
        run: panel('build'),
      },
      {
        id: 'panel-site',
        title: 'Open Site',
        description: 'Height limits, rigging points, power, exits and truck access.',
        group: 'Go to',
        icon: <MapPin className="h-4 w-4" />,
        keywords: 'constraints venue building limits rules',
        shortcut: '3',
        available: inPlan,
        run: panel('site'),
      },
      {
        id: 'panel-light',
        title: 'Open Light',
        description: 'Lighting looks, Auto Light Scene, fixtures and the power budget.',
        group: 'Go to',
        icon: <Lightbulb className="h-4 w-4" />,
        shortcut: '4',
        available: inPlan,
        run: panel('light'),
      },
      {
        id: 'panel-cost',
        title: 'How much does this cost?',
        description: 'Quantities measured from the drawing, priced against your rates.',
        group: 'Go to',
        icon: <Calculator className="h-4 w-4" />,
        keywords: 'estimate price budget quantities takeoff boq bill money',
        shortcut: '5',
        available: inPlan,
        run: panel('cost'),
      },
      {
        id: 'panel-check',
        title: 'Is this safe and buildable?',
        description: 'Fire safety, sightlines, screen placement, spacing and access.',
        group: 'Go to',
        icon: <ShieldCheck className="h-4 w-4" />,
        keywords: 'safety egress exits compliance warnings advice sightline',
        shortcut: '6',
        available: inPlan,
        run: panel('check'),
      },
      {
        id: 'panel-ai',
        title: 'Generate a layout from a description',
        description: 'Type what the event is; get a laid-out room with real dimensions.',
        group: 'Go to',
        icon: <Sparkles className="h-4 w-4" />,
        keywords: 'ai concept prompt generate photo analyse',
        shortcut: '7',
        available: inPlan,
        run: () => useAssistant.getState().show('brief'),
      },
      {
        id: 'panel-present',
        title: 'Render, export or build a deck',
        description: 'Images, walkthrough video, technical drawings, CAD and the client presentation.',
        group: 'Go to',
        icon: <Presentation className="h-4 w-4" />,
        keywords: 'render 4k video walkthrough pdf dxf cad deck presentation export',
        shortcut: '8',
        available: inPlan,
        run: panel('present'),
      },
      {
        id: 'panel-review',
        title: 'Comments, versions and comparison',
        description: 'Client comments pinned in the scene, saved versions, and what changed between two of them.',
        group: 'Go to',
        icon: <MessageSquare className="h-4 w-4" />,
        keywords: 'feedback history restore compare a b version',
        shortcut: '9',
        available: inPlan,
        run: panel('review'),
      },

      /* ── Actions ───────────────────────────────────────────────────── */
      {
        id: 'fit',
        title: 'Fit everything in view',
        description: 'Pull the camera back until the whole plan is on screen.',
        group: 'View',
        icon: <LayoutGrid className="h-4 w-4" />,
        keywords: 'zoom frame all camera lost',
        shortcut: 'F',
        available: inPlan,
        run: () => editor().requestFrameAll(),
      },
      {
        id: 'top-view',
        title: 'Look straight down',
        description: 'The plan view — the right one for laying out a floor.',
        group: 'View',
        icon: <LayoutGrid className="h-4 w-4" />,
        keywords: 'plan top overhead 2d',
        shortcut: 'T',
        available: inPlan,
        run: () => editor().setCameraMode('top'),
      },
      {
        id: 'undo',
        title: 'Undo',
        description: 'Step back. Everything in the editor is undoable, including generated layouts.',
        group: 'Edit',
        icon: <Command className="h-4 w-4" />,
        shortcut: 'Ctrl+Z',
        available: inPlan,
        run: () => editor().undo(),
      },

      /* ── Elsewhere ─────────────────────────────────────────────────── */
      {
        id: 'nav-projects',
        title: 'Projects',
        description: 'Everything you are working on.',
        group: 'Elsewhere',
        icon: <LayoutGrid className="h-4 w-4" />,
        run: () => navigate('/dashboard'),
      },
      {
        id: 'nav-venues',
        title: 'Venue library',
        description: 'Real buildings: their height, pillars, loading, power and rules.',
        group: 'Elsewhere',
        icon: <Building2 className="h-4 w-4" />,
        keywords: 'halls rooms spaces site survey',
        run: () => navigate('/venues'),
      },
      {
        id: 'nav-rates',
        title: 'Your rates',
        description: 'The cost database every estimate is priced against.',
        group: 'Elsewhere',
        icon: <Settings2 className="h-4 w-4" />,
        keywords: 'pricing rate card cost database money',
        run: () => navigate('/rate-cards'),
      },
      {
        id: 'nav-insights',
        title: 'Insights',
        description: 'Which layouts win, which stand sizes pay, and an ROI calculator.',
        group: 'Elsewhere',
        icon: <TrendingUp className="h-4 w-4" />,
        keywords: 'analytics reporting conversion roi',
        run: () => navigate('/insights'),
      },
      {
        id: 'nav-marketplace',
        title: 'Marketplace',
        description: 'Buy and sell templates, stand designs, venue packs and rate cards.',
        group: 'Elsewhere',
        icon: <ShoppingBag className="h-4 w-4" />,
        keywords: 'store buy sell templates packs',
        run: () => navigate('/marketplace'),
      },
      {
        id: 'nav-specialists',
        title: 'Hire a specialist',
        description: 'Designers, riggers and visualisers who can take on part of a job.',
        group: 'Elsewhere',
        icon: <Users className="h-4 w-4" />,
        keywords: 'freelance contractor help outsource',
        run: () => navigate('/specialists'),
      },
      {
        id: 'nav-catalogue',
        title: 'Catalogue',
        description: 'Every model available to you, with its measured dimensions.',
        group: 'Elsewhere',
        icon: <Package className="h-4 w-4" />,
        run: () => navigate('/catalog'),
      },
      {
        id: 'nav-billing',
        title: 'Plan and credits',
        description: 'What you are on, what you have left, and what each feature costs.',
        group: 'Elsewhere',
        icon: <CreditCard className="h-4 w-4" />,
        run: () => navigate('/billing'),
      },
      {
        id: 'nav-help',
        title: 'Help and keyboard shortcuts',
        description: 'How everything works, in plain language.',
        group: 'Elsewhere',
        icon: <HelpCircle className="h-4 w-4" />,
        keywords: 'guide tutorial learn shortcuts keys',
        run: () => navigate('/help'),
      },
      {
        id: 'shortcuts',
        title: 'Keyboard shortcuts',
        description: 'Every key the editor listens for.',
        group: 'Elsewhere',
        icon: <Keyboard className="h-4 w-4" />,
        run: () => navigate('/help#shortcuts'),
      },
    ];
  }, [navigate, close]);
}

/**
 * Bind the palette to a key.
 *
 * Ctrl+K and Cmd+K, plus a plain `/` when nothing is focused — the two
 * conventions people arrive with.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { open, setOpen };
}
