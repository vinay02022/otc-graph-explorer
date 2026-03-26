'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ChatMessage from './ChatMessage';
import type { ChatMessage as ChatMessageType } from '@/types';

interface ChatPanelProps {
  onHighlightNodes: (nodeIds: string[]) => void;
}

export default function ChatPanel({ onHighlightNodes }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hi! I can help you analyze the **Order to Cash** process.\n\nAsk me anything about sales orders, deliveries, billing documents, payments, products, or customers.',
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingStatus]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessageType = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setStreamingStatus('Connecting...');

    const assistantId = `assistant-${Date.now()}`;

    try {
      const history = messages
        .filter(m => m.id !== 'welcome')
        .map(m => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      });

      if (!res.ok || !res.body) {
        // Fallback to non-streaming
        const fallbackRes = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history }),
        });
        const data = await fallbackRes.json();
        setMessages(prev => [...prev, {
          id: assistantId, role: 'assistant', content: data.answer || data.error,
          sql: data.sql, data: data.data, highlightedNodes: data.highlightedNodes,
          timestamp: Date.now(),
        }]);
        if (data.highlightedNodes?.length > 0) onHighlightNodes(data.highlightedNodes);
        setLoading(false);
        setStreamingStatus('');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamedContent = '';
      let sql = '';
      let data: Record<string, unknown>[] = [];
      let highlightedNodes: string[] = [];
      let buffer = '';

      // Add placeholder message
      setMessages(prev => [...prev, {
        id: assistantId, role: 'assistant', content: '', timestamp: Date.now(),
      }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'status':
                setStreamingStatus(event.content);
                break;
              case 'sql':
                sql = event.content;
                break;
              case 'data':
                data = JSON.parse(event.content);
                break;
              case 'highlightedNodes':
                highlightedNodes = JSON.parse(event.content);
                onHighlightNodes(highlightedNodes);
                break;
              case 'chunk':
                streamedContent += event.content;
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, content: streamedContent } : m
                ));
                break;
              case 'answer':
                streamedContent = event.content;
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, content: streamedContent } : m
                ));
                break;
              case 'error':
                streamedContent = `Error: ${event.content}`;
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, content: streamedContent } : m
                ));
                break;
              case 'done':
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, content: streamedContent, sql, data, highlightedNodes } : m
                ));
                break;
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } catch {
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`, role: 'assistant',
        content: 'Network error. Please check your connection and try again.',
        timestamp: Date.now(),
      }]);
    } finally {
      setLoading(false);
      setStreamingStatus('');
    }
  }, [input, loading, messages, onHighlightNodes]);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="font-semibold text-gray-800">Chat with Graph</h2>
        <p className="text-xs text-gray-400">Order to Cash</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map(msg => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {loading && (
          <div className="flex justify-start mb-4">
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-gray-800 flex items-center justify-center">
                  <span className="text-white text-xs font-bold">D</span>
                </div>
                <div className="text-sm font-semibold">Dodge AI</div>
              </div>
              {streamingStatus ? (
                <div className="text-xs text-gray-500 flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                  {streamingStatus}
                </div>
              ) : (
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-200">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              {loading ? (streamingStatus || 'Dodge AI is thinking...') : 'Dodge AI is awaiting instructions'}
            </span>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Analyze anything"
              disabled={loading}
              className="w-full border border-gray-300 rounded-lg px-3 pt-6 pb-2 text-sm focus:outline-none focus:border-gray-500 disabled:bg-gray-50"
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
