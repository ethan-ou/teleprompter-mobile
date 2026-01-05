import {
  createTextRegion,
  getBoundsStart,
  getTokensFromText,
  matchText,
  resetTranscriptWindow,
} from "./speech-matcher";
import SpeechRecognizer from "./speech-recognizer";
import type { Token } from "./word-tokenizer";

export type Position = {
  start: number;
  search: number;
  end: number;
  bounds: number;
};

export type RecognizerCallbacks = {
  onStart?: () => void;
  onPositionUpdate?: (position: Position) => void;
  onEnd?: () => void;
  onError?: (error: any) => void;
};

export class TeleprompterRecognizer {
  private speechRecognizer: SpeechRecognizer | null = null;
  private tokens: Token[] = [];
  private position: Position = {
    start: -1,
    search: -1,
    end: -1,
    bounds: -1,
  };
  private callbacks: RecognizerCallbacks = {};

  constructor(tokens: Token[], callbacks: RecognizerCallbacks = {}) {
    this.tokens = tokens;
    this.callbacks = callbacks;
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
      this.speechRecognizer = new SpeechRecognizer();

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
        const textRegion = createTextRegion(this.tokens, this.position.search);
        const boundStart = getBoundsStart(this.tokens, this.position.search, textRegion);

        if (finalTranscript !== "") {
          const foundMatch = matchText(
            getTokensFromText(finalTranscript),
            textRegion,
            this.position.search,
            true
          );

          if (foundMatch) {
            const [, matchEnd] = foundMatch;
            this.updatePosition({
              start: matchEnd,
              search: matchEnd,
              end: matchEnd,
              ...(boundStart !== undefined && { bounds: boundStart }),
            });
          } else {
            this.updatePosition({
              start: this.position.end,
              search: this.position.end,
              end: this.position.end,
              ...(boundStart !== undefined && { bounds: boundStart }),
            });
          }
        }

        if (interimTranscript !== "") {
          const foundMatch = matchText(
            getTokensFromText(interimTranscript),
            textRegion,
            this.position.search,
            false
          );

          if (foundMatch) {
            const [matchStart, matchEnd] = foundMatch;
            this.updatePosition({
              search: matchStart,
              end: matchEnd,
              ...(boundStart !== undefined && { bounds: boundStart }),
            });
          }
        }
      });

      this.speechRecognizer.onerror((error) => {
        this.callbacks.onError?.(error);
      });

      this.speechRecognizer.onend(() => {
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
