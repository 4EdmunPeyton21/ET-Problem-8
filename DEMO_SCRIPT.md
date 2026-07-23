# IKI Demo Script (~2:45)

**Before recording:** backend + frontend + docker-compose already running, real mode (`VITE_API_URL` set), graph seeded via `backend/scripts/demo-seed.cypher`. Don't re-run `npm run start` on the backend mid-recording — it re-runs schema init (harmless now, but no reason to risk it). Have `backend/uploads/samples/incident_report_2024_jan.txt` ready to drag in.

---

### 0:00–0:15 — Hook (Dashboard)
> "Industrial plants generate a massive, disconnected paper trail — PDF manuals, emails, inspection reports. When something fails at 2am, finding out 'has this happened before, and why' means digging through a dozen file formats nobody has time for. IKI turns that paper trail into a live knowledge graph — and then uses it."

Screen: Dashboard (`/`). Just glance across the quick-action cards.

### 0:15–0:50 — Live ingestion (the real-time wow moment)
> "Let's upload a real incident report."

Screen: `/ingestion`. Drag in `incident_report_2024_jan.txt`. **Narrate the live progress bar as it moves** — parsing → NER → relationships → Neo4j — this is genuinely happening in real time over Socket.io, not a canned animation. When it completes, point at the entity/relationship counts.

> "That's a real NER pipeline — Groq primary, Gemini fallback, rule-based beneath that if both are down — extracting equipment, incidents, and procedures straight into Neo4j, with live progress the whole way."

### 0:50–1:15 — Equipment (the payoff of ingestion)
Screen: `/equipment` → click **PUMP-101**.

> "Here's the asset that document was about. Every failure, procedure, and parameter reading on one timeline — this pump has a real problem: three bearing-related incidents in the last month, culminating in a repeat overheating event just one day after the first."

Scroll the history timeline briefly.

### 1:15–1:45 — RCA Assistant (AI reasoning)
Screen: `/rca`. Select **PUMP-101**, type: *"Pump is overheating again, vibration climbing, second time this month"* → Run analysis.

> "Instead of a technician manually cross-referencing history, IKI ranks probable causes, cites similar past incidents, and gives diagnostic steps — grounded in this equipment's actual graph data, not a generic answer."

Point at the confidence badge and the "similar historical incidents" card.

### 1:45–2:10 — Anomaly Alerts (the ML moment)
Screen: `/anomalies`.

> "This isn't just historical lookup — an Isolation Forest model runs over every asset's maintenance cadence. PUMP-101 gets flagged CRITICAL: mean time between failures dropped from a healthy ~55 days to just 7. That's the model catching the same pattern we just diagnosed manually — automatically, across the whole plant."

### 2:10–2:35 — Knowledge Graph
Screen: `/graph`. Enter `PUMP-101` → Visualize.

> "And here's that whole story as a graph — the pump, its incidents, the lubrication procedure, the vibration parameter — explorable, not just a list."

Drag a node or two to show it's interactive.

### 2:35–2:55 — Email Thread Timeline
Screen: `/emails`. Enter `THREAD-INC-2024-018` → Load thread.

> "And because half of incident response happens over email, IKI reconstructs that correspondence too — alert, dispatch, root cause, resolution — linked back to the incident it resolved."

### 2:55–3:00 — Close
> "Upload, extract, graph, diagnose, detect, visualize — one pipeline, one plant's worth of tribal knowledge, finally searchable."

---

## If something goes wrong live
- **Ingestion seems stuck / no live progress**: check the socket indicator in the header (top-left, "Live" vs "Offline / mock"). If it says mock, `VITE_API_URL` isn't set in `frontend/.env.local` — restart `npm run dev` after fixing it.
- **RCA/anomalies return generic results**: Groq's daily token limit may be hit — everything still works via heuristic/rule-based fallback, just less impressive. Check backend logs for `rate_limit_exceeded`.
- **Graph/anomalies show unexpected extra equipment**: something uploaded to the real backend since the last seed. Re-run: `docker exec et-problem-8-neo4j-1 cypher-shell -u neo4j -p testpassword123 "MATCH (n) DETACH DELETE n"` then re-seed with `docker exec -i et-problem-8-neo4j-1 cypher-shell -u neo4j -p testpassword123 < backend/scripts/demo-seed.cypher`.
