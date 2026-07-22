'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const http    = require('http');
const { Server } = require('socket.io');

const routes = require('./api/routes');
const { attachSocketIO } = require('./workers/ingestion-worker');
const { getGraphManager } = require('./graph/graph-manager');

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', routes);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
attachSocketIO(io);

server.listen(PORT, async () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
    await getGraphManager().initializeSchema().catch(err =>
        console.warn('[server] Schema init skipped:', err.message)
    );
});
