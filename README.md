# Industrial Knowledge Intelligence (IKI)

The **Industrial Knowledge Intelligence (IKI)** system is an AI-powered industrial operations platform that integrates natural language understanding, machine learning anomaly detection, automated root-cause analysis, and regulatory compliance auditing through an intelligent Neo4j Knowledge Graph.

## 🚀 Current Status

The backend infrastructure, data pipelines, AI agent modules, and individual frontend React components have been fully built, tested, and verified. The remaining task is to wire the frontend layout (routing) to connect the components together.

### What has been built:

#### 1. Backend & Infrastructure
* **Express.js API Server**: Manages all REST endpoints and WebSockets (Socket.io).
* **Neo4j Knowledge Graph**: Handles all data modeling with strict uniqueness constraints and indexes for fast traversal.
* **Bull Queue (Redis)**: A robust, background job-processing queue for handling asynchronous document ingestion pipelines.

#### 2. Agentic AI Systems
* **Query Agent**: A natural language assistant that queries the graph to answer specific operational questions (e.g., *"Has Pump XYZ ever failed?"*).
* **Root Cause Analysis (RCA) Agent**: Analyzes failure symptoms, correlates them with historical incidents, and provides diagnostic steps and preventive measures.
* **Compliance Agent**: Audits the Neo4j graph against safety regulations (like Factory Act or ISO standards) and automatically flags regulatory gaps.

#### 3. Data Ingestion & Analytics
* **Document Upload Pipeline**: Parses uploaded files (PDFs, text, emails) via background workers. Uses Groq/Gemini LLMs for **Named Entity Recognition (NER)** and **Relationship Extraction**.
* **Machine Learning Anomaly Detection**: A Python-based `IsolationForest` pipeline that analyzes equipment telemetry (MTBF, MTTR, cost) and pushes real-time `CRITICAL` or `HIGH` severity alerts to the frontend via Socket.io.

#### 4. Frontend UI Components (React + Vite)
* `IngestionDashboard.jsx`: Live view of document upload queues.
* `AnomalyAlerts.jsx`: Real-time ML anomaly warning dashboard.
* `KnowledgeGraphViz.jsx`: An interactive D3.js force-directed visualization of the equipment subgraph.
* `EmailThreadTimeline.jsx`: A vertical timeline UI mapping incident-related email threads.

---

## 🛠️ Prerequisites

To run this project locally, ensure you have the following installed on your machine:

1. **Node.js** (v18.x or v20.x) & **npm**
2. **Python 3.8+** (with `scikit-learn` and `numpy` installed via pip for ML anomaly detection)
3. **Docker Desktop** (or equivalent container runtime to easily run Neo4j and Redis)
4. API Keys for LLM Providers (Groq, Gemini, or Anthropic) depending on your configured AI agents.

---

## 📦 Project Setup Instructions

### 1. Start the Required Databases (Docker)

You will need instances of Neo4j (for the Knowledge Graph) and Redis (for the Bull queue). 
You can start them quickly using Docker:

```bash
# Start Neo4j
docker run -d --name neo4j-local -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/testpassword123 neo4j:latest

# Start Redis
docker run -d --name redis-local -p 6379:6379 redis:alpine
```

### 2. Configure Backend Environment

Navigate to the backend directory and set up your environment variables:

```bash
cd backend
npm install
```

Create a `.env` file in the `backend/` directory with the following structure:
```env
# Database Connections
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=testpassword123
REDIS_URL=redis://127.0.0.1:6379

# Server Config
PORT=3010
FRONTEND_URL=http://localhost:5173

# AI Provider Keys
GROQ_API_KEY=your_groq_api_key
GEMINI_API_KEY=your_gemini_api_key
```

### 3. Initialize & Seed the Database

Before starting the server, initialize the Neo4j schema (indexes and constraints) and run the database seeder to populate test data into the graph.

```bash
# Verify connection and set up schema
node scripts/init-db.js

# Run the ingestion pipeline on sample incident reports
node scripts/seed-db.js
```

### 4. Start the Backend Server

Start the Express backend and background workers:
```bash
npm run dev
# OR
node src/server.js
```

### 5. Start the Frontend Application

Open a new terminal window, navigate to the frontend directory, install dependencies, and start the Vite dev server:

```bash
cd frontend
npm install
npm run dev
```

Your frontend application will be available at `http://localhost:5173`.
