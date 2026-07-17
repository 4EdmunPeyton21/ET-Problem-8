# Industrial Knowledge Intelligence - Project Context

This document serves as the comprehensive "brain dump" and context repository for the Industrial Knowledge Intelligence project. It covers the architecture, features, tech stack, and progress made so far.

## 1. Project Overview
The project is a full-stack, AI-powered industrial intelligence application. It ingests unstructured industrial documents (manuals, incident reports, sensor logs), extracts entities and relationships using LLMs to build a Knowledge Graph in Neo4j, and provides intelligent agents and analytics (like ML-based anomaly detection) to answer questions, diagnose root causes, and audit compliance.

## 2. Architecture & Tech Stack
*   **Frontend**: React.js, Vite, Tailwind CSS v4.
*   **Backend**: Node.js, Express.js.
*   **Database**: Neo4j (Graph Database) as the single source of truth.
*   **Queue/Workers**: Bull (Redis-backed) for asynchronous document processing.
*   **Real-time Communication**: Socket.io for live updates (progress bars, alerts) from backend to frontend.
*   **AI/LLMs**: Groq (`llama-3.3-70b-versatile`) as the primary provider, with Gemini as a fallback.
*   **Machine Learning**: Python 3, `scikit-learn` (`IsolationForest`), `numpy` for anomaly detection.

## 3. Data Model (Neo4j Graph Infrastructure)
*   Managed centrally via `GraphManager` (`backend/src/graph/graph-manager.js`), utilizing connection pooling and idempotent `MERGE` operations.
*   **Nodes**: `Document`, `Equipment`, `Incident`, `Parameter`, etc.
*   **Relationships**: `FAILED_DUE_TO`, `FAILED_AT`, `OCCURRED_ON`, `MEASURED_PARAMETER`, `HAS_PARAMETER`, etc.
*   Scripts: `init-db.js` for schema/constraints, `seed-db.js` for sample data.

## 4. Core Features Implemented

### A. Document Ingestion Pipeline
*   **Upload Route** (`POST /api/documents/upload`): Handles multipart file uploads via `multer`, saves locally, creates a `Document` node in Neo4j, and enqueues a job.
*   **Ingestion Worker** (`backend/src/workers/ingestion-worker.js`): A 5-stage asynchronous pipeline processing files from the Bull queue:
    1.  Parse (extract text based on file type, falling back to raw text).
    2.  NER (Named Entity Recognition via LLM).
    3.  Relationship Extraction.
    4.  Save to Graph (Neo4j).
    5.  Complete.
*   **Real-time Progress**: The worker uses an attached Socket.io instance to emit granular progress updates (e.g., 5%, 15%, 35%, 70%, 100%) to specific job rooms.
*   **Dashboard** (`IngestionDashboard.jsx`): React UI displaying a grid/list of uploaded documents with real-time progress bars, status icons, and extracted entity counts using a custom `useSocket.js` hook.

### B. AI Agent Framework
*   **Query Agent**: An interactive chatbot agent capable of calling tools to query the Neo4j database directly for accurate, factual answers, mitigating hallucinations.
*   **RCA Agent** (Root Cause Analysis): Diagnoses incidents based on historical graph data.
*   **Compliance Agent**: Acts as a regulatory auditor, scanning data for compliance gaps.

### C. ML-Powered Anomaly Detection
*   **Python Engine** (`backend/scripts/anomaly-detect.py`): Reads JSON features from `stdin`, extracts a 3D matrix (`[mtbf, mttr, cost]`), and uses `sklearn.ensemble.IsolationForest` (contamination=0.1) to flag anomalies. Handles edge cases (< 5 records returns all false, NaN replaced with 0). Outputs a simple JSON boolean array.
*   **Node.js Wrapper** (`backend/src/analytics/anomaly-detector.js`): 
    *   Queries Neo4j for equipment maintenance history.
    *   Extracts feature vectors, including a rolling 30-day failure count.
    *   Spawns the Python script via `child_process`.
    *   Classifies detected anomalies (e.g., `FREQUENT_FAILURES`, `HIGH_COST`, `CASCADING_FAILURE`) and assigns severity based on IsolationForest scores and domain thresholds.
    *   Generates plain-language recommendations.
*   **API Route** (`GET /api/anomalies/:equipmentId`): Exposes the anomaly detector.
*   **Dashboard UI** (`AnomalyAlerts.jsx`): React component allowing users to search for equipment. Displays severity-coded cards (with pulsing dots for CRITICAL), IsolationForest score bars, and actionable recommendations. Listens for live `anomaly:detected` Socket.io events.

## 5. Key Files & Directory Structure

```text
/backend
  /src
    /api
      routes.js                  # Express routes (Upload, Status, Anomalies, Compliance)
    /analytics
      anomaly-detector.js        # Node wrapper for ML, feature extraction, classification
    /graph
      graph-manager.js           # Neo4j singleton class
    /workers
      ingestion-worker.js        # Bull queue worker for document processing pipeline
    server.js                    # Main Express server entry point (port 3010)
  /scripts
    anomaly-detect.py            # Python IsolationForest implementation
    init-db.js                   # Neo4j schema init
    seed-db.js                   # Mock data seeding
    test-upload-pipeline.js      # E2E test script for upload -> Neo4j flow
  .env                           # Environment variables (Ports, Groq/Gemini API keys, Neo4j URIs)

/frontend
  /src
    /components
      IngestionDashboard.jsx     # UI for document upload & progress
      AnomalyAlerts.jsx          # UI for anomaly detection results
    /hooks
      useSocket.js               # React hook for Socket.io management
    index.css                    # Tailwind v4 styles
  vite.config.js                 # Vite config with proxy to backend
```

## 6. Current Status & Verification
*   **Upload Pipeline**: Fully built and E2E tested. A file can be uploaded, processed by the queue, run through the LLM for extraction, saved to Neo4j, and the frontend updates in real-time.
*   **Anomaly Detection**: Fully built and tested. The Node-to-Python bridge works smoothly, handles edge cases perfectly, and surfaces rich, categorized data to the React UI.

## 7. Next Steps / Pending Tasks
*   **Compliance Agent Integration**: Connect the `ComplianceAgent` to Socket.io to broadcast alerts for `HIGH` severity gaps to the frontend dashboard.
*   **Frontend UI Review**: Run both servers (`npm run dev` in frontend, `node src/server.js` in backend) and manually verify the UI aesthetics, ensuring it meets the "premium, state-of-the-art" design requirements (dark mode, glassmorphism, animations).
