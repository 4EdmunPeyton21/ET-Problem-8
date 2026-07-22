import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace('/api', '') : 'http://localhost:3001';

// Module-level singleton: every component calling useSocket() shares the same
// connection instead of opening a new WebSocket per consumer.
let sharedSocket = null;

function getSharedSocket() {
  if (!import.meta.env.VITE_API_URL) return null; // mock mode — no real backend to connect to
  if (!sharedSocket) {
    sharedSocket = io(SOCKET_URL, {
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      reconnectionAttempts: 10,
    });
  }
  return sharedSocket;
}

export const useSocket = () => {
  const socket = getSharedSocket();
  const [isConnected, setIsConnected] = useState(socket?.connected || false);

  useEffect(() => {
    if (!socket) return;

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  return { socket, isConnected };
};
