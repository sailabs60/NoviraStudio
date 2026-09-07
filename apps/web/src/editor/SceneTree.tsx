/**
 * The scene tree.
 *
 * A generated event is five hundred objects, and until now the only way to
 * reach one was to find it in the viewport and click it. That works for the
 * stage and fails completely for "chair 17 of table 12" — which is precisely
 * the object the brief uses as its example of what must stay individually
 * addressable.
 *
 * ## The shape it shows
 *
 * The scene document is a flat list with grouping carried in fields, and this
 * is the view that turns those fields back into the hierarchy people think in:
 *
 *   Stage        stage deck, LED screen, truss, spotlights
 *   Seating      Table 1 → its ten chairs, Table 2 → its ten chairs, …
 *   Exhibition   stand 1, stand 2, …
 *   Lighting     chandeliers, moving heads
 *   Branding     banners, logo panels
 *   Decor        planting, lounge
 *   Circulation  carpet, walkway, dance floor
 *
 * The tree is derived, never stored. Deriving it means a plan drawn by hand,
 * one generated a year ago and one half-edited all produce a sensible tree
 * without a migration, and there is no second source of truth to fall out of
 * step with the scene.
 *
 * ## Why it is virtualised by collapsing rather than by windowing
 *
 * Five hundred rows is enough to make a naive list janky. Rather than add a
 * windowing library, groups start collapsed: the top level is a handful of
 * rows, a table expands to eleven, and nothing renders a thousand nodes. That
 * is also the more useful default — nobody opens a tree of 480 chairs wanting
 * to see all 480 at once.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, Search, Unlock } from 'lucide-react';
import type { SceneObject } from '@novira/shared';
import { useEditor } from './editorStore';

/** The parts of an event, in the order a production schedule runs. */
const SECTIONS: Array<{ key: string; label: string; match: (o: SceneObject) => boolean }> = [
  { key: 'stage', label: 'Stage', match: (o) => role(o) === 'stage' || ['stage', 'led', 'truss'].includes(o.type) },
  { key: 'seating', label: 'Seating', match: (o) => role(o) === 'seating' },
  { key: 'exhibition', label: 'Exhibition', match: (o) => role(o) === 'exhibition' || o.type === 'booth' },
  { key: 'lighting', label: 'Lighting', match: (o) => role(o) === 'lighting' || o.type === 'light' },
  { key: 'branding', label: 'Branding', match: (o) => role(o) === 'branding' || o.type === 'artwork' },
  { key: 'decor', label: 'Decor', match: (o) => role(o) === 'decor' },
  { key: 'circulation', label: 'Circulation', match: (o) => role(o) === 'circulation' },
];

const role = (o: SceneObject): string | undefined =>
  (o as SceneObject & { assemblyRole?: string }).assemblyRole;

const generatedRole = (o: SceneObject): string | undefined =>
  (o as SceneObject & { generatedRole?: string }).generatedRole;

interface Node {
  id: string;
  label: string;
  object?: SceneObject;
  children: Node[];
}

