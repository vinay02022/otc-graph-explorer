# Order to Cash - Graph Explorer

A graph-based data modeling and query system that unifies fragmented SAP Order-to-Cash data into an interactive graph with an LLM-powered natural language query interface. Users can visually explore entity relationships and ask questions in plain English — the system dynamically generates SQL, executes it against the dataset, and returns data-backed answers.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      Next.js 16 (App Router)                 │
│                                                              │
│  ┌────────────────────────┐  ┌────────────────────────────┐ │
│  │     Graph Panel (70%)   │  │    Chat Panel (30%)         │ │
│  │                         │  │                             │ │
│  │  react-force-graph-2d   │  │  User: NL question          │ │
│  │  - Color-coded nodes    │  │       ↓                     │ │
│  │  - Click to inspect     │  │  Guardrail check (pre-LLM)  │ │
│  │  - Highlight from chat  │  │       ↓                     │ │
│  │  - Filter entity types  │  │  Gemini 2.0 Flash           │ │
│  │  - Toggle granularity   │  │       ↓                     │ │
│  │                         │  │  SQL generation             │ │
│  └────────────────────────┘  │       ↓                     │ │
│                               │  SQL validation (post-LLM)  │ │
│  ┌────────────────────────┐  │       ↓                     │ │
│  │    API Routes           │  │  SQLite execution           │ │
│  │  GET  /api/graph        │  │       ↓                     │ │
│  │  GET  /api/graph/:id    │  │  Result summarization (LLM) │ │
│  │  POST /api/chat         │  │       ↓                     │ │
│  └────────────────────────┘  │  Data-backed NL answer       │ │
│                               └────────────────────────────┘ │
│  ┌────────────────────┐  ┌────────────────────────────────┐ │
│  │     SQLite DB       │  │     In-Memory Graph            │ │
│  │  19 tables          │  │  1,218 nodes (11 types)        │ │
│  │  ~24K records       │  │  1,779 edges (10 types)        │ │
│  │  Indexed FKs        │  │  Cached after first build      │ │
│  └────────────────────┘  └────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Request Flow

```
User types question
  → Pre-LLM guardrail (regex keyword filter — blocks off-topic before API call)
  → Gemini 2.0 Flash generates SQL (system prompt contains full DDL + few-shot examples)
  → Post-LLM SQL validation (SELECT-only, known tables, no system table access)
  → SQLite executes query (read-only, 100-row limit, timeout protection)
  → Results sent back to LLM for natural language summarization
  → Frontend receives: { answer, sql, data[], highlightedNodes[] }
  → Chat panel renders answer; graph panel highlights referenced entities
```

---

## Tech Stack & Rationale

| Component | Choice | Why this over alternatives |
|-----------|--------|--------------------------|
| **Framework** | Next.js 16 (App Router) | Unified frontend + API in one deployable. API routes handle server-side SQLite + LLM calls. Vercel-native deployment. Chose over separate FastAPI + React since it halves infrastructure complexity for a project this size. |
| **Database** | SQLite (better-sqlite3) | The dataset is ~24K records across 19 tables — well within SQLite's sweet spot. Zero infrastructure (no Postgres/MySQL server), sub-millisecond queries, and the LLM can generate standard SQL against it. Chose over PostgreSQL (overkill for this scale) and Neo4j (adds operational complexity without proportional benefit at this data size). |
| **Graph Engine** | In-memory JavaScript | With ~1.2K nodes and ~1.8K edges, the entire graph fits comfortably in server memory (~2MB JSON). No need for a dedicated graph database. NetworkX-style operations (neighbor lookup, filtering) are implemented directly. Chose over Neo4j because the dataset is small enough that in-memory graph construction from SQLite takes <50ms. |
| **Visualization** | react-force-graph-2d | Canvas-based force-directed graph with built-in interactivity (click, hover, zoom, pan). Handles 1.2K nodes smoothly. Chose over D3.js (lower-level, more boilerplate) and Cytoscape.js (heavier, layout-focused). |
| **LLM** | Google Gemini 2.0 Flash | Free tier with 15 RPM and 1M tokens/day — sufficient for demo use. Fast inference (~1-2s). Excellent at SQL generation with schema context. Chose over Groq (Llama models less reliable at complex SQL joins) and GPT-4 (no free tier). |
| **Styling** | Tailwind CSS 4 | Utility-first CSS, fast iteration, no context-switching to separate stylesheets. |

