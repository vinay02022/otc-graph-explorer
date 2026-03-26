'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { ENTITY_COLORS, type GraphData, type GraphNode, type EntityType } from '@/types';
import NodeInspector from './NodeInspector';
import Legend from './Legend';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

interface GraphViewProps {
  highlightedNodes: string[];
}

export default function GraphView({ highlightedNodes }: GraphViewProps) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [inspectorPos, setInspectorPos] = useState({ x: 0, y: 0 });
  const [visibleTypes, setVisibleTypes] = useState<Set<EntityType>>(
    new Set(Object.keys(ENTITY_COLORS) as EntityType[])
  );
  const [showGranular, setShowGranular] = useState(true);
  const graphRef = useRef<unknown>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/graph')
      .then(res => res.json())
      .then(data => {
        setGraphData(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const filteredData = useCallback(() => {
    if (!graphData) return { nodes: [], links: [] };

    // Granular types are item-level entities
    const granularTypes: EntityType[] = ['SalesOrderItem', 'DeliveryItem', 'BillingDocumentItem'];

    const filteredNodes = graphData.nodes.filter(n => {
      if (!visibleTypes.has(n.type)) return false;
      if (!showGranular && granularTypes.includes(n.type)) return false;
      return true;
    });

    const nodeIds = new Set(filteredNodes.map(n => n.id));
    const filteredLinks = graphData.links.filter(l => {
      const src = typeof l.source === 'string' ? l.source : (l.source as unknown as GraphNode).id;
      const tgt = typeof l.target === 'string' ? l.target : (l.target as unknown as GraphNode).id;
      return nodeIds.has(src) && nodeIds.has(tgt);
    });

    return { nodes: filteredNodes, links: filteredLinks };
  }, [graphData, visibleTypes, showGranular]);

  const highlightSet = new Set(highlightedNodes);

  const handleNodeClick = useCallback((node: unknown, event: MouseEvent) => {
    const n = node as GraphNode;
    setSelectedNode(n);
    setInspectorPos({ x: event.clientX, y: event.clientY });
  }, []);

  const toggleType = useCallback((type: EntityType) => {
    setVisibleTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-gray-300 border-t-gray-800 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Loading graph data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <p className="text-red-500">Error: {error}</p>
      </div>
    );
  }

  const data = filteredData();

  return (
    <div ref={containerRef} className="relative w-full h-full bg-gray-50">
      {/* Header controls */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-2 bg-white/80 backdrop-blur border-b border-gray-100">
        <button
          onClick={() => {
            const fg = graphRef.current as { zoomToFit?: (ms: number) => void };
            fg?.zoomToFit?.(400);
          }}
          className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-100"
        >
          Minimize
        </button>
        <button
          onClick={() => setShowGranular(!showGranular)}
          className={`text-xs px-3 py-1 rounded border ${
            showGranular
              ? 'bg-gray-800 text-white border-gray-800'
              : 'border-gray-300 hover:bg-gray-100'
          }`}
        >
          {showGranular ? 'Hide' : 'Show'} Granular Overlay
        </button>
        <span className="text-xs text-gray-400 ml-auto">
          {data.nodes.length} nodes | {data.links.length} edges
        </span>
      </div>

      <Legend visibleTypes={visibleTypes} onToggleType={toggleType} />

      <ForceGraph2D
        ref={graphRef as React.MutableRefObject<undefined>}
        graphData={data}
        nodeId="id"
        nodeLabel={(node: unknown) => {
          const n = node as GraphNode;
          return `${n.type}: ${n.label}`;
        }}
        nodeColor={(node: unknown) => {
          const n = node as GraphNode;
          if (highlightSet.has(n.id)) return '#FF0000';
          return ENTITY_COLORS[n.type] || '#999';
        }}
        nodeVal={(node: unknown) => {
          const n = node as GraphNode;
          if (highlightSet.has(n.id)) return (n.val || 1) * 3;
          return n.val || 1;
        }}
        nodeCanvasObject={(node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const n = node as GraphNode & { x: number; y: number };
          const size = Math.sqrt(n.val || 1) * 3;
          const isHighlighted = highlightSet.has(n.id);
          const isSelected = selectedNode?.id === n.id;

          // Glow effect for highlighted nodes
          if (isHighlighted) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, size + 4, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
            ctx.fill();
          }

          // Selection ring
          if (isSelected) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, size + 3, 0, 2 * Math.PI);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2 / globalScale;
            ctx.stroke();
          }

          // Node circle
          ctx.beginPath();
          ctx.arc(n.x, n.y, size, 0, 2 * Math.PI);
          ctx.fillStyle = isHighlighted ? '#EF4444' : (ENTITY_COLORS[n.type] || '#999');
          ctx.fill();

          // Label (only show when zoomed in enough)
          if (globalScale > 1.5 || isHighlighted || isSelected) {
            ctx.font = `${Math.max(3, 10 / globalScale)}px Sans-Serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#333';
            ctx.fillText(n.label, n.x, n.y + size + 2);
          }
        }}
        linkColor={() => 'rgba(156, 163, 175, 0.3)'}
        linkWidth={0.5}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={1}
        onNodeClick={handleNodeClick}
        onBackgroundClick={() => setSelectedNode(null)}
        cooldownTicks={100}
        warmupTicks={50}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />

      {selectedNode && (
        <NodeInspector
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          position={inspectorPos}
        />
      )}
    </div>
  );
}
