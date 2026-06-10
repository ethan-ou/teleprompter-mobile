# Voice: low-latency on-device ASR for Android

Goal: replace the `expo-speech-recognition` (Android `SpeechRecognizer`) backend with an
on-device **streaming** model that tracks a presenter reliably — **including when they are
standing back from the phone (far-field)**, which is the real teleprompter scenario.

**Decision (committed): go straight for sherpa-onnx streaming Zipformer.** On architecture +
training-data grounds it should clearly beat Vosk on the metric that matters here (far-field
tracking) at acceptable size/CPU — see §1.1. Vosk's only edges are tiny size and low power, which
are not priorities. So we do **not** run a Vosk-vs-sherpa bake-off. The benchmark is reframed as a
**far-field validation + tuning harness for sherpa** (prove it tracks at 2–3 m with noise; tune
capture chain + endpointing). We keep the pluggable `ASREngine` seam regardless — it's cheap, and it
keeps the existing Google engine as a fallback.

---

## 1.1 Why sherpa-onnx over Vosk (the architecture call)

- **Vosk** = Kaldi hybrid; the small ~40 MB English model is a TDNN-F chain (HMM/DNN) trained mostly
  on clean read speech. That architecture + that data is the worst case for reverb/low-SNR — it
  degrades hard far-field. Strengths (tiny size, low power) aren't what we need.
- **sherpa-onnx streaming Zipformer** = next-gen Kaldi (k2/icefall). Zipformer is a conformer-evolved
  architecture (attention + convolution, multi-scale downsampling) decoded as an RNN-T transducer:
  structurally more noise/reverb robust than TDNN-F, still true low-latency streaming. Streaming
  checkpoints are trained on large varied corpora (GigaSpeech, LibriHeavy, multi-dataset), which is
  most of what buys far-field robustness. onnxruntime + NNAPI/XNNPACK keeps it realtime; int8
  quantizable (~70–300 MB).
- **Bonus — model-swappable within one integration:** sherpa-onnx also runs NeMo streaming models
  (FastConformer/Parakeet), often trained with heavier augmentation → potentially even better
  far-field. So if streaming Zipformer underperforms, we swap the model, not the integration. Vosk
  would lock us to Kaldi.
- **Caveats:** (1) far-field is partly the **capture chain** (audio source `VOICE_RECOGNITION` for
  AEC/NS/AGC, gain/AGC, VAD endpointing for low-energy speech) — applies regardless of model;
  (2) the RN sherpa lib is younger than react-native-vosk — verify early it exposes the audio
  source / raw PCM we need, else a small native patch may be required.

---

## 1. Why streaming, not the most accurate model

The matcher (`lib/speech-matcher.ts`) already knows the script, so it forgives a noisy
transcript. What it cannot forgive is latency: every 500 ms of lag is the cursor falling
behind the speaker. So the axis that matters is **streaming first-word latency at acceptable
accuracy**, not leaderboard WER.

