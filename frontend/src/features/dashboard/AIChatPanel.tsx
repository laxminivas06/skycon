import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, Loader2, Trash2, AlertTriangle } from 'lucide-react';

// ponytail: plain fetch to backend /api/ai/chat — no SDK, no store, no abstraction
const API_BASE = import.meta.env.VITE_RELAY_URL?.replace(/\/+$/, '') || '';

interface Msg { role: 'user' | 'assistant'; content: string; }

export const AIChatPanel: React.FC = () => {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: 'SKYCON AI online. Ask me about mission status, telemetry, flight-controller errors, or QR detections.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setError(null);
    const userMsg: Msg = { role: 'user', content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // only send last 10 messages to keep context short
        body: JSON.stringify({ messages: history.slice(-10).map(m => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMessages(prev => [...prev, { role: 'assistant', content: data.content || '(empty response)' }]);
    } catch (e: any) {
      setError(e.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0D1117] text-white font-mono text-[12px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-[#161B22] shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          <span className="font-orbitron text-[13px] font-bold tracking-wide text-emerald-400">SKYCON AI</span>
          <span className="text-[10px] text-slate-500 font-sans">Claude claude-sonnet-4-5</span>
        </div>
        <button
          type="button"
          title="Clear chat"
          onClick={() => setMessages([{ role: 'assistant', content: 'Chat cleared. How can I help?' }])}
          className="text-slate-500 hover:text-rose-400 p-1 rounded cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-700">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-xl leading-relaxed whitespace-pre-wrap break-words ${
              m.role === 'user'
                ? 'bg-emerald-900/50 border border-emerald-700/60 text-emerald-100'
                : 'bg-[#1C212B] border border-slate-700/60 text-slate-200'
            }`}>
              {m.role === 'assistant' && (
                <span className="text-[9px] text-emerald-500 font-bold uppercase block mb-1 tracking-widest">AI ▸</span>
              )}
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#1C212B] border border-slate-700/60 px-3 py-2 rounded-xl flex items-center gap-2 text-slate-400">
              <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
              <span>Thinking…</span>
            </div>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-rose-950/60 border border-rose-700/60 rounded-xl text-rose-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-slate-800 p-3 bg-[#161B22]">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask about mission, telemetry, errors…"
            disabled={loading}
            className="flex-1 bg-[#0D1117] border border-slate-700 rounded-lg px-3 py-2 text-[12px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-600 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={send}
            disabled={loading || !input.trim()}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white px-3 py-2 rounded-lg cursor-pointer transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[9px] text-slate-600 mt-1.5 text-center">
          Telemetry + mission context auto-injected · Enter to send
        </p>
      </div>
    </div>
  );
};

