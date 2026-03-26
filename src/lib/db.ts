import Database from 'better-sqlite3';
import path from 'path';
import { loadAllData, flattenRecord } from './ingest';

let db: Database.Database | null = null;

// Try multiple paths for Vercel compatibility
function getDbPath(): string {
  const fs = require('fs');
  const candidates = [
    path.join(process.cwd(), 'data', 'otc.db'),
    path.join(__dirname, '..', '..', '..', 'data', 'otc.db'),
    path.join(__dirname, '..', '..', 'data', 'otc.db'),
    '/tmp/otc.db',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]; // default, will trigger DB creation
}

function getDataDir(): string {
  const fs = require('fs');
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

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

// Convert camelCase entity dir name to table name
function toTableName(dirName: string): string {
  return dirName; // already snake_case from directory names
}

export function getDb(): Database.Database {
  if (db) return db;

  const fs = require('fs');
  let dbPath = getDbPath();

  // If DB doesn't exist at any candidate path, try building in /tmp for serverless
  if (!fs.existsSync(dbPath)) {
    dbPath = '/tmp/otc.db';
  }

  const dbExists = fs.existsSync(dbPath);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');

  if (!dbExists) {
    const dataDir = getDataDir();
    initializeDatabaseWithDir(db, dataDir);
  }

  return db;
}

function initializeDatabaseWithDir(database: Database.Database, dataDir: string) {
  const data = loadAllData(dataDir);

  for (const [entityName, records] of Object.entries(data)) {
    if (records.length === 0) continue;

    const tableName = toTableName(entityName);
    const flatRecords = records.map(flattenRecord);

    // Collect all unique columns across all records
    const allColumns = new Set<string>();
    for (const rec of flatRecords) {
      for (const key of Object.keys(rec)) {
        allColumns.add(key);
      }
    }
    const columns = Array.from(allColumns);

    // Create table
    const colDefs = columns.map(c => `"${sanitizeCol(c)}" TEXT`).join(', ');
    database.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs})`);

    // Insert data
    const placeholders = columns.map(() => '?').join(', ');
    const colNames = columns.map(c => `"${sanitizeCol(c)}"`).join(', ');
    const insert = database.prepare(
      `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`
    );

    const insertMany = database.transaction((recs: Record<string, string | null>[]) => {
      for (const rec of recs) {
        const values = columns.map(c => rec[c] ?? null);
        insert.run(...values);
      }
    });

    insertMany(flatRecords);

    // Create indexes on common FK columns
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
          database.exec(
            `CREATE INDEX IF NOT EXISTS "idx_${tableName}_${sanitizeCol(col)}" ON "${tableName}" ("${sanitizeCol(col)}")`
          );
        } catch {
          // skip if index creation fails
        }
      }
    }
  }
}

export function executeQuery(sql: string): { columns: string[]; rows: Record<string, unknown>[] } {
  const database = getDb();
  try {
    const stmt = database.prepare(sql);
    const rows = stmt.all() as Record<string, unknown>[];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { columns, rows: rows.slice(0, 100) }; // limit to 100 rows
  } catch (error) {
    throw new Error(`SQL execution error: ${(error as Error).message}`);
  }
}

export function getTableSchema(): string {
  const database = getDb();
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];

  const schemas: string[] = [];
  for (const { name } of tables) {
    const info = database
      .prepare(`PRAGMA table_info("${name}")`)
      .all() as { name: string; type: string }[];
    const cols = info.map(c => `  ${c.name} ${c.type || 'TEXT'}`).join(',\n');
    schemas.push(`CREATE TABLE ${name} (\n${cols}\n);`);

    // Add sample data as comment
    const sample = database.prepare(`SELECT * FROM "${name}" LIMIT 2`).all() as Record<string, unknown>[];
    if (sample.length > 0) {
      schemas.push(`-- Sample: ${JSON.stringify(sample[0])}`);
    }
  }

  return schemas.join('\n\n');
}

export function getTableNames(): string[] {
  const database = getDb();
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  return tables.map(t => t.name);
}
