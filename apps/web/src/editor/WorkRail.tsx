import { useMemo, type ReactNode } from 'react';
import {
  Boxes,
  Brush,
  Calculator,
  Hammer,
  Lightbulb,
  MoreHorizontal,
  Sparkles,
  MapPin,
  MessageSquare,
  Presentation,
  ShieldCheck,
} from 'lucide-react';
import { useEditor, type WorkPanel } from './editorStore';

/**
 * The icon rail.
 *
 * The map of the whole product, and the thing that decides whether someone
 * with no 3D experience can find anything. Three rules shape it:
 *
 *  · **Named for what you are doing**, not for the feature that implements it.
 *    "Site" and "Cost", not "constraints" and "take-off" — those are the right
 *    trade terms and they appear inside each panel, but they are not a first
 *    impression anyone can navigate.
 *
 *  · **Grouped by phase.** Create → Refine → Deliver. Nine flat icons is a
 *    wall; three groups of two or three is a sequence, and the separator does
 *    the whole job of saying "you are still designing" versus "you are getting
 *    it out of the door".
 *
 *    **Present leads the delivery group**, directly under Light. Lighting the
 *    room is the last thing done to the design and rendering it is the first
 *    thing done with it, so the two sit together; cost and checks are what you
 *    reach for once there is something to show. The digits follow the order
 *    down the rail rather than the keys they used to be — the sixth icon
 *    answering to 8 is worse than a moved shortcut.
 *
 *  · **Properties are not here.** Editing what is selected lives in the right
 *    dock, next to the object, permanently visible. Putting it in the rail
 *    made the catalogue and the thing you had just placed fight over one
 *    column, which is exactly the crowding this rail exists to prevent.
 */

export interface RailItem {
  key: WorkPanel;
  label: string;
  icon: ReactNode;
  /** What this section is for, in one sentence. Shown on hover and focus. */
  help: string;
  /** Keyboard shortcut, shown in the tooltip and bound in the editor. */
  shortcut: string;
  /** Which phase of the work this belongs to. */
  phase: 'create' | 'refine' | 'deliver';
}

export const RAIL_ITEMS: RailItem[] = [
  {
    key: 'add',
    label: 'Create',
    icon: <Boxes className="h-[18px] w-[18px]" />,
    help: 'Models, artwork and the drawing tools. Everything you put into the room starts here.',
    shortcut: '1',
    phase: 'create',
  },
  {
    key: 'build',
    label: 'Build',
    icon: <Hammer className="h-[18px] w-[18px]" />,
    help: 'Staging, truss, LED, stands, tents and drape — built to a size you specify rather than picked off a shelf.',
    shortcut: '2',
    phase: 'create',
  },
  {
    key: 'finish',
    label: 'Finish',
    icon: <Brush className="h-[18px] w-[18px]" />,
    help: 'Materials. Drag one onto any surface and it paints the part it lands on.',
    shortcut: '3',
    phase: 'create',
  },
  {
    key: 'ai',
    label: 'AI',
    icon: <Sparkles className="h-[18px] w-[18px]" />,
    help: 'Describe an event and have it built, make branding and artwork, or ask for changes to what is already here.',
    shortcut: '4',
    phase: 'create',
  },
  {
    key: 'site',
    label: 'Site',
    icon: <MapPin className="h-[18px] w-[18px]" />,
    help: 'The building: height limit, rigging points, power, exits and truck access. Pick a venue and it all arrives at once.',
    shortcut: '5',
    phase: 'refine',
  },
  {
    key: 'light',
    label: 'Light',
    icon: <Lightbulb className="h-[18px] w-[18px]" />,
    help: 'Choose a look and light the whole room in one press, then adjust any fixture.',
    shortcut: '6',
    phase: 'refine',
  },
  {
    key: 'present',
    label: 'Present',
    icon: <Presentation className="h-[18px] w-[18px]" />,
    help: 'Renders, walkthrough videos, technical drawings, CAD and the client deck.',
    shortcut: '7',
    phase: 'deliver',
  },
  {
    key: 'more',
    label: 'More',
    icon: <MoreHorizontal className="h-[18px] w-[18px]" />,
    help: 'Cost, checks and review — everything you do to a finished plan rather than to build one.',
    shortcut: '8',
    phase: 'deliver',
  },
];

