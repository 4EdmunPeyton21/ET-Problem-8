'use strict';

/**
 * backend/src/server.js
 *
 * Main Express server and Socket.io setup.
 * Coordinates Express endpoints and real-time Socket.io events.
 */

require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const http        = require('http');
const path        = require('path');
const { Server }  = require('socket.io');

const routes = require('./api/routes');
const { attachSocketIO } = require('./workers/ingestion-worker');
const { getGraphManager } = require('./graph/graph-manager');

const PORT = process.env.PORT || 3001;

const corsOptions = {
    origin:      process.env.FRONTEND_URL || '*',
    methods:     ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
};

const app = express();
app.use(cors(corsOptions));
app.use(express.json());

// Serve uploaded files statically (e.g. for viewing original documents)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api', routes);

const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });
attachSocketIO(io);

// Expose io to routes so agents (e.g. ComplianceAgent) can emit alerts directly.
routes._io = io;

io.on('connection', (socket) => {
    console.log(`[socket] Client connected: ${socket.id}`);

    // Join a room for a specific document ingestion job — lets the backend
    // target progress events instead of always broadcasting to everyone.
    socket.on('ingestion:join', (jobId) => {
        socket.join(jobId);
    });

    socket.on('disconnect', () => {
        console.log(`[socket] Client disconnected: ${socket.id}`);
    });
});

server.listen(PORT, async () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
    await getGraphManager().initializeSchema().catch(err =>
        console.warn('[server] Schema init skipped:', err.message)
    );
});
