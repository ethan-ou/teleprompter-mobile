import type { BenchmarkCase, TranscriptEvent, WordTiming } from "./types";

/*
  Synthetic cases to self-test the scorer without a device. They demonstrate the
  harness end to end: feed an engine's timestamped output + ground-truth timings,
  get back the metrics. Replace these with REAL logged engine output from the
  far-field recording matrix (docs/voice-asr-plan.md §3) when running for real.
*/

const SCRIPT =
  "Good evening everyone and welcome to the show tonight we have an incredible " +
  "lineup of stories that will keep you on the edge of your seat so sit back relax " +
  "and enjoy the program";

const SCRIPT_WORDS = SCRIPT.split(/\s+/);
const MS_PER_WORD = 400; // ~150 wpm

// Ground-truth read schedule: one word every MS_PER_WORD.
const groundTruth: WordTiming[] = SCRIPT_WORDS.map((word, i) => ({
  word,
  t: i * MS_PER_WORD,
}));

const audioDurationMs = SCRIPT_WORDS.length * MS_PER_WORD;

/** A near-ideal streaming engine: low-latency interims tracking just behind the reader. */
function idealEvents(): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  for (let i = 0; i < SCRIPT_WORDS.length; i++) {
    // interim a hair after the word is spoken, carrying the last few words
    const window = SCRIPT_WORDS.slice(Math.max(0, i - 4), i + 1).join(" ");
    events.push({ t: i * MS_PER_WORD + 120, interim: window });
    // finalize every ~6 words
    if ((i + 1) % 6 === 0) {
      events.push({ t: i * MS_PER_WORD + 180, final: SCRIPT_WORDS.slice(i - 5, i + 1).join(" ") });
    }
  }
  return events;
}

/** A degraded far-field engine: delayed, sparser, a couple of garbled words. */
function farFieldEvents(): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  const garble: Record<number, string> = { 5: "welcom", 13: "linup", 24: "relx" };
  for (let i = 0; i < SCRIPT_WORDS.length; i++) {
    if (i % 2 === 1) continue; // misses half the interims (low SNR)
    const words = SCRIPT_WORDS.slice(Math.max(0, i - 3), i + 1).map(
      (w, k) => garble[i - (3 - k)] ?? w
    );
    // ~700ms extra latency from buffering + endpointing
    events.push({ t: i * MS_PER_WORD + 700, interim: words.join(" ") });
    if ((i + 1) % 8 === 0) {
      events.push({ t: i * MS_PER_WORD + 850, final: SCRIPT_WORDS.slice(i - 5, i + 1).join(" ") });
    }
  }
  return events;
}

export const SAMPLE_CASES: BenchmarkCase[] = [
  {
    name: "synthetic: ideal streaming (near mic)",
    script: SCRIPT,
    groundTruth,
    events: idealEvents(),
    audioDurationMs,
    computeMs: Math.round(audioDurationMs / 20), // RTFx ~20
  },
  {
    name: "synthetic: degraded (2-3m + noise)",
    script: SCRIPT,
    groundTruth,
    events: farFieldEvents(),
    audioDurationMs,
    computeMs: Math.round(audioDurationMs / 8), // RTFx ~8
  },
];
