// Pre-build script: generates SQLite database from JSONL files
// Run this before deployment to ensure the DB exists

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'otc.db');

// Remove existing DB
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log('Removed existing database');
}

function flattenValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    if ('hours' in value && 'minutes' in value && 'seconds' in value) {
      return `${String(value.hours).padStart(2, '0')}:${String(value.minutes).padStart(2, '0')}:${String(value.seconds).padStart(2, '0')}`;
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const dirs = fs.readdirSync(DATA_DIR, { withFileTypes: true });

for (const dir of dirs) {
  if (!dir.isDirectory()) continue;
  const entityName = dir.name;
  const entityDir = path.join(DATA_DIR, entityName);
  const files = fs.readdirSync(entityDir).filter(f => f.endsWith('.jsonl'));

  const records = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(entityDir, file), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { records.push(JSON.parse(trimmed)); } catch {}
    }
  }

  if (records.length === 0) continue;

  // Flatten records
  const flatRecords = records.map(rec => {
    const flat = {};
    for (const [key, value] of Object.entries(rec)) {
      flat[key] = flattenValue(value);
    }
    return flat;
  });

  // Get all columns
  const allColumns = new Set();
  for (const rec of flatRecords) {
    for (const key of Object.keys(rec)) allColumns.add(key);
  }
  const columns = Array.from(allColumns);

  // Create table
  const colDefs = columns.map(c => `"${c}" TEXT`).join(', ');
  db.exec(`CREATE TABLE IF NOT EXISTS "${entityName}" (${colDefs})`);

  // Insert data
  const placeholders = columns.map(() => '?').join(', ');
  const colNames = columns.map(c => `"${c}"`).join(', ');
  const insert = db.prepare(`INSERT INTO "${entityName}" (${colNames}) VALUES (${placeholders})`);

  const insertMany = db.transaction((recs) => {
    for (const rec of recs) {
      const values = columns.map(c => rec[c] ?? null);
      insert.run(...values);
    }
  });

  insertMany(flatRecords);

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
        db.exec(`CREATE INDEX IF NOT EXISTS "idx_${entityName}_${col}" ON "${entityName}" ("${col}")`);
      } catch {}
    }
  }

  console.log(`  ${entityName}: ${records.length} records, ${columns.length} columns`);
}

db.close();
console.log(`\nDatabase created at ${DB_PATH}`);
console.log(`Size: ${(fs.statSync(DB_PATH).size / 1024).toFixed(1)} KB`);