export function SceneTree() {
  const objects = useEditor((s) => s.scene.objects);
  const selectedIds = useEditor((s) => s.selectedIds);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const focusObject = useEditor((s) => s.focusObject);
  const updateObject = useEditor((s) => s.updateObject);
  const readOnly = useEditor((s) => s.readOnly);

  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  /*
   * Build the tree.
   *
   * A table and its chairs share a groupId, so a group becomes a branch headed
   * by whichever member is the table — the thing a person would name it after.
   * Everything ungrouped sits directly under its section.
   */
  const tree = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = needle
      ? objects.filter((o) => (o.name ?? o.type).toLowerCase().includes(needle))
      : objects;

    const claimed = new Set<string>();
    const sections: Node[] = [];

    for (const section of SECTIONS) {
      const mine = visible.filter((o) => !claimed.has(o.id) && section.match(o));
      if (!mine.length) continue;
      for (const o of mine) claimed.add(o.id);

      const groups = new Map<string, SceneObject[]>();
      const loose: SceneObject[] = [];
      for (const object of mine) {
        const group = (object as SceneObject & { groupId?: string | null }).groupId;
        if (group) {
          const list = groups.get(group);
          if (list) list.push(object);
          else groups.set(group, [object]);
        } else loose.push(object);
      }

      const children: Node[] = [];
      for (const [groupId, members] of groups) {
        if (members.length === 1) {
          children.push({ id: members[0]!.id, label: label(members[0]!), object: members[0], children: [] });
          continue;
        }
        // Head the branch with the table, not the first chair that happens to
        // come back from the filter.
        const head = members.find((m) => generatedRole(m) === 'table') ?? members[0]!;
        children.push({
          id: `group:${groupId}`,
          label: `${label(head)} · ${members.length} parts`,
          children: members.map((m) => ({ id: m.id, label: label(m), object: m, children: [] })),
        });
      }
      for (const object of loose) {
        children.push({ id: object.id, label: label(object), object, children: [] });
      }

      sections.push({ id: `section:${section.key}`, label: `${section.label} · ${mine.length}`, children });
    }

    // Anything the sections did not claim — hand-drawn shapes, walls, imports.
    const rest = visible.filter((o) => !claimed.has(o.id));
    if (rest.length) {
      sections.push({
        id: 'section:other',
        label: `Other · ${rest.length}`,
        children: rest.map((o) => ({ id: o.id, label: label(o), object: o, children: [] })),
      });
    }
    return sections;
  }, [objects, query]);

  // A search should show what it found, not make the user open every branch.
  const searching = query.trim().length > 0;

  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderNode = (node: Node, depth: number) => {
    const expandable = node.children.length > 0;
    const isOpen = searching || open.has(node.id);
    const isSelected = node.object ? selected.has(node.object.id) : false;

    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-1 rounded px-1 py-0.5 text-[11px] ${
            isSelected ? 'bg-primary/12 text-primary' : 'text-ink hover:bg-surface-hover'
          }`}
          style={{ paddingLeft: `${4 + depth * 12}px` }}
        >
          <button
            type="button"
            className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-subtle"
            onClick={() => expandable && toggleOpen(node.id)}
            aria-label={expandable ? (isOpen ? 'Collapse' : 'Expand') : undefined}
            disabled={!expandable}
          >
            {expandable ? (
              isOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )
            ) : null}
          </button>

          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left"
            title={node.label}
            onClick={(e) => {
              if (!node.object) {
                // A branch selects everything under it, which is how "move this
                // table" — meaning the table and its chairs — is expressed.
                select(node.children.map((c) => c.object?.id).filter(Boolean) as string[]);
                return;
              }
              if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSelect(node.object.id, true);
              else select([node.object.id]);
            }}
            onDoubleClick={() => node.object && focusObject(node.object.id)}
          >
            {node.label}
          </button>

          {node.object ? (
            <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
              <button
                type="button"
                className="flex h-4 w-4 items-center justify-center text-ink-subtle hover:text-ink"
                aria-label={node.object.hidden ? 'Show' : 'Hide'}
                disabled={readOnly}
                onClick={() =>
                  updateObject(node.object!.id, { hidden: !node.object!.hidden } as Partial<SceneObject>)
                }
              >
                {node.object.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
              <button
                type="button"
                className="flex h-4 w-4 items-center justify-center text-ink-subtle hover:text-ink"
                aria-label={node.object.locked ? 'Unlock' : 'Lock'}
                disabled={readOnly}
                onClick={() =>
                  updateObject(node.object!.id, { locked: !node.object!.locked } as Partial<SceneObject>)
                }
              >
                {node.object.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
              </button>
            </span>
          ) : null}
        </div>

        {isOpen && expandable ? node.children.map((child) => renderNode(child, depth + 1)) : null}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative shrink-0 px-2 pb-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-subtle" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an object…"
          className="ed-field w-full pl-7"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {tree.length ? (
          tree.map((node) => renderNode(node, 0))
        ) : (
          <p className="px-2 py-4 text-[11px] text-ink-subtle">
            {searching ? 'Nothing matches that.' : 'Nothing in the plan yet.'}
          </p>
        )}
      </div>
    </div>
  );
}

function label(object: SceneObject): string {
  const name = object.name?.trim();
  if (name) return name;
  const generated = generatedRole(object);
  return generated ? `${generated}` : object.type;
}
