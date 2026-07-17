import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

/**
 * Custom React hook for Socket.io real-time updates.
 *
 * @param {Object} eventHandlers - Map of eventName -> handlerFunction
 * @returns {Socket} Raw socket instance
 */
export function useSocket(eventHandlers = {}) {
    const socketRef = useRef(null);
    const handlersRef = useRef(eventHandlers);

    // Keep handlers updated without re-running the connection effect
    useEffect(() => {
        handlersRef.current = eventHandlers;
    }, [eventHandlers]);

    useEffect(() => {
        // Connect to Socket.io server
        const socket = io(SOCKET_URL, {
            transports: ['websocket', 'polling'],
            reconnectionAttempts: 5,
        });
        socketRef.current = socket;

        // Catch-all handler caller
        const triggerHandler = (event, data) => {
            if (handlersRef.current[event]) {
                handlersRef.current[event](data);
            }
        };

        // Register all listeners
        Object.keys(handlersRef.current).forEach(event => {
            socket.on(event, (data) => triggerHandler(event, data));
        });

        // Cleanup connection on unmount
        return () => {
            socket.disconnect();
        };
    }, []);

    return socketRef.current;
}
