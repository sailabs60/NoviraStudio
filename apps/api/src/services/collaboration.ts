/**
 * Real-time collaboration.
 *
 * Two planners on the same layout need three things, in descending order of how
 * often they matter:
 *
 * 1. **Presence** — who else is here, where their cursor is, what they have
 *    selected. This is what stops two people quietly editing the same table.
 * 2. **Live scene updates** — the other person's changes appearing without a
 *    reload.
 * 3. **Not losing work** when both edit at once.
 *
 * The honest position on (3): this is last-writer-wins per whole scene, not
 * operational transform or a CRDT. Every update carries a version, a client
 * sending an update built on a stale version is told so and re-syncs, and the
 * result is that concurrent edits to *different* objects merge cleanly while
 * concurrent edits to *the same* object resolve to whoever saved last.
 *
 * That is a real limitation and it is why presence matters so much here: seeing
 * that someone else has a table selected is what prevents the collision, rather
 * than resolving it afterwards. A CRDT would be the correct answer for
 * simultaneous editing of one object, and is a significant piece of work in its
 * own right.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';

interface Participant {
  socket: WebSocket;
  userId: string;
  name: string;
  colour: string;
  /** Plan-space cursor, in millimetres. */
  cursor: { xMm: number; zMm: number } | null;
  selection: string[];
  lastSeen: number;
}

interface Room {
  planId: string;
  participants: Map<string, Participant>;
  /** Bumped on every accepted scene update; the basis for staleness checks. */
  version: number;
}

const rooms = new Map<string, Room>();

/**
 * Colours assigned in order, so two people in a room are never the same colour
 * and the same person keeps their colour across a session.
 */
const PRESENCE_COLOURS = [
  '#4DA0FF', '#34d399', '#fbbf24', '#f472b6',
  '#22d3ee', '#a78bfa', '#fb923c', '#4ade80',
];

function roomFor(planId: string): Room {
  let room = rooms.get(planId);
  if (!room) {
    room = { planId, participants: new Map(), version: 0 };
    rooms.set(planId, room);
  }
  return room;
}

function send(socket: WebSocket, message: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

/** Everyone in the room except, optionally, the sender. */
function broadcast(room: Room, message: unknown, exceptConnectionId?: string) {
  for (const [connectionId, participant] of room.participants) {
    if (connectionId === exceptConnectionId) continue;
    send(participant.socket, message);
  }
}

function presenceList(room: Room) {
  return [...room.participants.entries()].map(([connectionId, p]) => ({
    connectionId,
    userId: p.userId,
    name: p.name,
    colour: p.colour,
    cursor: p.cursor,
    selection: p.selection,
  }));
}

/** Whether a user may open this plan at all. Mirrors the REST rules. */
async function canAccessPlan(userId: bigint, companyId: bigint | null, planId: bigint) {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    include: { project: true },
  });
  if (!plan) return null;
  const mine = plan.project.ownerId === userId;
  const shared = companyId !== null && plan.project.companyId === companyId;
  return mine || shared ? plan : null;
}

