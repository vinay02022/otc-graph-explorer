import { NextResponse } from 'next/server';
import { getGraph } from '@/lib/graph';

export async function GET() {
  try {
    const graph = getGraph();
    return NextResponse.json(graph);
  } catch (error) {
    console.error('Graph error:', error);
    return NextResponse.json(
      { error: 'Failed to build graph: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
