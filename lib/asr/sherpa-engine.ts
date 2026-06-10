import { assetModelPath } from "react-native-sherpa-onnx";
import { createPcmLiveStream, type PcmLiveStreamHandle } from "react-native-sherpa-onnx/audio";
import {
  createStreamingSTT,
  type StreamingSttEngine,
  type SttStream,
} from "react-native-sherpa-onnx/stt";
import { PermissionsAndroid, Platform } from "react-native";
import { ASREmitter } from "./emitter";
import type { ASRAvailability, ASREngine } from "./types";

/*
  On-device streaming engine (PRIMARY): sherpa-onnx streaming FastConformer
  transducer (NeMo, en, 480ms, int8), bundled at assets/models/fast-conformer-en-480ms.

  Flow: load model in prepare() (the expensive warm-up) -> open mic via the lib's
  PCM live stream in start() -> feed chunks to the streaming recognizer -> emit
  interim/final on the same (final, interim) contract the matcher already consumes.
  Far-field knobs: enableInputNormalization (adaptive gain) + endpoint rule2.
*/

const MODEL_ASSET = "models/fast-conformer-en-480ms";
const SAMPLE_RATE = 16000;

export class SherpaASREngine extends ASREmitter implements ASREngine {
  private engine: StreamingSttEngine | null = null;
  private stream: SttStream | null = null;
  private pcm: PcmLiveStreamHandle | null = null;
  private unsubData: (() => void) | null = null;
  private unsubError: (() => void) | null = null;
  private chain: Promise<void> = Promise.resolve();
  private lastText = "";

  static availability(): ASRAvailability {
    // Native module + bundled model are present in this build.
    return { available: true };
  }

  async prepare(): Promise<void> {
    if (Platform.OS === "android") {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: "Microphone permission",
          message: "Microphone access is required for on-device voice tracking.",
          buttonPositive: "OK",
        }
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error("Microphone permission not granted");
      }
    }

    // Load the model — the heavy step we want done before the user hits play.
    this.engine = await createStreamingSTT({
      modelPath: assetModelPath(MODEL_ASSET),
      modelType: "auto",
      enableEndpoint: true,
      enableInputNormalization: true,
      // The encoder dominates decode time; let it use the phone's big cores so a
      // chunk decodes well inside its 100ms arrival window and never backs up the
      // serial chain (the thing that would otherwise grow tracking latency).
      numThreads: 4,
      decodingMethod: "greedy_search", // fastest; the matcher tolerates a sloppy transcript
      endpointConfig: {
        // Speech-then-silence ends an utterance. Trailing silence kept modest so
        // low-energy far-field words aren't clipped.
        rule2: { mustContainNonSilence: true, minTrailingSilence: 1.0, minUtteranceLength: 0 },
      },
    });
    this.stream = await this.engine.createStream();
  }

  async start(): Promise<void> {
    if (!this.engine) await this.prepare();
    if (!this.stream && this.engine) this.stream = await this.engine.createStream();

    this.lastText = "";
    this.chain = Promise.resolve();

    const pcm = createPcmLiveStream({ sampleRate: SAMPLE_RATE });
    this.pcm = pcm;

    this.unsubError = pcm.onError((message) => {
      this.emitError({ code: "audio", message });
    });

    // Serialize chunk processing so native calls don't overlap. Pass the
    // Float32Array straight through: the lib hands us a freshly-allocated buffer
    // per chunk (no reuse to guard against) and converts to a bridge array itself,
    // so an Array.from() here would just be a redundant second boxing on the hot path.
    this.unsubData = pcm.onData((samples, sr) => {
      this.chain = this.chain.then(() => this.processFrame(samples, sr));
    });

    await pcm.start();
    this.emitStart();
  }

  private async processFrame(samples: Float32Array, sampleRate: number): Promise<void> {
    const stream = this.stream;
    if (!stream) return;
    try {
      const { result, isEndpoint } = await stream.processAudioChunk(samples, sampleRate);
      if (result.text && result.text !== this.lastText) {
        this.lastText = result.text;
        this.emitResult("", result.text); // interim
      }
      if (isEndpoint) {
        if (result.text) this.emitResult(result.text, ""); // final
        this.lastText = "";
        await stream.reset();
      }
    } catch (error) {
      console.warn("sherpa chunk error:", error);
    }
  }

  stop(): void {
    this.pcm?.stop().catch(() => {});
    this.unsubData?.();
    this.unsubError?.();
    this.unsubData = null;
    this.unsubError = null;
    this.pcm = null;
    this.stream?.reset().catch(() => {});
    this.lastText = "";
  }

  cleanup(): void {
    super.cleanup();
    this.stop();
    this.stream?.release().catch(() => {});
    this.engine?.destroy().catch(() => {});
    this.stream = null;
    this.engine = null;
  }
}