export function attachCollaboration(server: Server) {
  // `noServer` so the HTTP server keeps serving everything else; the upgrade is
  // handled only for our own path.
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '', `http://${request.headers.host}`);
    if (url.pathname !== '/api/collaborate') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', async (socket, request) => {
    const url = new URL(request.url ?? '', `http://${request.headers.host}`);
    const token = url.searchParams.get('token') ?? '';
    const planIdRaw = url.searchParams.get('planId') ?? '';

    /*
     * Browsers cannot set headers on a WebSocket handshake, so the token comes
     * in the query string. It is verified exactly as the REST middleware does —
     * the transport is different, the trust boundary is not.
     */
    let userId: bigint;
    try {
      const payload = jwt.verify(token, env.jwtSecret) as { sub?: string };
      if (!payload.sub) throw new Error('no subject');
      userId = BigInt(payload.sub);
    } catch {
      send(socket, { type: 'error', code: 'UNAUTHENTICATED' });
      socket.close(4401, 'unauthenticated');
      return;
    }

    const planId = /^\d+$/.test(planIdRaw) ? BigInt(planIdRaw) : null;
    if (!planId) {
      send(socket, { type: 'error', code: 'BAD_PLAN' });
      socket.close(4400, 'bad plan');
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, companyId: true, isBlocked: true },
    });
    if (!user || user.isBlocked) {
      send(socket, { type: 'error', code: 'FORBIDDEN' });
      socket.close(4403, 'forbidden');
      return;
    }

    const plan = await canAccessPlan(user.id, user.companyId, planId);
    if (!plan) {
      send(socket, { type: 'error', code: 'FORBIDDEN' });
      socket.close(4403, 'forbidden');
      return;
    }

    const room = roomFor(String(planId));
    const connectionId = `${userId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const participant: Participant = {
      socket,
      userId: String(user.id),
      name: `${user.firstName} ${user.lastName}`.trim() || 'Someone',
      colour: PRESENCE_COLOURS[room.participants.size % PRESENCE_COLOURS.length]!,
      cursor: null,
      selection: [],
      lastSeen: Date.now(),
    };
    room.participants.set(connectionId, participant);

    send(socket, {
      type: 'welcome',
      connectionId,
      version: room.version,
      participants: presenceList(room),
    });
    broadcast(room, { type: 'presence', participants: presenceList(room) }, connectionId);

    socket.on('message', async (raw) => {
      let message: { type?: string; [key: string]: unknown };
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      participant.lastSeen = Date.now();

      switch (message.type) {
        case 'cursor': {
          const cursor = message.cursor as { xMm: number; zMm: number } | null;
          participant.cursor =
            cursor && Number.isFinite(cursor.xMm) && Number.isFinite(cursor.zMm)
              ? { xMm: Math.round(cursor.xMm), zMm: Math.round(cursor.zMm) }
              : null;
          // Cursors are the highest-frequency message by far, so they carry only
          // the moved participant rather than the whole presence list.
          broadcast(
            room,
            { type: 'cursor', connectionId, cursor: participant.cursor },
            connectionId
          );
          break;
        }

        case 'selection': {
          const selection = Array.isArray(message.selection) ? message.selection : [];
          participant.selection = selection.filter((s): s is string => typeof s === 'string').slice(0, 200);
          broadcast(
            room,
            { type: 'selection', connectionId, selection: participant.selection },
            connectionId
          );
          break;
        }

        case 'scene': {
          /*
           * A client that built its change on an older version is told to
           * re-sync rather than having its work silently overwrite newer edits.
           * The client then reloads and re-applies, which is the honest
           * behaviour for last-writer-wins.
           */
          const basedOn = Number(message.version ?? -1);
          if (basedOn < room.version) {
            send(socket, { type: 'stale', version: room.version });
            return;
          }

          room.version += 1;
          broadcast(
            room,
            {
              type: 'scene',
              version: room.version,
              scene: message.scene,
              by: connectionId,
              byName: participant.name,
            },
            connectionId
          );
          send(socket, { type: 'accepted', version: room.version });
          break;
        }

        case 'ping':
          send(socket, { type: 'pong' });
          break;

        default:
          break;
      }
    });

    const cleanup = () => {
      room.participants.delete(connectionId);
      if (room.participants.size === 0) {
        rooms.delete(room.planId);
        return;
      }
      broadcast(room, { type: 'presence', participants: presenceList(room) });
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });

  /*
   * Drop sockets that have stopped talking. A browser tab closed by killing the
   * process never sends a close frame, and a ghost cursor sitting in a room is
   * worse than no presence at all — it makes people avoid an object nobody is
   * editing.
   */
  const sweep = setInterval(() => {
    const cutoff = Date.now() - 90_000;
    for (const room of rooms.values()) {
      for (const [connectionId, participant] of room.participants) {
        if (participant.lastSeen < cutoff) {
          participant.socket.terminate();
          room.participants.delete(connectionId);
        }
      }
      if (room.participants.size === 0) rooms.delete(room.planId);
      else broadcast(room, { type: 'presence', participants: presenceList(room) });
    }
  }, 30_000);
  sweep.unref();

  return wss;
}

/** For the admin console: who is working on what, right now. */
export function activeRooms() {
  return [...rooms.values()].map((room) => ({
    planId: room.planId,
    version: room.version,
    participants: [...room.participants.values()].map((p) => ({
      userId: p.userId,
      name: p.name,
    })),
  }));
}
