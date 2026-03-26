import { NextResponse } from 'next/server';
import { getGraph } from '@/lib/graph';

export async function GET() {
  try {
    const graph = await getGraph();
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