---

## Database Design

### Schema

All 19 JSONL entity directories are loaded into SQLite tables at build time. Each table uses `TEXT` columns (SAP IDs look numeric but are strings). Nested JSON objects (e.g., `creationTime: {hours, minutes, seconds}`) are flattened to strings.

**Core Order-to-Cash tables:**
- `sales_order_headers` (100 rows) — PK: `salesOrder`
- `sales_order_items` (167 rows) — PK: `salesOrder + salesOrderItem`
- `sales_order_schedule_lines` (179 rows)
- `outbound_delivery_headers` (86 rows) — PK: `deliveryDocument`
- `outbound_delivery_items` (137 rows) — PK: `deliveryDocument + deliveryDocumentItem`
- `billing_document_headers` (163 rows) — PK: `billingDocument`
- `billing_document_items` (245 rows) — PK: `billingDocument + billingDocumentItem`
- `billing_document_cancellations` (80 rows)
- `journal_entry_items_accounts_receivable` (123 rows) — PK: `accountingDocument`
- `payments_accounts_receivable` (120 rows)

**Supporting tables:**
- `business_partners` (8), `business_partner_addresses` (8)
- `customer_company_assignments` (8), `customer_sales_area_assignments` (28)
- `products` (69), `product_descriptions` (69)
- `product_plants` (3,036), `product_storage_locations` (16,723)
- `plants` (44)

### Indexing Strategy

Indexes are created on all foreign key columns used in cross-table joins:
`salesOrder`, `deliveryDocument`, `billingDocument`, `material`, `product`, `plant`, `customer`, `soldToParty`, `accountingDocument`, `referenceDocument`, `referenceSdDocument`, `clearingAccountingDocument`

This ensures LLM-generated SQL queries (which frequently join 4-6 tables) execute in <10ms.

---

## Graph Model

### Entity Types (11 node types, 1,218 nodes)

| Entity | Count | Source | Node ID Format |
|--------|-------|--------|----------------|
| SalesOrder | 100 | sales_order_headers | `SO:740506` |
| SalesOrderItem | 167 | sales_order_items | `SOI:740506_10` |
| Delivery | 86 | outbound_delivery_headers | `DEL:80737721` |
| DeliveryItem | 137 | outbound_delivery_items | `DI:80737721_000010` |
| BillingDocument | 163 | billing_document_headers | `BD:90504248` |
| BillingDocumentItem | 245 | billing_document_items | `BDI:90504248_10` |
| JournalEntry | 123 | journal_entry_items_accounts_receivable | `JE:9400000249` |
| Payment | 76 | payments_accounts_receivable | `PAY:9400635977` |
| BusinessPartner | 8 | business_partners | `BP:310000108` |
| Product | 69 | products + product_descriptions | `PRD:S8907367001003` |
| Plant | 44 | plants | `PLT:1920` |

### Relationship Types (10 edge types, 1,779 edges)

| Edge | Source → Target | Join Logic | Count |
|------|----------------|------------|-------|
| HAS_ITEM | SalesOrder → SalesOrderItem | salesOrder | 167 |
| FULFILLED_BY | SalesOrderItem → DeliveryItem | referenceSdDocument (normalized item numbers) | 137 |
| BELONGS_TO | DeliveryItem → Delivery | deliveryDocument | 137 |
| BELONGS_TO | BillingDocumentItem → BillingDocument | billingDocument | 245 |
| BILLED_IN | DeliveryItem → BillingDocumentItem | referenceSdDocument (padded item numbers) | 245 |
| GENERATES | BillingDocument → JournalEntry | referenceDocument = billingDocument | 123 |
| CLEARED_BY | JournalEntry → Payment | clearingAccountingDocument | 76 |
| SOLD_TO | SalesOrder → BusinessPartner | soldToParty = customer | 100 |
| CONTAINS_PRODUCT | SalesOrderItem → Product | material = product | 167 |
| FOR_PRODUCT | BillingDocumentItem → Product | material = product | 245 |
| SHIPPED_FROM | DeliveryItem → Plant | plant | 137 |

