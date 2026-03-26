'use client';

import { useState } from 'react';
import type { ChatMessage as ChatMessageType } from '@/types';

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const [showSql, setShowSql] = useState(false);
  const [showData, setShowData] = useState(false);
  const isUser = message.role === 'user';

  // Parse markdown-like formatting from the LLM response
  function formatContent(content: string): string {
    // Remove SQL code blocks from display (we show them separately)
    let formatted = content.replace(/```sql\n?[\s\S]*?```/g, '').trim();
    // Remove any remaining code blocks
    formatted = formatted.replace(/```\w*\n?[\s\S]*?```/g, '');
    // Convert **bold** to <strong>
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Convert `inline code` to <code>
    formatted = formatted.replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono text-gray-700">$1</code>');
    // Convert markdown lists (- item) to proper list items
    formatted = formatted.replace(/\n- /g, '\n&bull; ');
    // Convert numbered lists
    formatted = formatted.replace(/\n(\d+)\. /g, '\n$1. ');
    // Convert newlines to <br>
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[85%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-gray-800 text-white'
            : 'bg-white border border-gray-200 text-gray-800'
        }`}
      >
        {!isUser && (
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-gray-800 flex items-center justify-center">
              <span className="text-white text-xs font-bold">D</span>
            </div>
            <div>
              <div className="text-sm font-semibold">Dodge AI</div>
              <div className="text-xs text-gray-400">Graph Agent</div>
            </div>
          </div>
        )}

        <div
          className="text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: formatContent(message.content) }}
        />

        {message.sql && (
          <div className="mt-2">
            <button
              onClick={() => setShowSql(!showSql)}
              className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
            >
              {showSql ? 'Hide' : 'Show'} SQL Query
              <span className="text-[10px]">{showSql ? '\u25B2' : '\u25BC'}</span>
            </button>
            {showSql && (
              <pre className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-xs overflow-x-auto text-gray-700">
                <code>{message.sql}</code>
              </pre>
            )}
          </div>
        )}

        {message.data && message.data.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setShowData(!showData)}
              className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
            >
              {showData ? 'Hide' : 'Show'} Results ({message.data.length} rows)
              <span className="text-[10px]">{showData ? '\u25B2' : '\u25BC'}</span>
            </button>
            {showData && (
              <div className="mt-1 overflow-x-auto max-h-[300px] overflow-y-auto">
                <table className="text-xs border-collapse w-full">
                  <thead>
                    <tr>
                      {Object.keys(message.data[0]).map(col => (
                        <th key={col} className="border border-gray-200 px-2 py-1 bg-gray-50 text-left font-semibold text-gray-600 whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {message.data.slice(0, 20).map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((val, j) => (
                          <td key={j} className="border border-gray-200 px-2 py-1 whitespace-nowrap">
                            {val === null ? <span className="text-gray-300">null</span> : String(val)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {message.data.length > 20 && (
                  <div className="text-xs text-gray-400 mt-1">
                    Showing 20 of {message.data.length} rows
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
