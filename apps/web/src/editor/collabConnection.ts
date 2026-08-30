import { migrateScene, type SceneDocument } from '@novira/shared';
import { tokenStore } from '../lib/api';
import { useEditor } from './editorStore';

/**
 * One collaboration socket per plan, shared by everything that needs it.
 *
 * The header shows who is here and the viewport draws their cursors, and both
 * need the same data. If each opened its own socket the server would see two
 * participants for one person — so a planner working alone would watch their
 * own ghost move around the room. Reference counting keeps exactly one
 * connection alive for as long as anything is listening.
 */

export interface Peer {
  connectionId: string;
  userId: string;
  name: string;
  colour: string;
  cursor: { xMm: number; zMm: number } | null;
  selection: string[];
}

export type CollabStatus = 'idle' | 'connecting' | 'live' | 'offline';

export interface CollabSnapshot {
  peers: Peer[];
  status: CollabStatus;
}

const CURSOR_INTERVAL_MS = 50;
const SCENE_DEBOUNCE_MS = 400;
const RECONNECT_BASE_MS = 1500;
const MAX_RECONNECT_MS = 30_000;

interface Connection {
  planId: number;
  socket: WebSocket | null;
  refCount: number;
  connectionId: string | null;
  version: number;
  peers: Peer[];
  status: CollabStatus;
  listeners: Set<() => void>;
  snapshot: CollabSnapshot;
  lastCursorAt: number;
  sceneTimer: number | undefined;
  reconnectTimer: number | undefined;
  pingTimer: number | undefined;
  attempt: number;
  applyingRemote: boolean;
  closing: boolean;
}

const connections = new Map<number, Connection>();

function publish(connection: Connection) {
  // A fresh object each time, so `useSyncExternalStore` sees the change.
  connection.snapshot = { peers: connection.peers, status: connection.status };
  for (const listener of connection.listeners) listener();
}

function scheduleReconnect(connection: Connection) {
  if (connection.closing) return;
  connection.attempt += 1;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** (connection.attempt - 1), MAX_RECONNECT_MS);
  connection.reconnectTimer = window.setTimeout(() => open(connection), delay);
}

function open(connection: Connection) {
  const token = tokenStore.get();
  if (!token || connection.closing) return;

  const base = (import.meta.env.VITE_API_URL ?? 'http://localhost:4100/api').replace(
    /\/api\/?$/,
    ''
  );
  const socket = new WebSocket(
    `${base.replace(/^http/, 'ws')}/api/collaborate?planId=${connection.planId}&token=${encodeURIComponent(token)}`
  );
  connection.socket = socket;
  connection.status = 'connecting';
  publish(connection);

  socket.onopen = () => {
    connection.attempt = 0;
    connection.status = 'live';
    publish(connection);
  };

  socket.onmessage = (event) => {
    let message: { type?: string; [key: string]: unknown };
    try {
      message = JSON.parse(event.data as string);
    } catch {
      return;
    }

    switch (message.type) {
      case 'welcome':
        connection.connectionId = String(message.connectionId);
        connection.version = Number(message.version ?? 0);
        connection.peers = (message.participants as Peer[]).filter(
          (p) => p.connectionId !== connection.connectionId
        );
        publish(connection);
        break;

      case 'presence':
        connection.peers = (message.participants as Peer[]).filter(
          (p) => p.connectionId !== connection.connectionId
        );
        publish(connection);
        break;

      case 'cursor':
        connection.peers = connection.peers.map((p) =>
          p.connectionId === message.connectionId
            ? { ...p, cursor: message.cursor as Peer['cursor'] }
            : p
        );
        publish(connection);
        break;

      case 'selection':
        connection.peers = connection.peers.map((p) =>
          p.connectionId === message.connectionId
            ? { ...p, selection: message.selection as string[] }
            : p
        );
        publish(connection);
        break;

      case 'scene': {
        connection.version = Number(message.version ?? connection.version);
        connection.applyingRemote = true;
        try {
          // Someone else's edit is not yours to undo, so it replaces the scene
          // rather than pushing an undo entry.
          useEditor.getState().replaceScene(migrateScene(message.scene) as SceneDocument);
        } finally {
          // Cleared on the next tick, once the store change has propagated, so
          // the resulting render is not mistaken for a local edit and echoed.
          window.setTimeout(() => {
            connection.applyingRemote = false;
          }, 0);
        }
        break;
      }

      case 'accepted':
      case 'stale':
        connection.version = Number(message.version ?? connection.version);
        break;

      default:
        break;
    }
  };

  socket.onclose = () => {
    connection.socket = null;
    connection.peers = [];
    connection.status = 'offline';
    publish(connection);
    scheduleReconnect(connection);
  };

  socket.onerror = () => socket.close();
}

function acquire(planId: number): Connection {
  let connection = connections.get(planId);
  if (!connection) {
    connection = {
      planId,
      socket: null,
      refCount: 0,
      connectionId: null,
      version: 0,
      peers: [],
      status: 'idle',
      listeners: new Set(),
      snapshot: { peers: [], status: 'idle' },
      lastCursorAt: 0,
      sceneTimer: undefined,
      reconnectTimer: undefined,
      pingTimer: undefined,
      attempt: 0,
      applyingRemote: false,
      closing: false,
    };
    connections.set(planId, connection);
  }

  connection.refCount += 1;
  if (connection.refCount === 1) {
    connection.closing = false;
    open(connection);
    // Keeps the server from sweeping us as idle.
    connection.pingTimer = window.setInterval(() => {
      if (connection!.socket?.readyState === WebSocket.OPEN) {
        connection!.socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30_000);
  }
  return connection;
}

function release(connection: Connection) {
  connection.refCount -= 1;
  if (connection.refCount > 0) return;

  connection.closing = true;
  window.clearTimeout(connection.reconnectTimer);
  window.clearTimeout(connection.sceneTimer);
  window.clearInterval(connection.pingTimer);

  const socket = connection.socket;
  connection.socket = null;
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  connections.delete(connection.planId);
}

/* ── The API components use ────────────────────────────────────────────── */

export function subscribe(planId: number, listener: () => void): () => void {
  const connection = acquire(planId);
  connection.listeners.add(listener);
  return () => {
    connection.listeners.delete(listener);
    release(connection);
  };
}

export function getSnapshot(planId: number): CollabSnapshot {
  return connections.get(planId)?.snapshot ?? EMPTY;
}

const EMPTY: CollabSnapshot = { peers: [], status: 'idle' };

export function sendCursor(planId: number, cursor: { xMm: number; zMm: number } | null) {
  const connection = connections.get(planId);
  if (connection?.socket?.readyState !== WebSocket.OPEN) return;

  const now = Date.now();
  if (now - connection.lastCursorAt < CURSOR_INTERVAL_MS) return;
  connection.lastCursorAt = now;
  connection.socket.send(JSON.stringify({ type: 'cursor', cursor }));
}

export function sendSelection(planId: number, selection: string[]) {
  const connection = connections.get(planId);
  if (connection?.socket?.readyState !== WebSocket.OPEN) return;
  connection.socket.send(JSON.stringify({ type: 'selection', selection }));
}

export function sendScene(planId: number, scene: SceneDocument) {
  const connection = connections.get(planId);
  if (!connection || connection.applyingRemote) return;
  if (connection.socket?.readyState !== WebSocket.OPEN) return;

  window.clearTimeout(connection.sceneTimer);
  connection.sceneTimer = window.setTimeout(() => {
    connection.socket?.send(
      JSON.stringify({ type: 'scene', scene, version: connection.version })
    );
  }, SCENE_DEBOUNCE_MS);
}
