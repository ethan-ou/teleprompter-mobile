import { createASREngine, type ASREngine, type ASREngineId } from "./asr";
import { stepPosition, type Position } from "./match-engine";
import { getBoundsStart, resetTranscriptWindow } from "./speech-matcher";
import type { Token } from "./word-tokenizer";

export type { Position } from "./match-engine";

export type RecognizerCallbacks = {
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

  async start(): Promise<void> {
    if (this.speechRecognizer !== null) {
      return;
    }

    try {
      this.speechRecognizer = createASREngine(this.engineId);

      this.speechRecognizer.onstart(() => {
        if (this.position.bounds < 0) {
          const bounds = getBoundsStart(this.tokens, 0);
          if (bounds !== undefined) {
            this.updatePosition({ bounds });
          }
        }
        this.callbacks.onStart?.();
      });

      this.speechRecognizer.onresult((finalTranscript: string, interimTranscript: string) => {
        const next = stepPosition(this.tokens, this.position, finalTranscript, interimTranscript);
        this.updatePosition(next);
      });

      this.speechRecognizer.onerror((error) => {
        this.callbacks.onError?.(error);
      });

      this.speechRecognizer.onend(() => {
        this.speechRecognizer = null;
        this.callbacks.onEnd?.();
        resetTranscriptWindow();
      });

      await this.speechRecognizer.start();
    } catch (error) {
      this.callbacks.onError?.(error);
      throw error;
    }
  }

  stop(): void {
    if (this.speechRecognizer !== null) {
      this.speechRecognizer.stop();
      this.speechRecognizer.cleanup();
      this.speechRecognizer = null;
    }
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
    return this.speechRecognizer !== null;
  }
}
