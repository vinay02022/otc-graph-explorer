# AI Coding Session Summary

## Tools Used

- **Claude Code (CLI)** — Used throughout the entire project for planning, coding, debugging and deployment. This was my primary tool.

## How I Used Claude Code

I basically treated Claude Code as a pair programmer. I gave it the assignment PDF, the dataset, and the reference screenshots, then worked through the implementation step by step. I didn't just say "build everything" — I broke it down into smaller pieces and iterated on each part.

My general workflow was:
1. Share the assignment details and dataset with Claude Code
2. Discuss architecture choices (why SQLite over Postgres, why Next.js over separate backend, etc.)
3. Build one module at a time — data layer first, then graph, then LLM, then UI
4. Test each piece before moving to the next
5. Fix issues as they came up

## Key Prompts and Workflows

### Understanding the Data

First thing I did was ask Claude Code to explore all the JSONL files and understand the schema of each entity. I needed to know what fields exist, how entities relate to each other, and what the data actually looks like before writing any code.

This was really important because the SAP data has some quirks — like item numbers being `000010` in delivery tables but `10` in sales order tables. If I hadn't looked at the actual data first, the graph edges would have been broken.

### Architecture Planning

I asked Claude Code to design the full architecture before writing code. We discussed tradeoffs:
- SQLite vs Postgres — went with SQLite because the dataset is only ~24K records, no point setting up a database server for this
- Neo4j vs in-memory graph — same reasoning, dataset is small enough to hold in memory
- Single Next.js app vs separate backend — chose Next.js so I can deploy everything to Vercel in one go
- Gemini vs Groq — Gemini has better free tier limits and is good at SQL generation

### Building the Graph Model

This took some back and forth. The main challenge was figuring out all the relationships between entities. The Order to Cash flow goes:

Sales Order → Delivery → Billing → Journal Entry → Payment

But connecting them is not straightforward because each table uses different reference fields. For example, billing items reference delivery documents through `referenceSdDocument`, and journal entries reference billing documents through `referenceDocument`.

I had to carefully map out all 10 relationship types and make sure the join logic was correct.

### The Item Number Bug

This was the trickiest bug. After building the graph, I noticed that `FULFILLED_BY` and `BILLED_IN` edges were showing zero count. Turned out delivery items store item numbers as `000010` (zero-padded) but sales order items store them as `10` (no padding). Similarly, billing items use `10` format when referencing delivery items that use `000010`.

Had to add normalization logic — strip leading zeros when matching delivery→sales order, and pad with zeros when matching billing→delivery.

### Two-Pass LLM Approach

Initially the chat responses were not great. The LLM would generate SQL and then describe what the query *does* — like "This query finds the top products by joining tables X and Y..." But it never actually told you the *results*.

So I changed it to a two-pass approach:
1. First LLM call: generate the SQL query
2. Execute the SQL against the database
3. Second LLM call: send the actual results back to the LLM and ask it to summarize in natural language

After this change, instead of getting "This query will find the top products...", the response became "The top-selling product is SUNSCREEN GEL SPF50 with 7,694 INR in total billing." Much more useful.

### Guardrails Implementation

I implemented three layers of guardrails:
1. Pre-LLM regex check — catches obvious off-topic stuff like "write me a poem" without wasting an API call
2. System prompt — tells the LLM to refuse non-OTC questions
3. Post-LLM SQL validation — makes sure generated SQL is safe (SELECT only, no system tables, valid table references)

Tested with various off-topic queries to make sure they all get blocked properly.

### Vercel Deployment Struggle

This was honestly the most painful part. The app worked perfectly on localhost but kept failing on Vercel.

First issue: `better-sqlite3` is a native Node module that needs compiled binaries for the target OS. Vercel runs on Linux but my local machine is Windows, so the binary wasn't compatible. Tried several fixes — `serverExternalPackages`, `outputFileTracingIncludes`, building DB in `/tmp` — nothing worked.

Finally switched to `sql.js` which is a pure JavaScript SQLite compiled to WebAssembly. No native binaries needed. Works everywhere. Had to rewrite the entire database layer to be async (since WASM initialization is async), but after that it deployed successfully.

Second issue: the WASM file location. sql.js couldn't find its own `.wasm` file on Vercel because the path was different from local. Had to add a `locateFile` function that tries multiple path candidates.

## How I Debugged

- **Data inspection first** — Before writing any code, I sampled records from every entity table to understand formats and edge cases
- **Incremental testing** — After each module (data layer, graph, LLM, UI), I tested via curl before moving on
- **Console logging** — Added debug logs for database path resolution when Vercel deployment was failing
- **Graph statistics** — After building the graph, I checked node counts and edge counts per type to verify all relationships were correctly linked
- **Multiple query testing** — Tested all three required query patterns plus guardrail rejection before considering it done

## Iterations Summary

1. Built initial version with better-sqlite3 → worked locally
2. Found item number format mismatch → fixed normalization
3. Chat responses were describing SQL instead of results → added two-pass LLM
4. Deployed to Vercel → better-sqlite3 failed → migrated to sql.js
5. sql.js WASM file not found → added locateFile configuration
6. Final deployment successful, all features verified on production URL
