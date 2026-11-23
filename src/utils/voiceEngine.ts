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

interface AndroidTTSBridge {
  speak: (text: string, priority: boolean) => void;
  stop: () => void;
  isAvailable?: () => boolean;
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

  private cachedVoice: SpeechSynthesisVoice | null = null;
  private webSpeechPrimed = false;
  private gestureHooksInstalled = false;
  private speechQueue: string[] = [];
  private isWebSpeaking = false;
  private speakTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSpokenText = '';
  private lastSpokenAt = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      this.installGestureUnlockers();
      this.initVoicesListener();
    }
  }

  private getAndroidBridge(): AndroidTTSBridge | null {
    if (typeof window === 'undefined') return null;
    const bridge = (window as unknown as { AndroidTTS?: AndroidTTSBridge }).AndroidTTS;
    if (bridge && typeof bridge.speak === 'function') {
      return bridge;
    }
    return null;
  }

  public hasNativeBridge(): boolean {
    return this.getAndroidBridge() !== null;
  }

  public setKnownCoins(coins: string[]) {
    this.knownCoins = coins.map((c) => c.toUpperCase());
  }

  public isSpeechSynthesisSupported(): boolean {
    if (this.hasNativeBridge()) return true;
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  public getEngineDiagnostic(): 'native_android_tts' | 'web_speech' | 'unsupported' {
    if (this.hasNativeBridge()) return 'native_android_tts';
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) return 'web_speech';
    return 'unsupported';
  }

  public isSpeechRecognitionSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  private initVoicesListener() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const synth = window.speechSynthesis;
      const pickBestSpanishVoice = () => {
        const voices = synth.getVoices();
        if (!voices || voices.length === 0) return;
        this.cachedVoice =
          voices.find((v) => v.lang.toLowerCase().startsWith('es-mx')) ||
          voices.find((v) => v.lang.toLowerCase().startsWith('es-us')) ||
          voices.find((v) => v.lang.toLowerCase().startsWith('es-es')) ||
          voices.find((v) => v.lang.toLowerCase().startsWith('es')) ||
          null;
      };
      pickBestSpanishVoice();
      if (typeof synth.addEventListener === 'function') {
        synth.addEventListener('voiceschanged', pickBestSpanishVoice);
      } else {
        synth.onvoiceschanged = pickBestSpanishVoice;
      }
    } catch {
      // Ignore browser voices initialization failure
    }
  }

  private installGestureUnlockers() {
    if (this.gestureHooksInstalled || typeof document === 'undefined') return;
    this.gestureHooksInstalled = true;
    const onFirstGesture = () => {
      this.unlockFromUserGesture();
    };
    document.addEventListener('pointerdown', onFirstGesture, { passive: true, capture: true });
    document.addEventListener('touchstart', onFirstGesture, { passive: true, capture: true });
    document.addEventListener('click', onFirstGesture, { passive: true, capture: true });
    document.addEventListener('keydown', onFirstGesture, { passive: true, capture: true });
  }

  /**
   * Unlocks Web Speech API inside deployed mobile Chrome / iOS Safari / PWAs
   * where async timer speech is blocked until primed within a user gesture.
   */
  public unlockFromUserGesture() {
    if (this.hasNativeBridge()) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const synth = window.speechSynthesis;
      if (synth.paused) synth.resume();
      if (this.webSpeechPrimed) return;
      this.webSpeechPrimed = true;
      const silent = new SpeechSynthesisUtterance(' ');
      silent.lang = 'es-MX';
      silent.volume = 0;
      silent.rate = 10;
      synth.speak(silent);
    } catch {
      // Ignore unlock errors
    }
  }

  private sanitizeForSpeech(text: string): string {
    return text
      .replace(/[*_`#|[\]]/g, ' ')
      .replace(/→/g, ' hacia ')
      .replace(/≥/g, ' mayor o igual a ')
      .replace(/<=?/g, ' menor o igual a ')
      .replace(/\$(\d)/g, '$1 dólares ')
      .replace(/\$/g, ' dólares ')
      .replace(/%/g, ' por ciento ')
      .replace(/\bSL\b/g, ' stop loss ')
      .replace(/\bTP\b/g, ' take profit ')
      .replace(/\bPnL\b/gi, ' P N L ')
      .replace(/\bMEV\b/g, ' M E V ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private clearWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private flushWebQueue() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (this.isWebSpeaking || this.speechQueue.length === 0) return;

    const nextText = this.speechQueue.shift();
    if (!nextText) return;

    try {
      const synth = window.speechSynthesis;
      if (synth.paused) synth.resume();

      const utter = new SpeechSynthesisUtterance(nextText);
      utter.lang = this.cachedVoice?.lang || 'es-MX';
      utter.rate = 1.05;
      utter.pitch = 0.95;
      utter.volume = 1.0;

      if (!this.cachedVoice) {
        const voices = synth.getVoices();
        this.cachedVoice =
          voices.find((v) => v.lang.toLowerCase().startsWith('es-mx')) ||
          voices.find((v) => v.lang.toLowerCase().startsWith('es-us')) ||
          voices.find((v) => v.lang.toLowerCase().startsWith('es')) ||
          null;
      }
      if (this.cachedVoice) {
        utter.voice = this.cachedVoice;
      }

      this.isWebSpeaking = true;
      const finishCurrent = () => {
        this.clearWatchdog();
        this.isWebSpeaking = false;
        if (this.speechQueue.length > 0 && this.voiceEnabled) {
          setTimeout(() => this.flushWebQueue(), 40);
        }
      };

      utter.onend = finishCurrent;
      utter.onerror = finishCurrent;

      // Guard against Chromium wedged speechSynthesis (never fires onend after sleep/tab switch)
      this.clearWatchdog();
      this.watchdogTimer = setTimeout(() => {
        try {
          synth.cancel();
        } catch {
          // ignore
        }
        finishCurrent();
      }, 12000);

      synth.speak(utter);
    } catch {
      this.clearWatchdog();
      this.isWebSpeaking = false;
    }
  }

  public speak(text: string, priority = false) {
    if (!this.voiceEnabled || !text.trim()) return;
    const clean = this.sanitizeForSpeech(text);
    if (!clean) return;

    const now = Date.now();
    if (!priority && clean === this.lastSpokenText && now - this.lastSpokenAt < 4000) {
      return;
    }
    this.lastSpokenText = clean;
    this.lastSpokenAt = now;

    // Tier 1: Native Android TextToSpeech Bridge inside TUG777 APK
    const androidTts = this.getAndroidBridge();
    if (androidTts) {
      try {
        androidTts.speak(clean, priority);
        return;
      } catch {
        // Fallback to Web Speech if bridge fails
      }
    }

    // Tier 2: Hardened Web Speech Synthesis for Browser / Deployed PWA / Mobile Chrome
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const synth = window.speechSynthesis;
      if (synth.paused) synth.resume();

      if (priority) {
        this.speechQueue = [clean];
        this.clearWatchdog();
        if (this.speakTimer) {
          clearTimeout(this.speakTimer);
          this.speakTimer = null;
        }
        const wasBusy = synth.speaking || synth.pending || this.isWebSpeaking;
        if (wasBusy) {
          synth.cancel();
        }
        this.isWebSpeaking = false;
        // Brief defer after cancel() avoids Chrome dropping the immediately-queued utterance
        this.speakTimer = setTimeout(() => {
          this.speakTimer = null;
          this.flushWebQueue();
        }, wasBusy ? 45 : 0);
        return;
      }

      // Keep queue bounded so autonomous narration always stays fresh
      if (this.speechQueue.length >= 3) {
        this.speechQueue = this.speechQueue.slice(-2);
      }
      this.speechQueue.push(clean);
      if (!this.isWebSpeaking && !synth.speaking) {
        this.flushWebQueue();
      }
    } catch {
      // Ignore synthesis errors when browser blocks autoplay audio before first interaction
    }
  }

  public testVoice(sampleText = '¡Oye socio! Voz de T U G 777 encendida al cien. El mundo es tuyo, vamos por toda esa plata.') {
    this.voiceEnabled = true;
    this.unlockFromUserGesture();
    this.speak(sampleText, true);
  }

  public stopSpeaking() {
    this.speechQueue = [];
    this.clearWatchdog();
    if (this.speakTimer) {
      clearTimeout(this.speakTimer);
      this.speakTimer = null;
    }
    this.isWebSpeaking = false;

    const androidTts = this.getAndroidBridge();
    if (androidTts) {
      try {
        androidTts.stop();
      } catch {
        // ignore
      }
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
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

    if (/(silencia|callate|apaga la voz|desactiva la voz|sin voz)/.test(lower)) {
      return { type: 'MUTE_VOICE', rawText };
    }

    if (/(enciende|activa|prende|inicia).*(ia|inteligencia|motor|bot)/.test(lower)) {
      return { type: 'AI_ON', rawText };
    }
    if (/(apaga|desactiva|deten|para|frena).*(ia|inteligencia|motor|bot)/.test(lower)) {
      return { type: 'AI_OFF', rawText };
    }

    if (/modo.*(estrategia\s*(mas|\+|y)\s*ia|combinado|unificado)/.test(lower)) {
      return { type: 'MODE_STRATEGY_AI', rawText };
    }
    if (/modo.*estrategia/.test(lower)) {
      return { type: 'MODE_STRATEGY', rawText };
    }
    if (/modo.*(ia|inteligencia)/.test(lower)) {
      return { type: 'MODE_AI', rawText };
    }

    if (/(cierra|cerrar).*(todas|todo|posiciones)/.test(lower)) {
      return { type: 'CLOSE_ALL', rawText };
    }
    if (/(cierra|cerrar|salir de)/.test(lower)) {
      const coin = this.extractCoinFromText(upper);
      if (coin) return { type: 'CLOSE_TRADE', coin, rawText };
    }

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

    if (/(analiza|escanea|busca|revisa).*(mercado|oportunidad|senales|ahora)/.test(lower)) {
      return { type: 'ANALYZE_NOW', rawText };
    }

    if (/(actualiza|sincroniza|refresca).*(posicion|posiciones|cuenta|hyperliquid)/.test(lower)) {
      return { type: 'SYNC_POSITIONS', rawText };
    }

    if (/(guarda|salva|almacena).*(config|configuracion|ajustes)/.test(lower)) {
      return { type: 'SAVE_CONFIG', rawText };
    }

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

    if (/(muestra|ver|pon|selecciona|grafica de)/.test(lower)) {
      const coin = this.extractCoinFromText(upper);
      if (coin) return { type: 'SELECT_COIN', coin, rawText };
    }

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
