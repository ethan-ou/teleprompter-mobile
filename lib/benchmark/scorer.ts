import { stepPosition, type Position } from "../match-engine";
import { resetTranscriptWindow } from "../speech-matcher";
import { tokenize, type Token } from "../word-tokenizer";
import type { BenchmarkCase, BenchmarkResult, TrackingError } from "./types";

/*
  Pure offline scorer. Replays an engine's timestamped transcript through the
  exact production matcher (`stepPosition`) and reports the metrics in
  docs/voice-asr-plan.md §3. No device or native module needed — feed it logged
  engine output + ground-truth timings.
*/

const START_POSITION: Position = { start: -1, search: -1, end: -1, bounds: -1 };

/** Word-level edit distance (Levenshtein over word arrays). */
function wordEditDistance(ref: string[], hyp: string[]): number {
  const n = ref.length;
  const m = hyp.length;
  if (n === 0) return m;
  if (m === 0) return n;

  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let curr = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m];
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Map each token index to its word ordinal (0-based count of TOKEN tokens before it inclusive). */
function buildWordOrdinals(tokens: Token[]): Map<number, number> {
  const map = new Map<number, number>();
  let ordinal = -1;
  for (const token of tokens) {
    if (token.type === "TOKEN") ordinal++;
    map.set(token.index, Math.max(0, ordinal));
  }
  return map;
}

/** Reconstruct the finalized transcript by concatenating final segments. */
function finalizedTranscript(events: BenchmarkCase["events"]): string {
  return events
    .map((e) => e.final ?? "")
    .filter(Boolean)
    .join(" ");
}

export function scoreCase(testCase: BenchmarkCase): BenchmarkResult {
  const { script, events, groundTruth, audioDurationMs, computeMs } = testCase;
  const tokens = tokenize(script);
  const wordOrdinalOfToken = buildWordOrdinals(tokens);
  const totalWords = groundTruth.length;

  // Replay the engine stream through the real matcher, recording cursor over time.
  resetTranscriptWindow();
  let position = START_POSITION;
  const ordered = [...events].sort((a, b) => a.t - b.t);
  const cursorSamples: { t: number; wordOrdinal: number }[] = [];
  let misjumps = 0;
  let prevOrdinal = 0;

  for (const event of ordered) {
    position = stepPosition(tokens, position, event.final ?? "", event.interim ?? "");
    const cursorOrdinal = position.end >= 0 ? wordOrdinalOfToken.get(position.end) ?? 0 : 0;
    if (cursorOrdinal < prevOrdinal - 1) misjumps++; // tolerate tiny -1 jitter
    prevOrdinal = cursorOrdinal;
    cursorSamples.push({ t: event.t, wordOrdinal: cursorOrdinal });
  }

  // True words-read at a given time = count of ground-truth words spoken by then.
  const trueWordsReadAt = (t: number): number => {
    // groundTruth is in order; binary search would be nicer but N is small.
    let count = 0;
    for (const w of groundTruth) {
      if (w.t <= t) count++;
      else break;
    }
    return count;
  };

  // Tracking error: lag = (true words read) - (cursor word ordinal) at each sample.
  let lagSum = 0;
  let maxLag = 0;
  for (const sample of cursorSamples) {
    const lag = trueWordsReadAt(sample.t) - sample.wordOrdinal;
    lagSum += lag;
    if (lag > maxLag) maxLag = lag;
  }
  const meanLagWords = cursorSamples.length ? lagSum / cursorSamples.length : 0;

  // Longest stall: max time the cursor ordinal didn't advance while the reader did.
  let longestStallMs = 0;
  let stallStartT: number | null = null;
  let stallStartOrdinal = 0;
  for (const sample of cursorSamples) {
    if (stallStartT === null) {
      stallStartT = sample.t;
      stallStartOrdinal = sample.wordOrdinal;
      continue;
    }
    if (sample.wordOrdinal > stallStartOrdinal) {
      stallStartT = sample.t;
      stallStartOrdinal = sample.wordOrdinal;
    } else if (trueWordsReadAt(sample.t) > stallStartOrdinal + 1) {
      // reader has moved on but cursor hasn't
      longestStallMs = Math.max(longestStallMs, sample.t - stallStartT);
    }
  }

  const trackingError: TrackingError = {
    meanLagWords: round(meanLagWords, 2),
    maxLagWords: maxLag,
    misjumps,
    longestStallMs,
  };

  // First-partial latency
  const firstEvent = ordered.find((e) => (e.final ?? e.interim ?? "") !== "");
  const firstPartialLatencyMs = firstEvent ? firstEvent.t : null;

  // Mean per-word latency: when did the cursor first reach each ground-truth word ordinal?
  const reachTimeByOrdinal = new Map<number, number>();
  for (const sample of cursorSamples) {
    for (let ord = 1; ord <= sample.wordOrdinal; ord++) {
      if (!reachTimeByOrdinal.has(ord)) reachTimeByOrdinal.set(ord, sample.t);
    }
  }
  let latencySum = 0;
  let latencyCount = 0;
  groundTruth.forEach((w, i) => {
    const reached = reachTimeByOrdinal.get(i + 1);
    if (reached !== undefined) {
      latencySum += reached - w.t;
      latencyCount++;
    }
  });
  const meanWordLatencyMs = latencyCount ? round(latencySum / latencyCount, 0) : null;

  // WER of finalized transcript vs script
  const refWords = normalizeWords(script);
  const hypWords = normalizeWords(finalizedTranscript(events));
  const wer = refWords.length
    ? round(wordEditDistance(refWords, hypWords) / refWords.length, 3)
    : 0;

  const rtfx = computeMs && computeMs > 0 ? round(audioDurationMs / computeMs, 1) : null;

  return {
    name: testCase.name,
    firstPartialLatencyMs,
    meanWordLatencyMs,
    wer,
    trackingError,
    rtfx,
  };
}

export function scoreAll(cases: BenchmarkCase[]): BenchmarkResult[] {
  return cases.map(scoreCase);
}

function round(value: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}
