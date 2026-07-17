'use strict';

/**
 * backend/src/server.js
 *
 * Main Express server and Socket.io setup.
 * Coordinates Express endpoints and real-time Socket.io events.
 */

require('dotenv').config();

const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const cors         = require('cors');
const path         = require('path');
const routes       = require('./api/routes');
const { attachSocketIO } = require('./workers/ingestion-worker');
const { getGraphManager } = require('./graph/graph-manager');

const app  = express();
const server = http.createServer(app);

// Enable CORS for frontend integration
const corsOptions = {
    origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
    methods:     ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files statically if needed
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Register API routes
app.use('/api', routes);

// Set up Socket.io server
const io = new Server(server, {
    cors: corsOptions,
    transports: ['websocket', 'polling'],
});

// Attach Socket.io to ingestion worker for real-time progress emissions
attachSocketIO(io);

// Expose io to routes for compliance alerting
routes._io = io;

io.on('connection', (socket) => {
    console.log(`[socket] Client connected: ${socket.id}`);

    // Join a room for a specific document ingestion job status
    socket.on('ingestion:join', (jobId) => {
        socket.join(jobId);
        console.log(`[socket] Client ${socket.id} joined room: ${jobId}`);
    });

    socket.on('disconnect', () => {
        console.log(`[socket] Client disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3001;

async function startServer() {
    try {
        // Ping Neo4j on startup
        const gm = getGraphManager();
        const connected = await gm.ping();
        if (connected) {
            console.log('[server] Neo4j connection verified on startup.');
        } else {
            console.warn('[server] Warning: Neo4j is offline or credentials mismatch.');
        }

        server.listen(PORT, () => {
            console.log(`[server] Express server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('[server] Fatal startup error:', error.message);
        process.exit(1);
    }
}

startServer();
