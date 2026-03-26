import fs from 'fs';
import path from 'path';

export interface EntityData {
  [entityName: string]: Record<string, unknown>[];
}

function flattenValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    // Handle time objects like {hours: 6, minutes: 49, seconds: 13}
    const obj = value as Record<string, unknown>;
    if ('hours' in obj && 'minutes' in obj && 'seconds' in obj) {
      return `${String(obj.hours).padStart(2, '0')}:${String(obj.minutes).padStart(2, '0')}:${String(obj.seconds).padStart(2, '0')}`;
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

export function flattenRecord(record: Record<string, unknown>): Record<string, string | null> {
  const flat: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(record)) {
    flat[key] = flattenValue(value);
  }
  return flat;
}

export function loadAllData(dataDir: string): EntityData {
  const data: EntityData = {};
  const dirs = fs.readdirSync(dataDir, { withFileTypes: true });

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const entityName = dir.name;
    const entityDir = path.join(dataDir, entityName);
    const files = fs.readdirSync(entityDir).filter(f => f.endsWith('.jsonl'));
    const records: Record<string, unknown>[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(entityDir, file), 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          records.push(JSON.parse(trimmed));
        } catch {
          // skip malformed lines
        }
      }
    }
    data[entityName] = records;
  }

  return data;
}
