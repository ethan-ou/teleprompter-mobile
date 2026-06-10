import { ASREmitter } from "./emitter";
import type { ASRAvailability, ASREngine } from "./types";

/*
  On-device streaming engine (PRIMARY TARGET) — sherpa-onnx streaming Zipformer.

  STATUS: scaffold. The native module (react-native-sherpa-onnx) and a streaming
  model are not yet installed, so this engine reports `unavailable` and the
  factory falls back to ExpoASREngine. The app keeps building until then.

  CHOSEN MODEL (default candidate): sherpa-onnx-nemo-streaming-fast-conformer-
    transducer-en-480ms-int8 (~100MB, newer than zipformer, selectable latency, good
    far-field). Quality ceiling to benchmark: sherpa-onnx-nemotron-speech-streaming-
    en-0.6b-160ms-int8-2026-04-25 (~600MB unpacked, best far-field, flagship-only).
    Lightweight fallback: sherpa-onnx-streaming-zipformer-en-2023-06-21 (int8 ~179MB).
    The `...ms` suffix is the model's algorithmic lookahead (latency vs accuracy) — sweep it.

  To make this real (see docs/voice-asr-plan.md for the full recipe):
    1. `npx expo install react-native-sherpa-onnx` and add its Expo config plugin.
    2. Bundle the streaming model under assets as `models/streaming-zipformer-en`.
    3. Rebuild the dev client (`expo run:android`) — native module, not Expo Go.
    4. Implement start()/stop() with the lib's streaming API:
         createStreamingSTT({ modelPath:{type:'asset',path:'models/streaming-zipformer-en'},
           modelType:'transducer', enableEndpoint:true, enableInputNormalization:true,
           endpointConfig:{ rule2:{ minTrailingSilence: 1.0, mustContainNonSilence:true } } })
         + createPcmLiveStream({ sampleRate:16000 }); on each onData chunk call
         stream.processAudioChunk(samples, sr): emit interim via emitResult("", result.text);
         on isEndpoint emit final via emitResult(result.text, "") then stream.reset().
       Keep the (final, interim) contract identical so the matcher is untouched.

  Far-field tunables to validate in the benchmark harness:
    - enableInputNormalization (adaptive gain to ~0.8 peak — on by default, key for far mic)
    - endpoint rule2.minTrailingSilence (lower = snappier, too low clips low-energy words)
    - numThreads / provider ('cpu' vs 'qnn') for realtime headroom
*/

export class SherpaASREngine extends ASREmitter implements ASREngine {
  static availability(): ASRAvailability {
    return {
      available: false,
      reason: "sherpa-onnx native module/model not installed yet (see docs/voice-asr-plan.md)",
    };
  }

  async start(): Promise<void> {
    this.emitError({
      code: "unavailable",
      message: SherpaASREngine.availability().reason,
    });
    this.emitEnd();
  }

  stop(): void {
    // no-op until implemented
  }
}
