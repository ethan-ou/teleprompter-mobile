/*
  Data model for the offline ASR benchmark (see docs/voice-asr-plan.md §3).

  We replay a recorded engine transcript stream against a known script and score
  it. The same recording is read under the far-field matrix (0.3m / 1m / 2-3m,
  quiet / reverb / noise / off-axis); each (engine, recording) pair is one case.
*/

/** One transcript update from an engine, timestamped from the start of the audio. */
export type TranscriptEvent = {
  /** ms from audio start when the engine emitted this update. */
  t: number;
  /** Final (locked) segment text, if this update finalized one. */
  final?: string;
  /** Interim hypothesis text, if any. */
  interim?: string;
};

/** Ground-truth: each spoken word and the audio time it was actually said. */
export type WordTiming = {
  word: string;
  /** ms from audio start. */
  t: number;
};

export type BenchmarkCase = {
  /** e.g. "fastconformer-480ms @ 2-3m + noise". */
  name: string;
  /** Ground-truth script shown on the teleprompter. */
  script: string;
  /** True read schedule (word-level timings) for lag/latency scoring. */
  groundTruth: WordTiming[];
  /** Engine output to replay. */
  events: TranscriptEvent[];
  /** Total audio length in ms. */
  audioDurationMs: number;
  /** Wall-clock decode time in ms on the test device, for RTFx. Optional. */
  computeMs?: number;
};

export type TrackingError = {
  /** Mean words the cursor lagged behind the true read position (>0 = behind). */
  meanLagWords: number;
  /** Worst single lag in words. */
  maxLagWords: number;
  /** Number of backward cursor jumps (regressions). */
  misjumps: number;
  /** Longest period (ms) the cursor stalled while the reader kept going. */
  longestStallMs: number;
};

export type BenchmarkResult = {
  name: string;
  /** ms from audio start to first non-empty transcript. null if none. */
  firstPartialLatencyMs: number | null;
  /** Mean ms between a word being spoken and the cursor reaching it. null if none reached. */
  meanWordLatencyMs: number | null;
  /** Word error rate of the finalized transcript vs the script (0..1+). */
  wer: number;
  /** The metric that matters: how well the cursor tracked the reader. */
  trackingError: TrackingError;
  /** audio seconds / compute seconds. null if computeMs not provided. */
  rtfx: number | null;
};
