export interface ParsedVoiceCommand {
  type:
    | 'AI_ON'
    | 'AI_OFF'
    | 'MODE_STRATEGY'
    | 'MODE_AI'
    | 'MODE_STRATEGY_AI'
    | 'ANALYZE_NOW'
    | 'NAV_TERMINAL'
    | 'NAV_POSITIONS'
    | 'NAV_PNL'
    | 'NAV_LOGS'
    | 'NAV_DROPLET'
    | 'SYNC_POSITIONS'
    | 'SAVE_CONFIG'
    | 'OPEN_API_MODAL'
    | 'OPEN_PARAMS_MODAL'
    | 'OPEN_COPILOT'
    | 'SELECT_COIN'
    | 'OPEN_TRADE'
    | 'CLOSE_TRADE'
    | 'CLOSE_ALL'
    | 'MUTE_VOICE'
    | 'ASK_COPILOT';
  coin?: string;
  side?: 'LONG' | 'SHORT';
  notionalUsd?: number;
  rawText: string;
}

const SPOKEN_COIN_ALIASES: Record<string, string> = {
  BITCOIN: 'BTC',
  BTC: 'BTC',
  ETHEREUM: 'ETH',
  ETERIUM: 'ETH',
  ETH: 'ETH',
  SOLANA: 'SOL',
  SOL: 'SOL',
  HYPERLIQUID: 'HYPE',
  HYPE: 'HYPE',
  DOGECOIN: 'DOGE',
  DOGE: 'DOGE',
  RIPPLE: 'XRP',
  XRP: 'XRP',
  CARDANO: 'ADA',
  ADA: 'ADA',
  AVALANCHE: 'AVAX',
  AVAX: 'AVAX',
  ARBITRUM: 'ARB',
  ARB: 'ARB',
  CHAINLINK: 'LINK',
  LINK: 'LINK',
  PEPE: 'PEPE',
  SUI: 'SUI',
  WIF: 'WIF',
  BONK: 'BONK',
  APTOS: 'APT',
  APT: 'APT',
  INJECTIVE: 'INJ',
  INJ: 'INJ',
  NEAR: 'NEAR',
  OP: 'OP',
  OPTIMISM: 'OP',
  TIA: 'TIA',
  CELESTIA: 'TIA',
  BNB: 'BNB',
  TON: 'TON',
  LTC: 'LTC',
  LITECOIN: 'LTC',
};

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

class VoiceAssistantEngine {
  public voiceEnabled = true;
  private recognition: SpeechRecognitionLike | null = null;
  private shouldListen = false;
  private onCommandCb: ((cmd: ParsedVoiceCommand) => void) | null = null;
  private onStatusCb: ((status: { listening: boolean; transcript?: string; error?: string }) => void) | null = null;
  private knownCoins: string[] = [];

  public setKnownCoins(coins: string[]) {
    this.knownCoins = coins.map((c) => c.toUpperCase());
  }