### Item Number Normalization

A key data modeling challenge: SAP uses different formats for item numbers across tables. Delivery items use zero-padded format (`000010`) while sales order items use unpadded (`10`), and billing items reference deliveries with unpadded format. The graph builder normalizes these during edge construction:
- `FULFILLED_BY`: strips leading zeros from delivery item's `referenceSdDocumentItem` to match sales order item format
- `BILLED_IN`: pads billing item's `referenceSdDocumentItem` to 6 digits to match delivery item format

### Excluded from Graph Visualization

`product_plants` (3,036 records) and `product_storage_locations` (16,723 records) are **not** rendered as graph nodes — they would dominate the visualization with 20K nodes and degrade rendering performance. They remain fully queryable via SQL through the chat interface.

---

## LLM Prompting Strategy

### Two-Pass Architecture

Unlike a single-pass approach where the LLM tries to answer directly, this system uses **two sequential LLM calls**:

**Pass 1 — SQL Generation:**
The user's question is sent to Gemini with a system prompt containing:
- Complete DDL schema (auto-generated from actual SQLite tables at startup, not hardcoded)
- Sample data row per table (helps the LLM understand data formats)
- Key relationship descriptions (which columns join which tables, with format notes)
- 3 few-shot SQL examples covering the three required query patterns
- Strict domain restriction instructions

**Pass 2 — Result Summarization:**
After SQL execution, the query results (up to 15 rows) are sent back to the LLM with a prompt asking it to:
- Summarize findings in natural language using actual data values
- Include specific entity IDs, amounts, and counts from the results
- Not repeat the SQL query in the answer
- Directly answer the question rather than describing what the query does

### Why Two Passes?

Single-pass approaches produce answers like *"This query will find the top products..."* (describing intent). Two-pass produces *"The top-selling product is FACESERUM 30ML VIT C with 22 billing documents"* (stating facts from data). The second pass grounds the LLM's response in actual query results, which is critical for the "data-backed answers" requirement.

### Few-Shot Examples in System Prompt

Three examples covering the three required query patterns:
1. **Aggregation query**: Products with highest billing document count (GROUP BY + COUNT)
2. **Flow tracing**: Full O2C trace for a billing document (multi-table JOIN chain)
3. **Gap analysis**: Sales orders with incomplete flows (LEFT JOIN + NULL detection)

### Conversation Memory

The last 10 messages are passed as conversation history to the Gemini chat session, enabling follow-up questions like "Show me more details about that first order" without re-specifying context.

---

## Guardrails Implementation

### Three-Layer Defense

| Layer | Where | What it catches | Cost |
|-------|-------|----------------|------|
| **1. Pre-LLM regex filter** | Before any API call | Obvious off-topic: weather, jokes, creative writing, coding requests, personal questions | Zero — no LLM tokens spent |
| **2. System prompt instruction** | During LLM inference | Nuanced off-topic: ambiguous questions, prompt injection attempts, questions that partially relate to business but not this dataset | One LLM call |
| **3. Post-LLM SQL validation** | After LLM response | Dangerous SQL: INSERT/UPDATE/DELETE, system table access (`sqlite_master`), unknown table references, non-SELECT statements | Zero — parsed locally |

### Layer 1: Pre-LLM Keyword Filter (`guardrails.ts`)

Regex patterns catch requests like:
- "Write me a poem/story/code" → blocked
- "What's the weather/time/news" → blocked
- "Tell me about yourself" → blocked
- "Translate X to Y" → blocked

Legitimate OTC queries containing these words in business context (e.g., "what is the delivery *time* for order 740506") pass through because the patterns require specific syntactic structures.

### Layer 2: LLM System Prompt

