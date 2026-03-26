import { NextRequest, NextResponse } from 'next/server';
import { getGraph, getNodeWithNeighbors } from '@/lib/graph';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const nodeId = decodeURIComponent(id);
    const graph = await getGraph();

    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) {
      return NextResponse.json({ error: 'Node not found' }, { status: 404 });
    }

    const subgraph = getNodeWithNeighbors(nodeId, graph);
    return NextResponse.json({ node, neighbors: subgraph });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get node: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
