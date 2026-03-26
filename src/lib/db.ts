import initSqlJs, { type Database as SqlJsDatabase, type QueryExecResult } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { loadAllData, flattenRecord } from './ingest';

let db: SqlJsDatabase | null = null;
let dbInitPromise: Promise<SqlJsDatabase> | null = null;

function getDataDir(): string {
  const candidates = [
    path.join(process.cwd(), 'data'),
    path.join(__dirname, '..', '..', '..', 'data'),
    path.join(__dirname, '..', '..', 'data'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

// Sanitize column names for SQL
function sanitizeCol(col: string): string {
  return col.replace(/[^a-zA-Z0-9_]/g, '_');
}

async function initDb(): Promise<SqlJsDatabase> {
  if (db) return db;

  const SQL = await initSqlJs({
    locateFile: (file: string) => {
      // Try multiple locations for the WASM file
      const candidates = [
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
        path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', file),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
      return candidates[0];
    }
  });

  // Try to load pre-built DB file
  const dbCandidates = [
    path.join(process.cwd(), 'data', 'otc.db'),
    path.join(__dirname, '..', '..', '..', 'data', 'otc.db'),
    '/tmp/otc.db',
  ];

  for (const dbPath of dbCandidates) {
    if (fs.existsSync(dbPath)) {
      try {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
        console.log('[DB] Loaded pre-built database from:', dbPath);
        return db;
      } catch (e) {
        console.log('[DB] Failed to load from', dbPath, ':', (e as Error).message);
      }
    }
  }

  // Build database in memory from JSONL files
  console.log('[DB] Building database in memory from JSONL files');
  db = new SQL.Database();
  const dataDir = getDataDir();
  console.log('[DB] Data dir:', dataDir);
  buildDatabase(db, dataDir);

  // Try to persist to /tmp for reuse
  try {
    const data = db.export();
    fs.writeFileSync('/tmp/otc.db', Buffer.from(data));
    console.log('[DB] Saved database to /tmp/otc.db');
  } catch {
    console.log('[DB] Could not save to /tmp (non-critical)');
  }

  console.log('[DB] Database ready');
  return db;
}

function buildDatabase(database: SqlJsDatabase, dataDir: string) {
  const data = loadAllData(dataDir);

  for (const [entityName, records] of Object.entries(data)) {
    if (records.length === 0) continue;

    const flatRecords = records.map(flattenRecord);

    // Collect all unique columns
    const allColumns = new Set<string>();
    for (const rec of flatRecords) {
      for (const key of Object.keys(rec)) {
        allColumns.add(key);
      }
    }
    const columns = Array.from(allColumns);

    // Create table
    const colDefs = columns.map(c => `"${sanitizeCol(c)}" TEXT`).join(', ');
    database.run(`CREATE TABLE IF NOT EXISTS "${entityName}" (${colDefs})`);

    // Insert data
    const placeholders = columns.map(() => '?').join(', ');
    const colNames = columns.map(c => `"${sanitizeCol(c)}"`).join(', ');
    const insertSql = `INSERT INTO "${entityName}" (${colNames}) VALUES (${placeholders})`;

    database.run('BEGIN TRANSACTION');
    for (const rec of flatRecords) {
      const values = columns.map(c => rec[c] ?? null);
      database.run(insertSql, values);
    }
    database.run('COMMIT');

    // Create indexes
    const indexColumns = [
      'salesOrder', 'salesOrderItem', 'deliveryDocument', 'deliveryDocumentItem',
      'billingDocument', 'billingDocumentItem', 'material', 'product', 'plant',
      'customer', 'businessPartner', 'soldToParty', 'accountingDocument',
      'referenceDocument', 'referenceSdDocument', 'referenceSdDocumentItem',
      'clearingAccountingDocument', 'companyCode', 'fiscalYear'
    ];

    for (const col of indexColumns) {
      if (columns.includes(col)) {
        try {
          database.run(
            `CREATE INDEX IF NOT EXISTS "idx_${entityName}_${sanitizeCol(col)}" ON "${entityName}" ("${sanitizeCol(col)}")`
          );
        } catch { /* skip */ }
      }
    }
  }
}

export async function getDb(): Promise<SqlJsDatabase> {
  if (db) return db;
  if (!dbInitPromise) {
    dbInitPromise = initDb();
  }
  return dbInitPromise;
}

export async function executeQuery(sql: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
  const database = await getDb();
  try {
    const result = database.exec(sql);
    if (result.length === 0) {
      return { columns: [], rows: [] };
    }
    const { columns, values } = result[0];
    const rows = values.slice(0, 100).map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col: string, i: number) => { obj[col] = row[i]; });
      return obj;
    });
    return { columns, rows };
  } catch (error) {
    throw new Error(`SQL execution error: ${(error as Error).message}`);
  }
}

export async function getTableSchema(): Promise<string> {
  const database = await getDb();
  const tablesResult = database.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  if (tablesResult.length === 0) return '';

  const tableNames = tablesResult[0].values.map((r: unknown[]) => r[0] as string);
  const schemas: string[] = [];

  for (const name of tableNames) {
    const info = database.exec(`PRAGMA table_info("${name}")`);
    if (info.length === 0) continue;
    const cols = info[0].values.map((r: unknown[]) => `  ${r[1]} ${r[2] || 'TEXT'}`).join(',\n');
    schemas.push(`CREATE TABLE ${name} (\n${cols}\n);`);

    const sample = database.exec(`SELECT * FROM "${name}" LIMIT 1`);
    if (sample.length > 0 && sample[0].values.length > 0) {
      const obj: Record<string, unknown> = {};
      sample[0].columns.forEach((col: string, i: number) => { obj[col] = sample[0].values[0][i]; });
      schemas.push(`-- Sample: ${JSON.stringify(obj)}`);
    }
  }

  return schemas.join('\n\n');
}

export async function getTableNames(): Promise<string[]> {
  const database = await getDb();
  const result = database.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  if (result.length === 0) return [];
  return result[0].values.map((r: unknown[]) => r[0] as string);
}
