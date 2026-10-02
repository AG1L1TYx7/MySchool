'use client';

import { io, type Socket } from 'socket.io-client';
import { tokenStore, tryRefresh } from './api';

/**
 * Socket hubs (docs/04 section 3) through the same-origin proxy: path /api/socket.io.
 * One socket per namespace is shared across components; the access token is re-read on every
 * (re)connect so an expired token never strands a tab.
 */
const sockets = new Map<string, Socket>();

export function hub(namespace: '/hubs/notifications' | '/hubs/messaging'): Socket {
  let socket = sockets.get(namespace);
  if (socket) return socket;
  socket = io(namespace, {
    path: '/api/socket.io',
    // Polling first, then upgrade: works through the Next.js proxy even where the upgrade is not forwarded.
    transports: ['polling', 'websocket'],
    addTrailingSlash: false,
    autoConnect: false,
    auth: (cb) => {
      void (tokenStore.access ? Promise.resolve(true) : tryRefresh()).then(() => cb({ token: tokenStore.access ?? '' }));
    },
    reconnectionDelayMax: 10_000,
  });
  socket.on('Error', () => {
    // Token rejected: refresh once and let socket.io reconnect with the new one.
    void tryRefresh();
  });
  sockets.set(namespace, socket);
  return socket;
}

export function connectHub(namespace: '/hubs/notifications' | '/hubs/messaging'): Socket {
  const socket = hub(namespace);
  if (!socket.connected && !socket.active) socket.connect();
  return socket;
}

export function disconnectHubs(): void {
  for (const s of sockets.values()) s.disconnect();
  sockets.clear();
}
