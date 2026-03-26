'use client';

import { useState } from 'react';
import GraphView from '@/components/GraphView';
import ChatPanel from '@/components/ChatPanel';

export default function Home() {
  const [highlightedNodes, setHighlightedNodes] = useState<string[]>([]);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 h-10 bg-white border-b border-gray-200 flex items-center px-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-gray-800 rounded flex items-center justify-center">
            <span className="text-white text-xs font-bold">D</span>
          </div>
          <span className="text-sm text-gray-500">Mapping /</span>
          <span className="text-sm font-semibold text-gray-800">Order to Cash</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex w-full h-full pt-10">
        {/* Graph Panel */}
        <div className="flex-1 h-full relative">
          <GraphView highlightedNodes={highlightedNodes} />
        </div>

        {/* Chat Panel */}
        <div className="w-[380px] h-full border-l border-gray-200 shrink-0">
          <ChatPanel onHighlightNodes={setHighlightedNodes} />
        </div>
      </div>
    </div>
  );
}
