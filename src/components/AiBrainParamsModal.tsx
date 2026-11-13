import React, { useState } from 'react';
import { BrainCircuit, Sliders, X } from 'lucide-react';
import type { BotConfigData } from '../types/trading';
import { soundEngine } from '../utils/soundEngine';

interface AiBrainParamsModalProps {
  open: boolean;
  onClose: () => void;
  config: BotConfigData;
  onSave: (patch: Partial<BotConfigData>) => void;
}

export const AiBrainParamsModal: React.FC<AiBrainParamsModalProps> = ({
  open,
  onClose,
  config,
  onSave,
}) => {
  const [aiProvider, setAiProvider] = useState<'gemini' | 'custom_ai'>(config.aiProvider);
  const [customAiUrl, setCustomAiUrl] = useState(config.customAiUrl);
  const [customAiModel, setCustomAiModel] = useState(config.customAiModel);
  const [customSystemPrompt, setCustomSystemPrompt] = useState(config.customSystemPrompt);
  const [scanIntervalSec, setScanIntervalSec] = useState(String(config.scanIntervalSec));
  const [minConfidence, setMinConfidence] = useState(String(config.minConfidence));
  const [minQuantScore, setMinQuantScore] = useState(String(config.minQuantScore));
  const [minVolumeM, setMinVolumeM] = useState(String(config.minVolumeM));
  const [tpPct, setTpPct] = useState(String(config.tpPct));
  const [slPct, setSlPct] = useState(String(config.slPct));
  const [useDeepThinking, setUseDeepThinking] = useState(config.useDeepThinking);
  const [useSearchGrounding, setUseSearchGrounding] = useState(config.useSearchGrounding);

  if (!open) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    soundEngine.tradeExecuted();
    onSave({
      aiProvider,
      customAiUrl: customAiUrl.trim(),
      customAiModel: customAiModel.trim(),
      customSystemPrompt: customSystemPrompt.trim(),
      scanIntervalSec: Math.max(30, Math.min(3600, Number(scanIntervalSec || 180))),
      minConfidence: Math.max(40, Math.min(99, Number(minConfidence || 68))),
      minQuantScore: Math.max(20, Math.min(95, Number(minQuantScore || 58))),
      minVolumeM: Math.max(0.1, Math.min(500, Number(minVolumeM || 2))),
      tpPct: Math.max(0.2, Math.min(100, Number(tpPct || 3.0))),
      slPct: Math.max(0.2, Math.min(50, Number(slPct || 1.4))),
      useDeepThinking,
      useSearchGrounding,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-[#0F131A] border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Parámetros del Cerebro IA y Motor Externo
              </h2>
              <p className="text-xs text-slate-400">
                Configura umbrales cuantitativos, cadencia anti-429 o conecta tu propia IA (Ollama / DeepSeek / OpenAI-Compatible)
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

        <form onSubmit={handleSave} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* AI Engine Provider */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-200">
              Motor Neuronal Activo
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  soundEngine.click();
                  setAiProvider('gemini');
                }}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  aiProvider === 'gemini'
                    ? 'bg-amber-500/15 border-amber-500 text-slate-100'
                    : 'bg-[#090B0E] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="text-xs font-bold">Gemini Integrado (Servidor)</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Usa Flash-Lite (baja cuota) o Hydrogen + fallback cuantitativo automático si hay 429.
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.click();
                  setAiProvider('custom_ai');
                }}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  aiProvider === 'custom_ai'
                    ? 'bg-amber-500/15 border-amber-500 text-slate-100'
                    : 'bg-[#090B0E] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="text-xs font-bold">Mi IA Externa (BYO-AI)</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Endpoint OpenAI-compatible (Ollama en tu Droplet, DeepSeek, OpenRouter o vLLM).
                </div>
              </button>
            </div>
          </div>

          {aiProvider === 'custom_ai' ? (
            <div className="p-4 rounded-lg bg-[#090B0E] border border-slate-800 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <BrainCircuit className="w-4 h-4" />
                Conexión de tu Propio Modelo IA
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Endpoint Base URL (OpenAI v1)
                  </label>
                  <input
                    type="text"
                    placeholder="http://127.0.0.1:11434/v1 o https://api.deepseek.com/v1"
                    value={customAiUrl}
                    onChange={(e) => setCustomAiUrl(e.target.value)}
                    className="w-full bg-[#0F131A] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Nombre del Modelo
                  </label>
                  <input
                    type="text"
                    placeholder="qwen2.5:14b / deepseek-chat / llama3.3"
                    value={customAiModel}
                    onChange={(e) => setCustomAiModel(e.target.value)}
                    className="w-full bg-[#0F131A] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Si tu endpoint externo requiere Bearer token, configúralo de forma segura en la variable de servidor <code className="text-slate-300">CUSTOM_AI_API_KEY</code> (en Secrets o en el <code className="text-slate-300">.env</code> de tu Droplet).
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-lg bg-[#090B0E] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    Deep Thinking (`gemini-4-hydrogen`)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Desactívalo en auto-escaneo para conservar cuota gratuita y evitar errores 429.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.click();
                    setUseDeepThinking(!useDeepThinking);
                  }}
                  className={`px-3 py-1.5 rounded text-xs font-bold ${
                    useDeepThinking ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {useDeepThinking ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    Google Search Grounding Automático
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Busca catalizadores macro en vivo antes de analizar (consume más cuota).
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.click();
                    setUseSearchGrounding(!useSearchGrounding);
                  }}
                  className={`px-3 py-1.5 rounded text-xs font-bold ${
                    useSearchGrounding ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {useSearchGrounding ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          )}

          {/* Quantitative & Execution Parameters */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Cadencia Auto (seg)</label>
              <input
                type="number"
                min={30}
                max={3600}
                value={scanIntervalSec}
                onChange={(e) => setScanIntervalSec(e.target.value)}
                className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-1.5 text-xs font-mono-tabular text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Confianza Mín. IA (%)</label>
              <input
                type="number"
                min={40}
                max={99}
                value={minConfidence}
                onChange={(e) => setMinConfidence(e.target.value)}
                className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-1.5 text-xs font-mono-tabular text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Score Estrategia Mín.</label>
              <input
                type="number"
                min={20}
                max={95}
                value={minQuantScore}
                onChange={(e) => setMinQuantScore(e.target.value)}
                className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-1.5 text-xs font-mono-tabular text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Volumen 24h Mín ($M)</label>
              <input
                type="number"
                step="0.5"
                min={0.1}
                value={minVolumeM}
                onChange={(e) => setMinVolumeM(e.target.value)}
                className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-1.5 text-xs font-mono-tabular text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Take Profit Objetivo (%)</label>
              <input
                type="number"
                step="0.2"
                min={0.2}
                value={tpPct}
                onChange={(e) => setTpPct(e.target.value)}
                className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-1.5 text-xs font-mono-tabular text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Stop Loss Objetivo (%)</label>
              <input
                type="number"
                step="0.2"
                min={0.2}
                value={slPct}
                onChange={(e) => setSlPct(e.target.value)}
                className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-1.5 text-xs font-mono-tabular text-slate-100"
              />
            </div>
          </div>

          {/* Custom System Prompt */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Instrucción Maestra / Reglas Propias de tu Estrategia IA (Opcional)
            </label>
            <textarea
              rows={3}
              maxLength={1400}
              placeholder="Ej: Prioriza rupturas con Funding negativo en SOL y HYPE, evita operar 15 minutos antes de apertura NY..."
              value={customSystemPrompt}
              onChange={(e) => setCustomSystemPrompt(e.target.value)}
              className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                soundEngine.click();
                onClose();
              }}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold"
            >
              Guardar Parámetros IA
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