| Model | WER (clean) | Streaming? | On-device Android | Verdict for live far-field teleprompter |
|---|---|---|---|---|
| **Cohere Transcribe** (03-2026, 2B) | 5.42% (#1 Open ASR) | ❌ full-utterance enc-dec | ❌ 2B, too slow to decode live | No — SOTA accuracy, decode latency kills it. Only viable for a future *offline* "align an imported recording" feature. |
| Whisper large-v3 / Moonshine | ~6–8% | ❌ chunked (~1–2 s windows) | partial | No for live; reprocesses windows. Robust to noise though. |
| Parakeet TDT 0.6B (FastConformer) | ~6% | streaming variant (cache-aware) | heavy (~0.6B) | Stretch — strong far-field robustness, but mobile streaming is non-trivial. Benchmark if time allows. |
| **sherpa-onnx streaming Zipformer transducer** | ~7–9% | ✅ true streaming + endpointing | ✅ onnxruntime + NNAPI/XNNPACK, ~70–300 MB int8 | **Primary candidate.** Low latency, decent accuracy, trained on large/varied corpora (better far-field than Vosk). |
| **Vosk small (Kaldi)** | ~10–12% | ✅ true streaming, word-by-word | ✅ CPU-only, ~40 MB | **Baseline.** Easiest to ship, lowest power. Expect it to degrade most in far-field — that's a key thing to measure. |

Both Vosk and sherpa-onnx have maintained RN libraries with Expo config plugins
([react-native-vosk](https://github.com/riderodd/react-native-vosk),
[react-native-sherpa-onnx](https://github.com/XDcobra/react-native-sherpa-onnx)). The app already
uses a custom dev build (`expo run:android`), so native modules are fine (they won't run in Expo Go).

## 2. Far-field is the headline requirement

The presenter is typically **1–3 m from the phone**, off-axis, often in a reverberant room with
ambient noise. This is the hardest case for ASR and the one most likely to separate the engines.
Design implications:

- **Capture chain matters as much as the model.** Use the Android `VOICE_RECOGNITION` audio source
  so the platform AEC / noise-suppression / AGC kicks in; consider an explicit gain/AGC stage and a
  light high-pass before the model. Whichever RN lib we use, verify what audio source it opens.
- **VAD + endpointing** tuned for low-energy speech so trailing words aren't clipped.
- Pick model variants trained on noisy/far-field data where available (e.g. GigaSpeech-trained
  zipformer) over clean-read-speech-only models.

## 3. The benchmark — what we actually measure

A reproducible, **offline** harness so results don't depend on live mic conditions or wall-clock luck.
Feed fixed pre-recorded WAVs through each engine and score:

**Per-engine, per-recording metrics**
- **First-partial latency** — silence → first word emitted.
- **Mean per-word emit latency** — audio time of a word vs. time the engine emits it.
- **RTFx** — decode speed (audio seconds / compute seconds) on a real device.
- **WER** vs. the script.
- **Cursor tracking error (the metric that matters)** — pipe each engine's transcript stream through
  the *actual* `lib/speech-matcher.ts` and measure: (a) words the cursor lags behind the true read
  position, (b) count of mis-jumps / regressions, (c) longest stall.
- **Battery / CPU** — rough, device-measured, for the realtime path.

**The recording matrix — far-field is the point**
Record the *same* known script read aloud under a grid of conditions, on the **phone's own mic**:

| Distance | Environment |
|---|---|
| 0.3 m (near, control) | quiet room |
| 1 m | quiet room |
| 2–3 m | quiet room |
| 2–3 m | room reverb (hard surfaces) |
| 2–3 m | ambient noise (HVAC / chatter / music bed) |
| 2–3 m | off-axis (phone not pointed at speaker) |

Plus a couple of different voices and a fast vs. measured reading pace. Store WAVs + ground-truth
transcript with word timings under `docs/benchmark-audio/` (or an ignored assets dir) so the run is repeatable.

The win condition isn't "lowest WER" — it's **lowest cursor-tracking error at 2–3 m with noise**,
subject to acceptable battery. An engine that's 12% WER but tracks smoothly far-field beats one that's
7% WER but stalls when the speaker steps back.

## 4. Model selection (decided)

Library: [react-native-sherpa-onnx](https://github.com/XDcobra/react-native-sherpa-onnx). Its
`react-native-sherpa-onnx/stt` (`createStreamingSTT`) + `react-native-sherpa-onnx/audio`
(`createPcmLiveStream`) give exactly the streaming surface we need — and confirm Cohere/Moonshine are
offline-only types (`getOnlineTypeOrNull` → null), so they're out of the live path by construction.

Streaming English options (sizes from the `asr-models` release; note tarballs bundle fp32+int8+test
data, so the int8-only rows are the fair footprint comparison). The `…ms` suffix on NeMo models is the
model's **algorithmic lookahead** — smaller = lower latency, larger = more accurate; we sweep it in the harness.

| Model | ~int8 footprint | Recency | Far-field expectation | Cost / risk |
|---|---|---|---|---|
| **`sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms-int8`** | **~100 MB** | newer (NeMo) | good — heavy NeMo augmentation, selectable latency | **DEFAULT candidate.** Light enough for broad Android |
| `sherpa-onnx-nemotron-speech-streaming-en-0.6b-160ms-int8-2026-04-25` | ~600 MB unpacked | **newest (Apr 2026)** | **best** — NVIDIA Nemotron 0.6B, cache-aware streaming | Quality ceiling; heavy RAM/compute, flagship-only risk |
| `sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-streaming-560ms` | ~600 MB unpacked | new | best-class (Parakeet 0.6B) | Same heavy class as Nemotron |
| `sherpa-onnx-streaming-zipformer-en-2023-06-21` (LibriSpeech+GigaSpeech) | ~179 MB | 2023 | decent | Lightweight proven **fallback** |

**Decision:** lead with **NeMo streaming FastConformer transducer en 480ms int8 (~100 MB)** as the
production default candidate; benchmark **Nemotron 0.6B 160ms (Apr 2026)** as the quality ceiling to
decide whether ~500 MB extra + compute earns its place; keep the 2023 zipformer as the lightweight
fallback. The harness sweeps latency variants (80/160/480/560/1120ms) per model.

## 5. Implementation plan

**Phase 0 — pluggable seam (DONE, no behavior change).** `ASREngine` interface + `ASREmitter` base;
today's Google path is now `ExpoASREngine`; `TeleprompterRecognizer` builds engines via
`createASREngine(engineId)` and the matcher is untouched.

```
lib/asr/
  types.ts          # ASREngine interface + (final, interim) result contract
  emitter.ts        # shared subscriber bookkeeping
  expo-engine.ts    # current expo-speech-recognition path (default, unchanged behavior)
  sherpa-engine.ts  # react-native-sherpa-onnx streaming zipformer (scaffold → impl in Phase 1)
  index.ts          # factory: pick engine by id, fall back to expo when unavailable
```

**Phase 1 — implement `SherpaASREngine`.**
1. `npx expo install react-native-sherpa-onnx`, add its Expo config plugin, rebuild dev client.
2. Bundle the GigaSpeech model under `assets/models/streaming-zipformer-en`.
3. Wire the streaming session (concrete recipe):
   ```ts
   const engine = await createStreamingSTT({
     modelPath: { type: 'asset', path: 'models/streaming-zipformer-en' },
     modelType: 'transducer',
     enableEndpoint: true,
     enableInputNormalization: true,              // adaptive gain to ~0.8 peak — key far-field
     endpointConfig: { rule2: { minTrailingSilence: 1.0, mustContainNonSilence: true } },
   });
   const stream = await engine.createStream();
   const pcm = createPcmLiveStream({ sampleRate: 16000 });
   pcm.onData(async (samples, sr) => {
     const { result, isEndpoint } = await stream.processAudioChunk(samples, sr);
     if (result.text) emitResult('', result.text);   // interim → matcher
     if (isEndpoint) { emitResult(result.text, ''); await stream.reset(); }  // final
   });
   await pcm.start();
   ```
   Keep the `(final, interim)` contract so `lib/recognizer.ts` + matcher are untouched. Process
   chunks serially to avoid overlapping native calls.

**Phase 2 — benchmark harness (DONE, scaffold).** The matcher's cursor-stepping was extracted into a
pure `lib/match-engine.ts` (`stepPosition`) used by BOTH the live recognizer and the scorer, so the
benchmark judges with the exact production matcher. Built:

```
lib/match-engine.ts        # pure (final, interim) -> next cursor position (shared)
lib/benchmark/
  types.ts                 # TranscriptEvent / WordTiming / BenchmarkCase / BenchmarkResult
  scorer.ts                # replay -> first-partial & word latency, WER, RTFx, tracking error
  sample.ts                # synthetic self-test cases (ideal vs degraded far-field)
app/benchmark.tsx          # hidden dev screen at /benchmark — runs scorer, renders metrics
```

To run for real: log each candidate engine's timestamped `(final, interim)` output while playing the
far-field recording matrix, plus ground-truth word timings, as `BenchmarkCase`s; replace
`SAMPLE_CASES` and open `/benchmark`. The "Cursor tracking" block (mean/max lag, misjumps, longest
stall) is the decision metric.

**Phase 3 — decision + wiring.** Lock default model/engine from the numbers, expose an override in
settings, keep `ExpoASREngine` as fallback where the native model isn't present.

## 6. Open questions / risks

- **Capture chain (mostly answered):** the lib's `createPcmLiveStream` resamples to 16 kHz and
  `enableInputNormalization` handles varying mic levels. Still verify the Android audio *source* it
  opens — ideally `VOICE_RECOGNITION` so platform AEC/NS/AGC engage; may need a small native tweak.
- **Endpoint tuning for far-field:** low-energy trailing words get clipped if `minTrailingSilence` is
  too low — tune in the harness.
- **Model bundle strategy:** ~179 MB in-APK vs. download-on-first-run (size vs. first-launch UX).
- **NeMo FastConformer** worth a benchmark slot for its far-field strength.
