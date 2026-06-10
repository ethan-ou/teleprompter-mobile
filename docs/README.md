# Teleprompter-mobile — Plans

Working docs for two tracks of work agreed 2026-06.

- [`voice-asr-plan.md`](./voice-asr-plan.md) — replace the Android speech backend with a low-latency, on-device streaming model. Benchmark-first, **far-field focused**.
- [`ux-plan.md`](./ux-plan.md) — UX first pass: dark mode app-wide, control-bar redesign, scroll-to-reposition, keep-awake/haptics, intro-screen usability.

## Context

The app is an Expo / React Native teleprompter. Its strength is `lib/speech-matcher.ts`, which fuzzy-aligns the live transcript to the known script (Levenshtein sliding window + moving-average smoothing) and auto-scrolls. Because the ground-truth script is known, **streaming latency matters far more than transcript WER** — the matcher tolerates a sloppy transcript but not lag.

Today the voice layer (`lib/speech-recognizer.ts`) wraps `expo-speech-recognition`, i.e. Android's native `SpeechRecognizer`: it auto-stops every few seconds (papered over by a restart loop), has high/variable latency, and frequently round-trips to Google servers. Replacing this backend is the core of the voice track.