  public isSpeechSynthesisSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  public isSpeechRecognitionSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  public speak(text: string, priority = false) {
    if (!this.voiceEnabled || !this.isSpeechSynthesisSupported() || !text.trim()) return;
    try {
      const synth = window.speechSynthesis;
      if (priority) {
        synth.cancel();
      }
      const clean = text
        .replace(/[*_`#]/g, '')
        .replace(/\$/g, ' dólares ')
        .replace(/%/g, ' por ciento ')
        .trim();

      const utter = new SpeechSynthesisUtterance(clean);
      utter.lang = 'es-MX';
      utter.rate = 1.06;
      utter.pitch = 0.94;

      const voices = synth.getVoices();
      const esVoice =
        voices.find((v) => v.lang.toLowerCase().startsWith('es-mx')) ||
        voices.find((v) => v.lang.toLowerCase().startsWith('es-us')) ||
        voices.find((v) => v.lang.toLowerCase().startsWith('es'));
      if (esVoice) utter.voice = esVoice;

      synth.speak(utter);
    } catch {
      // Ignore synthesis errors when browser blocks autoplay audio before first interaction
    }
  }

  public stopSpeaking() {
    if (this.isSpeechSynthesisSupported()) {
      window.speechSynthesis.cancel();
    }
  }

  private extractCoinFromText(upperText: string): string | undefined {
    for (const [alias, ticker] of Object.entries(SPOKEN_COIN_ALIASES)) {
      const regex = new RegExp(`\\b${alias}\\b`, 'i');
      if (regex.test(upperText)) return ticker;
    }
    const words = upperText.replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/);
    for (const w of words) {
      if (w.length >= 2 && this.knownCoins.includes(w)) {
        return w;
      }
    }
    return undefined;
  }

  private extractUsdAmount(text: string): number | undefined {
    const match = text.match(/(\d+(?:[.,]\d+)?)\s*(?:d[oó]lares|usd|usdt|usdc|bucks|pesos)?/i);
    if (!match) return undefined;
    const val = Number(match[1].replace(',', '.'));
    return Number.isFinite(val) && val >= 10 ? val : undefined;
  }

  public parseSpanishCommand(rawTranscript: string): ParsedVoiceCommand {
    const rawText = rawTranscript.trim();
    const lower = rawText
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const upper = rawText
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    // Mute voice
    if (/(silencia|callate|apaga la voz|desactiva la voz|sin voz)/.test(lower)) {
      return { type: 'MUTE_VOICE', rawText };
    }

    // AI Power ON / OFF
    if (/(enciende|activa|prende|inicia).*(ia|inteligencia|motor|bot)/.test(lower)) {
      return { type: 'AI_ON', rawText };
    }
    if (/(apaga|desactiva|deten|para|frena).*(ia|inteligencia|motor|bot)/.test(lower)) {
      return { type: 'AI_OFF', rawText };
    }

    // 3 Modes
    if (/modo.*(estrategia\s*(mas|\+|y)\s*ia|combinado|unificado)/.test(lower)) {
      return { type: 'MODE_STRATEGY_AI', rawText };
    }
    if (/modo.*estrategia/.test(lower)) {
      return { type: 'MODE_STRATEGY', rawText };
    }
    if (/modo.*(ia|inteligencia)/.test(lower)) {
      return { type: 'MODE_AI', rawText };
    }

    // Close all / Close specific position
    if (/(cierra|cerrar).*(todas|todo|posiciones)/.test(lower)) {
      return { type: 'CLOSE_ALL', rawText };
    }
    if (/(cierra|cerrar|salir de)/.test(lower)) {
      const coin = this.extractCoinFromText(upper);
      if (coin) return { type: 'CLOSE_TRADE', coin, rawText };
    }

    // Open Long / Short position
    if (/(abre|abrir|entra|compra|mete|pon).*(long|largo|compra)/.test(lower) || /^(compra|long)\s+/.test(lower)) {
      const coin = this.extractCoinFromText(upper);
      const notionalUsd = this.extractUsdAmount(lower);
      if (coin) return { type: 'OPEN_TRADE', coin, side: 'LONG', notionalUsd, rawText };
    }
    if (/(abre|abrir|entra|vende|mete|pon).*(short|corto|venta)/.test(lower) || /^(vende|short)\s+/.test(lower)) {
      const coin = this.extractCoinFromText(upper);
      const notionalUsd = this.extractUsdAmount(lower);
      if (coin) return { type: 'OPEN_TRADE', coin, side: 'SHORT', notionalUsd, rawText };
    }

    // Scan / Analyze
    if (/(analiza|escanea|busca|revisa).*(mercado|oportunidad|senales|ahora)/.test(lower)) {
      return { type: 'ANALYZE_NOW', rawText };
    }

    // Sync positions
    if (/(actualiza|sincroniza|refresca).*(posicion|posiciones|cuenta|hyperliquid)/.test(lower)) {
      return { type: 'SYNC_POSITIONS', rawText };
    }

    // Save config
    if (/(guarda|salva|almacena).*(config|configuracion|ajustes)/.test(lower)) {
      return { type: 'SAVE_CONFIG', rawText };
    }

    // Navigation
    if (/(abre|ve a|ir a|muestra|ver).*(posicion|posiciones)/.test(lower)) {
      return { type: 'NAV_POSITIONS', rawText };
    }
    if (/(abre|ve a|ir a|muestra|ver).*(pnl|ganancia|rendimiento)/.test(lower)) {
      return { type: 'NAV_PNL', rawText };
    }
    if (/(abre|ve a|ir a|muestra|ver).*(logs|registros|memoria)/.test(lower)) {
      return { type: 'NAV_LOGS', rawText };
    }
    if (/(abre|ve a|ir a|muestra|ver).*(droplet|servidor|24)/.test(lower)) {
      return { type: 'NAV_DROPLET', rawText };
    }
    if (/(abre|ve a|ir a|muestra|ver).*(terminal|grafica|inicio|principal)/.test(lower)) {
      return { type: 'NAV_TERMINAL', rawText };
    }
    if (/(abre|configura|conecta).*(api|wallet|billetera)/.test(lower)) {
      return { type: 'OPEN_API_MODAL', rawText };
    }
    if (/(abre|configura).*(parametros|cerebro|modelo)/.test(lower)) {
      return { type: 'OPEN_PARAMS_MODAL', rawText };
    }
    if (/(abre|muestra).*(copiloto|chat)/.test(lower)) {
      return { type: 'OPEN_COPILOT', rawText };
    }

    // Select coin chart
    if (/(muestra|ver|pon|selecciona|grafica de)/.test(lower)) {
      const coin = this.extractCoinFromText(upper);
      if (coin) return { type: 'SELECT_COIN', coin, rawText };
    }

    // Default: treat as spoken question/instruction for AI Copilot
    return { type: 'ASK_COPILOT', rawText };
  }

  public startListening(
    onCommand: (cmd: ParsedVoiceCommand) => void,
    onStatus: (status: { listening: boolean; transcript?: string; error?: string }) => void
  ) {
    if (!this.isSpeechRecognitionSupported()) {
      onStatus({
        listening: false,
        error: 'Tu navegador no soporta reconocimiento de voz continuo (usa Chrome / Edge / Android Chrome).',
      });
      return;
    }

    this.onCommandCb = onCommand;
    this.onStatusCb = onStatus;
    this.shouldListen = true;

    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const RecClass = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!RecClass) return;

    const rec = new RecClass();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'es-MX';

    rec.onresult = (event: SpeechRecognitionEventLike) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          const transcript = res[0]?.transcript?.trim();
          if (transcript) {
            this.onStatusCb?.({ listening: true, transcript });
            const parsed = this.parseSpanishCommand(transcript);
            this.onCommandCb?.(parsed);
          }
        }
      }
    };

    rec.onerror = (e: { error: string }) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.shouldListen = false;
        this.onStatusCb?.({
          listening: false,
          error: 'Permiso de micrófono denegado para comandos de voz.',
        });
      }
    };

    rec.onend = () => {
      if (this.shouldListen) {
        try {
          rec.start();
        } catch {
          // ignore rapid restart error
        }
      } else {
        this.onStatusCb?.({ listening: false });
      }
    };

    this.recognition = rec;
    try {
      rec.start();
      this.onStatusCb?.({ listening: true });
    } catch (err) {
      this.shouldListen = false;
      this.onStatusCb?.({
        listening: false,
        error: err instanceof Error ? err.message : 'No se pudo iniciar el micrófono.',
      });
    }
  }

  public stopListening() {
    this.shouldListen = false;
    try {
      this.recognition?.stop();
    } catch {
      // ignore
    }
    this.recognition = null;
    this.onStatusCb?.({ listening: false });
  }
}

export const voiceEngine = new VoiceAssistantEngine();
