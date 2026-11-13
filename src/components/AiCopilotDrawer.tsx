import React, { useEffect, useRef, useState } from 'react';
import { Brain, Globe, Send, X } from 'lucide-react';
import type { ChatMessageEntry } from '../types/trading';
import { soundEngine } from '../utils/soundEngine';

interface AiCopilotDrawerProps {
  open: boolean;
  onClose: () => void;
  messages: ChatMessageEntry[];
  sending: boolean;
  onSendMessage: (message: string, useSearch: boolean) => void;
}

export const AiCopilotDrawer: React.FC<AiCopilotDrawerProps> = ({
  open,
  onClose,
  messages,
  sending,
  onSendMessage,
}) => {
  const [input, setInput] = useState('');
  const [useSearch, setUseSearch] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    soundEngine.click();
    setInput('');
    onSendMessage(trimmed, useSearch);
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#0F131A] border-l border-slate-800 shadow-2xl flex flex-col">
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Brain className="w-5 h-5 text-amber-400" />
          <div>
            <h3 className="text-sm font-bold text-slate-100">Copiloto TUG777 AI Core</h3>
            <p className="text-[11px] text-slate-400">
              Razonamiento profundo · Contexto en vivo Hyperliquid + Firestore
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            soundEngine.click();
            onClose();
          }}
          className="p-1.5 text-slate-400 hover:text-white rounded-md"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable Thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-10 px-4 space-y-3">
            <p className="text-sm text-slate-300 font-medium">
              Consulta al Cerebro Unificado en tiempo real
            </p>
            <p className="text-xs text-slate-500">
              Pregunta sobre setups en Hyperliquid, catalizadores macro en vivo, riesgo de tus posiciones abiertas o lecciones guardadas en la base de datos.
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {[
                '¿Qué token tiene mejor confluencia ahora?',
                'Analiza noticias macro hoy para BTC y SOL',
                'Revisa mis lecciones de trades recientes',
              ].map((preset) => (
                <button
                  key={preset}
                  onClick={() => {
                    soundEngine.click();
                    onSendMessage(preset, useSearch);
                  }}
                  className="px-3 py-1.5 rounded-md bg-[#090B0E] border border-slate-800 hover:border-amber-500/40 text-xs text-slate-300"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg p-3 text-xs leading-relaxed ${
                m.role === 'user'
                  ? 'bg-amber-500/15 border border-amber-500/30 text-slate-100 ml-8'
                  : 'bg-[#090B0E] border border-slate-800 text-slate-200 mr-6'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1 font-mono-tabular">
                <span>{m.role === 'user' ? 'TUG777' : m.modelUsed}</span>
                <span>{new Date(m.createdAtMs).toLocaleTimeString()}</span>
              </div>
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          ))
        )}
        {sending && (
          <div className="bg-[#090B0E] border border-slate-800 rounded-lg p-3 mr-6 text-xs text-amber-300 font-mono-tabular">
            Analizando flujo de mercado y grounding en vivo...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-slate-800 space-y-2.5 bg-[#0C1016]">
        <div className="flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => {
              soundEngine.click();
              setUseSearch(!useSearch);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] transition-colors ${
              useSearch
                ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                : 'bg-[#090B0E] border-slate-800 text-slate-400'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            Google Search Grounding: {useSearch ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu consulta táctica..."
            className="flex-1 bg-[#090B0E] border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="p-2 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
};
