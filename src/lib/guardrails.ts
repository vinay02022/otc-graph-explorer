import { getTableNames } from './db';

const OFF_TOPIC_PATTERNS = [
  /write\s+(me\s+)?(a\s+)?(poem|story|essay|song|joke|code|script|program)/i,
  /what('s| is) the (weather|time|date|news)/i,
  /tell me (a joke|about yourself|who you are)/i,
  /how (old are you|do you feel|are you doing)/i,
  /translate .+ (to|into) /i,
  /what (do you think|is your opinion)/i,
  /can you (help me with|write|code|generate) (?!.*(?:sql|query|order|delivery|billing|invoice|payment|product|customer|sales|journal|plant))/i,
  /recipe|cooking|health|medical|political|election/i,
];

export function validateInput(message: string): { valid: boolean; reason?: string } {
  const trimmed = message.trim();

  if (trimmed.length === 0) {
    return { valid: false, reason: 'Empty message' };
  }

  if (trimmed.length > 2000) {
    return { valid: false, reason: 'Message too long. Please keep your query concise.' };
  }

  // Check for obvious off-topic queries
  for (const pattern of OFF_TOPIC_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        valid: false,
        reason: 'This system is designed to answer questions related to the Order to Cash dataset only. Please ask questions about sales orders, deliveries, billing documents, payments, products, customers, or their relationships.',
      };
    }
  }

  return { valid: true };
}

export function validateSQL(sql: string): { valid: boolean; reason?: string } {
  const normalized = sql.trim().toUpperCase();

  // Only allow SELECT statements
  if (!normalized.startsWith('SELECT')) {
    return { valid: false, reason: 'Only SELECT queries are allowed.' };
  }

  // Block dangerous statements
  const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC', 'EXECUTE', 'ATTACH', 'DETACH'];
  for (const keyword of forbidden) {
    // Check for standalone keyword (not as part of a column/table name)
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(sql) && keyword !== 'CREATE') {
      return { valid: false, reason: `${keyword} statements are not allowed.` };
    }
    // Special handling for CREATE - only block if not in a string/comment
    if (keyword === 'CREATE' && regex.test(sql.replace(/'[^']*'/g, ''))) {
      return { valid: false, reason: 'CREATE statements are not allowed.' };
    }
  }

  // Block access to system tables
  if (/sqlite_master|sqlite_schema|sqlite_temp_master/i.test(sql)) {
    return { valid: false, reason: 'Access to system tables is not allowed.' };
  }

  // Validate table references against known tables
  try {
    const tableNames = getTableNames();
    const tablePattern = /\bFROM\b\s+"?(\w+)"?|\bJOIN\b\s+"?(\w+)"?/gi;
    let match;
    while ((match = tablePattern.exec(sql)) !== null) {
      const tableName = (match[1] || match[2]).toLowerCase();
      if (!tableNames.map(t => t.toLowerCase()).includes(tableName)) {
        return { valid: false, reason: `Unknown table: ${match[1] || match[2]}` };
      }
    }
  } catch {
    // If we can't validate tables, allow it through
  }

  return { valid: true };
}

export function extractEntityIds(rows: Record<string, unknown>[]): string[] {
  const ids: string[] = [];
  const idFields: Record<string, string> = {
    salesOrder: 'SO',
    deliveryDocument: 'DEL',
    billingDocument: 'BD',
    accountingDocument: 'JE',
    clearingAccountingDocument: 'PAY',
    customer: 'BP',
    businessPartner: 'BP',
    product: 'PRD',
    material: 'PRD',
    plant: 'PLT',
  };

  for (const row of rows) {
    for (const [field, prefix] of Object.entries(idFields)) {
      const value = row[field];
      if (value && typeof value === 'string' && value.trim()) {
        ids.push(`${prefix}:${value}`);
      }
    }
  }

  return [...new Set(ids)];
}
