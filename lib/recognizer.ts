import { createASREngine, type ASREngine, type ASREngineId } from "./asr";
import { stepPosition, type Position } from "./match-engine";
import { getBoundsStart, resetTranscriptWindow } from "./speech-matcher";
import type { Token } from "./word-tokenizer";

export type { Position } from "./match-engine";

export type RecognizerCallbacks = {
  /** Engine prepared (permissions granted, model loaded) — safe to start. */
  onReady?: () => void;
  onStart?: () => void;
  onPositionUpdate?: (position: Position) => void;
  onEnd?: () => void;
  onError?: (error: any) => void;
};

export class TeleprompterRecognizer {
  private speechRecognizer: ASREngine | null = null;
  private engineId: ASREngineId;
  private tokens: Token[] = [];
  private position: Position = {
    start: -1,
    search: -1,
    end: -1,
    bounds: -1,
  };
  private callbacks: RecognizerCallbacks = {};

  private prepared = false;
  private preparing = false;
  private running = false;

  constructor(tokens: Token[], callbacks: RecognizerCallbacks = {}, engineId: ASREngineId = "expo") {
    this.tokens = tokens;
    this.callbacks = callbacks;
    this.engineId = engineId;
  }

  updateTokens(tokens: Token[]) {
    this.tokens = tokens;
  }

  updatePosition(position: Partial<Position>) {
    this.position = { ...this.position, ...position };
    this.callbacks.onPositionUpdate?.(this.position);
  }

  getPosition(): Position {
    return this.position;
  }

  /** Create the engine once and wire its events. The engine is kept warm and
   *  reused across start/stop so a preloaded model isn't thrown away. */
  private ensureEngine(): ASREngine {
    if (this.speechRecognizer) return this.speechRecognizer;

    const engine = createASREngine(this.engineId);

    engine.onstart(() => {
      if (this.position.bounds < 0) {
        const bounds = getBoundsStart(this.tokens, 0);
        if (bounds !== undefined) {
          this.updatePosition({ bounds });
        }
      }
      this.callbacks.onStart?.();
    });

    engine.onresult((finalTranscript: string, interimTranscript: string) => {
      const next = stepPosition(this.tokens, this.position, finalTranscript, interimTranscript);
      this.updatePosition(next);
    });

    engine.onerror((error) => {
      this.callbacks.onError?.(error);
    });

    engine.onend(() => {
      this.running = false;
      this.callbacks.onEnd?.();
      resetTranscriptWindow();
    });

    this.speechRecognizer = engine;
    return engine;
  }

  /** Warm up the engine ahead of time (request permissions, load the on-device
   *  model). Call this on screen entry so `start()` is near-instant. Safe to
   *  call multiple times. */
  async prepare(): Promise<void> {
    if (this.prepared || this.preparing) return;
    this.preparing = true;
    try {
      const engine = this.ensureEngine();
      await engine.prepare?.();
      this.prepared = true;
      this.callbacks.onReady?.();
    } catch (error) {
      this.callbacks.onError?.(error);
    } finally {
      this.preparing = false;
    }
  }

  isReady(): boolean {
    return this.prepared;
  }

  async start(): Promise<void> {
    const engine = this.ensureEngine();
    try {
      this.running = true;
      await engine.start();
    } catch (error) {
      this.running = false;
      this.callbacks.onError?.(error);
      throw error;
    }
  }

  stop(): void {
    this.running = false;
    this.speechRecognizer?.stop();
    resetTranscriptWindow();
  }

  reset(): void {
    this.position = {
      start: -1,
      search: -1,
      end: -1,
      bounds: -1,
    };
    resetTranscriptWindow();
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Fully tear down the engine and free any loaded model. Call on unmount. */
  dispose(): void {
    this.running = false;
    this.prepared = false;
    if (this.speechRecognizer) {
      this.speechRecognizer.stop();
      this.speechRecognizer.cleanup();
      this.speechRecognizer = null;
    }
    resetTranscriptWindow();
  }
}
