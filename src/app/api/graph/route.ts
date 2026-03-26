import { NextResponse } from 'next/server';
import { getGraph } from '@/lib/graph';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    // Debug: log available paths
    const cwd = process.cwd();
    const dataDirCwd = path.join(cwd, 'data');
    const dataDirExists = fs.existsSync(dataDirCwd);
    const tmpDbExists = fs.existsSync('/tmp/otc.db');

    let dataContents: string[] = [];
    if (dataDirExists) {
      dataContents = fs.readdirSync(dataDirCwd).slice(0, 5);
    }

    console.log('[Graph API] cwd:', cwd, 'data dir exists:', dataDirExists, 'contents:', dataContents, 'tmp db:', tmpDbExists);

    const graph = getGraph();
    return NextResponse.json(graph);
  } catch (error) {
    const err = error as Error;
    console.error('Graph error:', err.message, err.stack);
    return NextResponse.json(
      { error: 'Failed to build graph: ' + err.message },
      { status: 500 }
    );
  }
}
