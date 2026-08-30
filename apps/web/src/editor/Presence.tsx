import { Html } from '@react-three/drei';
import { MousePointer2, Wifi, WifiOff } from 'lucide-react';
import type { Peer } from './collabConnection';

/**
 * Who else is in this plan.
 *
 * Cursors are drawn in the scene rather than as a screen overlay, so they point
 * at the same table for everyone regardless of how each person has their camera
 * positioned. Two planners looking at a room from opposite sides still see each
 * other pointing at the same chair.
 */

const M = 0.001;

export function PeerCursors({ peers }: { peers: Peer[] }) {
  return (
    <>
      {peers
        .filter((p) => p.cursor)
        .map((peer) => (
          <Html
            key={peer.connectionId}
            position={[peer.cursor!.xMm * M, 0.02, peer.cursor!.zMm * M]}
            style={{ pointerEvents: 'none' }}
            zIndexRange={[30, 0]}
          >
            <div className="flex -translate-x-1 -translate-y-1 items-start gap-1 whitespace-nowrap">
              <MousePointer2
                className="h-4 w-4 drop-shadow"
                style={{ color: peer.colour, fill: peer.colour }}
              />
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white shadow"
                style={{ backgroundColor: peer.colour }}
              >
                {peer.name}
              </span>
            </div>
          </Html>
        ))}
    </>
  );
}

/**
 * A ring around anything someone else has selected.
 *
 * This is the part that actually prevents collisions: the sync underneath is
 * last-writer-wins, so seeing that a colleague is holding a table is what stops
 * two people editing it at once.
 */
export function PeerSelections({
  peers,
  positions,
}: {
  peers: Peer[];
  positions: Map<string, { xMm: number; zMm: number }>;
}) {
  return (
    <>
      {peers.flatMap((peer) =>
        peer.selection
          .map((objectId) => {
            const position = positions.get(objectId);
            if (!position) return null;
            return (
              <mesh
                key={`${peer.connectionId}-${objectId}`}
                position={[position.xMm * M, 0.012, position.zMm * M]}
                rotation={[-Math.PI / 2, 0, 0]}
              >
                <ringGeometry args={[0.55, 0.62, 40]} />
                <meshBasicMaterial color={peer.colour} transparent opacity={0.85} />
              </mesh>
            );
          })
          .filter(Boolean)
      )}
    </>
  );
}

/** Who is here, in the editor header. */
export function PresenceBar({
  peers,
  status,
}: {
  peers: Peer[];
  status: 'idle' | 'connecting' | 'live' | 'offline';
}) {
  if (status === 'idle') return null;

  return (
    <div className="flex items-center gap-1.5" title={
      status === 'live'
        ? `${peers.length} other${peers.length === 1 ? '' : 's'} editing`
        : status === 'connecting'
          ? 'Connecting…'
          : 'Reconnecting — your changes are still saved'
    }>
      {status === 'live' ? (
        <Wifi className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <WifiOff className={`h-3.5 w-3.5 ${status === 'offline' ? 'text-amber-400' : 'text-ink-subtle'}`} />
      )}

      <div className="flex -space-x-1.5">
        {peers.slice(0, 5).map((peer) => (
          <span
            key={peer.connectionId}
            title={peer.name}
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface-strong text-[10px] font-bold text-white"
            style={{ backgroundColor: peer.colour }}
          >
            {peer.name
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part.charAt(0))
              .join('')
              .toUpperCase()}
          </span>
        ))}
        {peers.length > 5 ? (
          <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface-strong bg-surface-muted text-[10px] font-bold text-ink-muted">
            +{peers.length - 5}
          </span>
        ) : null}
      </div>
    </div>
  );
}