/**
 * What lives behind More.
 *
 * Cost, Check and Review are not steps in designing a room; they are things
 * you do to a room once it exists. Keeping them in the rail alongside Create
 * and Build gave them equal billing with the work itself, and made nine flat
 * icons where a person scans about six. They keep their own panels, their own
 * shortcuts and their own place in the store — only the way in has moved.
 */
export const MORE_ITEMS: RailItem[] = [
  {
    key: 'cost',
    label: 'Cost',
    icon: <Calculator className="h-[18px] w-[18px]" />,
    help: 'Quantities measured from the drawing — LED, truss, carpet, print, labour — and what they cost at your rates.',
    shortcut: '',
    phase: 'deliver',
  },
  {
    key: 'check',
    label: 'Check',
    icon: <ShieldCheck className="h-[18px] w-[18px]" />,
    help: 'Fire safety, sightlines, screen placement, spacing and access, checked against the rules for your market.',
    shortcut: '',
    phase: 'deliver',
  },
  {
    key: 'review',
    label: 'Review',
    icon: <MessageSquare className="h-[18px] w-[18px]" />,
    help: 'Comments pinned in the 3D scene, saved versions, and a comparison of any two layouts.',
    shortcut: '',
    phase: 'deliver',
  },
];

export function WorkRail({
  collapsed,
  onSelect,
}: {
  /** True when the panel beside the rail is hidden, so a click re-opens it. */
  collapsed?: boolean;
  onSelect?: (panel: WorkPanel) => void;
}) {
  const workPanel = useEditor((s) => s.workPanel);
  const setWorkPanel = useEditor((s) => s.setWorkPanel);

  const groups = useMemo(() => {
    const order: RailItem['phase'][] = ['create', 'refine', 'deliver'];
    return order.map((phase) => ({ phase, items: RAIL_ITEMS.filter((item) => item.phase === phase) }));
  }, []);

  return (
    <nav
      aria-label="Editor sections"
      className="flex w-[66px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface px-1.5 py-2"
    >
      {groups.map((group, index) => (
        <div key={group.phase} className="contents">
          {index > 0 ? <span className="mx-auto my-1 h-px w-7 bg-line" aria-hidden /> : null}
          {group.items.map((item) => {
            const active = !collapsed && workPanel === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setWorkPanel(item.key);
                  onSelect?.(item.key);
                }}
                aria-current={active ? 'page' : undefined}
                title={`${item.label} — ${item.help}  (${item.shortcut})`}
                className={`rail-btn ${active ? 'rail-btn-active' : ''}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** The heading above the open panel, so it is always clear where you are. */
export function PanelHeader({ panel, onClose }: { panel: WorkPanel; onClose?: () => void }) {
  const item = RAIL_ITEMS.find((i) => i.key === panel);
  if (!item) return null;
  return (
    <header className="shrink-0 border-b border-line px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-primary">{item.icon}</span>
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">{panelTitle(item)}</h2>
        {onClose ? (
          <button
            type="button"
            className="icon-btn-bare"
            onClick={onClose}
            aria-label={`Hide the ${item.label} panel`}
            title="Hide this panel"
          >
            <span aria-hidden className="text-base leading-none">
              ×
            </span>
          </button>
        ) : null}
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-subtle">{item.help}</p>
    </header>
  );
}

/**
 * The panel's own title.
 *
 * Longer than the rail label on purpose: the rail has 60 px and needs a word,
 * the panel has a column and can afford the phrase that actually explains it.
 */
function panelTitle(item: RailItem): string {
  switch (item.key) {
    case 'add':
      return 'Create & Import';
    case 'build':
      return 'Build to size';
    case 'finish':
      return 'Materials & finishes';
    case 'site':
      return 'Site & venue';
    case 'light':
      return 'Lighting';
    case 'cost':
      return 'Cost & quantities';
    case 'check':
      return 'Checks & compliance';
    case 'present':
      return 'Present & deliver';
    case 'review':
      return 'Review & versions';
    default:
      return item.label;
  }
}
