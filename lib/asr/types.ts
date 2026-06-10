/*
  Pluggable ASR backend seam.

  The teleprompter only needs a stream of transcript updates: incremental
  `interim` hypotheses for responsive cursor movement, and `final` segments
  that lock in. Every engine (Android's SpeechRecognizer, sherpa-onnx, ...)
  implements this same surface so `TeleprompterRecognizer` and the matcher
  never need to know which backend is running.
*/

export type ResultSubscriber = (finalTranscript: string, interimTranscript: string) => void;
export type ErrorSubscriber = (error: ASRError) => void;
export type VoidSubscriber = () => void;

export type ASRError = {
  /** Stable machine code where the engine provides one (e.g. "not-allowed"). */
  code?: string;
  message?: string;
};

export interface ASREngine {
  /** Begin recognition. Should request mic permission if needed. */
  start(): Promise<void>;
  /** Stop recognition. Idempotent. */
  stop(): void;
  /** Remove all subscribers. Call when tearing the engine down. */
  cleanup(): void;

  onstart(subscriber: VoidSubscriber): void;
  onresult(subscriber: ResultSubscriber): void;
  onerror(subscriber: ErrorSubscriber): void;
  onend(subscriber: VoidSubscriber): void;
}

export type ASREngineId = "expo" | "sherpa";

/** Whether an engine can actually run on this device/build right now. */
export type ASRAvailability = {
  available: boolean;
  /** Human-readable reason when unavailable (missing native module, no model, ...). */
  reason?: string;
};
