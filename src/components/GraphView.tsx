'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ENTITY_COLORS, type GraphData, type GraphNode, type GraphLink, type EntityType } from '@/types';
import NodeInspector from './NodeInspector';
import Legend from './Legend';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const RELATIONSHIP_LABELS: Record<string, string> = {
  HAS_ITEM: 'has item',
  FULFILLED_BY: 'fulfilled by',
  BELONGS_TO: 'belongs to',
  BILLED_IN: 'billed in',
  GENERATES: 'generates',
  CLEARED_BY: 'cleared by',
  SOLD_TO: 'sold to',
  CONTAINS_PRODUCT: 'product',
  FOR_PRODUCT: 'product',
  SHIPPED_FROM: 'from plant',
};

interface GraphViewProps {
  highlightedNodes: string[];
}

export default function GraphView({ highlightedNodes }: GraphViewProps) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
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

  const filteredData = useMemo(() => {
    if (!graphData) return { nodes: [], links: [] };

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

  // Build sets for quick lookup
  const highlightSet = useMemo(() => new Set(highlightedNodes), [highlightedNodes]);

  // Compute neighbor set for hovered node
  const hoveredNeighbors = useMemo(() => {
    if (!hoveredNode || !graphData) return new Set<string>();
    const neighbors = new Set<string>();
    neighbors.add(hoveredNode.id);
    for (const link of graphData.links) {
      const src = typeof link.source === 'string' ? link.source : (link.source as unknown as GraphNode).id;
      const tgt = typeof link.target === 'string' ? link.target : (link.target as unknown as GraphNode).id;
      if (src === hoveredNode.id) neighbors.add(tgt);
      if (tgt === hoveredNode.id) neighbors.add(src);
    }
    return neighbors;
  }, [hoveredNode, graphData]);

  const handleNodeClick = useCallback((node: unknown, event: MouseEvent) => {
    const n = node as GraphNode;
    setSelectedNode(n);
    setInspectorPos({ x: event.clientX, y: event.clientY });
  }, []);

  const handleNodeHover = useCallback((node: unknown | null) => {
    setHoveredNode(node ? node as GraphNode : null);
    const el = containerRef.current;
    if (el) el.style.cursor = node ? 'pointer' : 'default';
  }, []);

  const toggleType = useCallback((type: EntityType) => {
    setVisibleTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-gray-300 border-t-gray-800 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Loading graph data...</p>
          <p className="text-gray-400 text-xs mt-1">Building 1,200+ nodes...</p>
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

  const isHoverActive = hoveredNode !== null;

  return (
    <div ref={containerRef} className="relative w-full h-full bg-gray-50">
      {/* Header controls */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-2 bg-white/80 backdrop-blur border-b border-gray-100">
        <button
          onClick={() => {
            const fg = graphRef.current as { zoomToFit?: (ms: number) => void };
            fg?.zoomToFit?.(400);
          }}
          className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
        >
          Fit View
        </button>
        <button
          onClick={() => setShowGranular(!showGranular)}
          className={`text-xs px-3 py-1 rounded border transition-colors ${
            showGranular
              ? 'bg-gray-800 text-white border-gray-800'
              : 'border-gray-300 hover:bg-gray-100'
          }`}
        >
          {showGranular ? 'Hide' : 'Show'} Granular Overlay
        </button>
        {highlightedNodes.length > 0 && (
          <span className="text-xs text-red-500 font-medium">
            {highlightedNodes.length} nodes highlighted from query
          </span>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          {filteredData.nodes.length} nodes &middot; {filteredData.links.length} edges
        </span>
      </div>

      <Legend visibleTypes={visibleTypes} onToggleType={toggleType} />

      <ForceGraph2D
        ref={graphRef as React.MutableRefObject<undefined>}
        graphData={filteredData}
        nodeId="id"
        nodeLabel=""
        nodeVal={(node: unknown) => {
          const n = node as GraphNode;
          if (highlightSet.has(n.id)) return (n.val || 1) * 3;
          return n.val || 1;
        }}
        nodeCanvasObjectMode={() => 'replace'}
        nodeCanvasObject={(node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const n = node as GraphNode & { x: number; y: number };
          const baseSize = Math.sqrt(n.val || 1) * 3;
          const isHighlighted = highlightSet.has(n.id);
          const isSelected = selectedNode?.id === n.id;
          const isHovered = hoveredNode?.id === n.id;
          const isNeighbor = isHoverActive && hoveredNeighbors.has(n.id);
          const isDimmed = isHoverActive && !isNeighbor;

          const size = isHovered ? baseSize * 1.4 : isHighlighted ? baseSize * 1.2 : baseSize;
          const alpha = isDimmed ? 0.1 : 1;

          ctx.globalAlpha = alpha;

          // Outer glow for highlighted nodes
          if (isHighlighted && !isDimmed) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, size + 6, 0, 2 * Math.PI);
            const grad = ctx.createRadialGradient(n.x, n.y, size, n.x, n.y, size + 6);
            grad.addColorStop(0, 'rgba(239, 68, 68, 0.4)');
            grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
            ctx.fillStyle = grad;
            ctx.fill();
          }

          // Hover glow
          if (isHovered) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, size + 5, 0, 2 * Math.PI);
            const grad = ctx.createRadialGradient(n.x, n.y, size, n.x, n.y, size + 5);
            grad.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
            grad.addColorStop(1, 'rgba(59, 130, 246, 0)');
            ctx.fillStyle = grad;
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

          // Node circle with subtle border
          ctx.beginPath();
          ctx.arc(n.x, n.y, size, 0, 2 * Math.PI);
          ctx.fillStyle = isHighlighted ? '#EF4444' : (ENTITY_COLORS[n.type] || '#999');
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.15)';
          ctx.lineWidth = 0.5 / globalScale;
          ctx.stroke();

          // Label
          const showLabel = globalScale > 1.2 || isHighlighted || isSelected || isHovered || isNeighbor;
          if (showLabel && !isDimmed) {
            const fontSize = Math.max(3, (isHovered ? 12 : 10) / globalScale);
            ctx.font = `${isHovered || isSelected ? 'bold ' : ''}${fontSize}px Sans-Serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            // Text background for readability
            const text = n.label;
            const textWidth = ctx.measureText(text).width;
            const textY = n.y + size + 2;
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.fillRect(n.x - textWidth / 2 - 1, textY - 1, textWidth + 2, fontSize + 2);

            ctx.fillStyle = isHovered ? '#000' : '#333';
            ctx.fillText(text, n.x, textY);
          }

          ctx.globalAlpha = 1;
        }}
        linkCanvasObject={(link: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const l = link as GraphLink & {
            source: { x: number; y: number; id: string };
            target: { x: number; y: number; id: string };
          };
          if (!l.source?.x || !l.target?.x) return;

          const srcId = l.source.id;
          const tgtId = l.target.id;

          const isConnectedToHover = isHoverActive && (
            hoveredNeighbors.has(srcId) && hoveredNeighbors.has(tgtId) &&
            (hoveredNode?.id === srcId || hoveredNode?.id === tgtId)
          );
          const isDimmed = isHoverActive && !isConnectedToHover;

          ctx.globalAlpha = isDimmed ? 0.03 : (isConnectedToHover ? 0.8 : 0.15);

          // Draw line
          ctx.beginPath();
          ctx.moveTo(l.source.x, l.source.y);
          ctx.lineTo(l.target.x, l.target.y);
          ctx.strokeStyle = isConnectedToHover ? '#3B82F6' : '#9CA3AF';
          ctx.lineWidth = isConnectedToHover ? 1.5 / globalScale : 0.5 / globalScale;
          ctx.stroke();

          // Arrow
          const arrowLen = isConnectedToHover ? 5 : 3;
          const dx = l.target.x - l.source.x;
          const dy = l.target.y - l.source.y;
          const angle = Math.atan2(dy, dx);
          const endX = l.target.x - Math.cos(angle) * 5;
          const endY = l.target.y - Math.sin(angle) * 5;

          ctx.beginPath();
          ctx.moveTo(endX, endY);
          ctx.lineTo(
            endX - arrowLen * Math.cos(angle - Math.PI / 6),
            endY - arrowLen * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            endX - arrowLen * Math.cos(angle + Math.PI / 6),
            endY - arrowLen * Math.sin(angle + Math.PI / 6)
          );
          ctx.closePath();
          ctx.fillStyle = isConnectedToHover ? '#3B82F6' : '#9CA3AF';
          ctx.fill();

          // Edge label on hover
          if (isConnectedToHover && globalScale > 0.8) {
            const midX = (l.source.x + l.target.x) / 2;
            const midY = (l.source.y + l.target.y) / 2;
            const label = RELATIONSHIP_LABELS[l.relationship] || l.relationship;
            const fontSize = Math.max(3, 9 / globalScale);
            ctx.font = `${fontSize}px Sans-Serif`;
            const textWidth = ctx.measureText(label).width;

            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(midX - textWidth / 2 - 2, midY - fontSize / 2 - 1, textWidth + 4, fontSize + 2);

            ctx.fillStyle = '#3B82F6';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, midX, midY);
          }

          ctx.globalAlpha = 1;
        }}
        linkCanvasObjectMode={() => 'replace'}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onBackgroundClick={() => { setSelectedNode(null); setHoveredNode(null); }}
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