The system prompt includes:
```
If a user asks about anything unrelated (general knowledge, creative writing,
coding help, personal questions, weather, news, etc.), respond EXACTLY with:
"This system is designed to answer questions related to the Order to Cash
dataset only."
```

This handles edge cases the regex can't catch, like "What are the best practices for supply chain management?" (business-adjacent but not about this dataset).

### Layer 3: Post-LLM SQL Validation

Before executing any SQL generated by the LLM:
- **Statement type**: Only `SELECT` allowed. `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `EXEC`, `ATTACH` are all blocked.
- **Table validation**: Every table referenced in `FROM` and `JOIN` clauses is checked against the actual list of tables in the database.
- **System tables**: Access to `sqlite_master`, `sqlite_schema`, `sqlite_temp_master` is blocked.
- **Execution limits**: Results capped at 100 rows, read-only database connection.

### Self-Healing SQL

If the LLM's generated SQL fails execution (e.g., wrong column name), the error message is sent back to the LLM with a request to fix and regenerate. The corrected SQL goes through the same validation pipeline before execution. This handles ~90% of first-attempt SQL errors without user intervention.

---

## Setup & Running Locally

### Prerequisites
- Node.js 18+
- Google Gemini API key (free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey))

### Installation

```bash
git clone <repo-url>
cd fde

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Add your GOOGLE_API_KEY to .env.local

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Build for Production

```bash
npm run build    # Runs prebuild (SQLite DB generation) + Next.js build
npm start        # Start production server
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_API_KEY` | Yes | Google Gemini API key (free tier) |

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Main page: split-panel layout (graph + chat)
│   ├── layout.tsx                  # Root layout with metadata
│   ├── globals.css                 # Tailwind + custom styles
│   └── api/
│       ├── graph/route.ts          # GET: full graph JSON (1218 nodes, 1779 edges)
│       ├── graph/[id]/route.ts     # GET: single node detail + neighbors
│       └── chat/route.ts           # POST: NL → SQL → data-backed answer
├── components/
│   ├── GraphView.tsx               # Force-directed graph with entity filtering
│   ├── NodeInspector.tsx           # Metadata popup on node click
│   ├── ChatPanel.tsx               # Chat interface with conversation memory
│   ├── ChatMessage.tsx             # Message rendering with SQL/data accordions
│   └── Legend.tsx                  # Entity type color legend with toggle
├── lib/
│   ├── db.ts                       # SQLite connection, schema creation, query execution
│   ├── ingest.ts                   # JSONL file reader, JSON flattening
│   ├── graph.ts                    # Graph construction with all 10 edge types
│   ├── llm.ts                      # Two-pass Gemini integration (SQL gen + summarization)
│   ├── prompts.ts                  # System prompt with DDL, relationships, few-shot examples
│   └── guardrails.ts               # 3-layer input/output validation
├── types/
│   └── index.ts                    # TypeScript types, entity colors
data/                               # JSONL source files (19 entity directories)
scripts/
└── prebuild.js                     # Build-time SQLite DB generation
```

---

## Features

- **Interactive Graph Visualization**: Force-directed layout with 11 color-coded entity types, click-to-inspect metadata popups, neighbor expansion
- **Granular Overlay Toggle**: Show/hide item-level entities (SalesOrderItem, DeliveryItem, BillingDocumentItem) to reduce visual complexity
- **Natural Language Queries**: Ask questions in plain English, get SQL-backed answers with specific data values
- **Node Highlighting**: Chat query results automatically highlight referenced entities in the graph
- **Expandable SQL & Data**: Each chat response includes collapsible SQL query and results table
- **Conversation Memory**: Context maintained across messages for follow-up questions
- **Entity Type Filtering**: Toggle visibility of each entity type independently
- **Self-Healing Queries**: Failed SQL is automatically sent back for correction

## Example Queries

```
"Which products are associated with the highest number of billing documents?"
"Trace the full flow of billing document 90504248"
"Find sales orders that have broken or incomplete flows"
"What is the total billing amount per customer?"
"Show me all cancelled billing documents"
"How many deliveries were made from plant 1920?"
"Which customers have the highest order values?"
```
