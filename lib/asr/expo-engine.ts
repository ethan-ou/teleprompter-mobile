import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from "expo-speech-recognition";
import { Alert } from "react-native";
import { ASREmitter } from "./emitter";
import type { ASRAvailability, ASREngine } from "./types";

/*
  Default backend: Android's native SpeechRecognizer (via expo-speech-recognition).

  Known limitations this engine works around:
  - The recognizer auto-stops after a short window, so we restart on "end" while
    running. Repeated rapid restarts are treated as a runaway loop and aborted.
  - It is high/variable latency and may round-trip to Google servers.

  These are exactly the reasons we are adding an on-device streaming engine; this
  one stays as a fallback for devices/locales without the native model.
*/

// Assume a restart amount of once per second is an infinite loop.
const RESTART_TIME_WINDOW = 60 * 1000;
const RESTART_QUANTITY = 60;

export class ExpoASREngine extends ASREmitter implements ASREngine {
  private running = false;
  private startedAt = 0;
  private previousRestarts: number[] = [];
  private accumulatedFinalTranscript = "";
  private listenersBound = false;

  static availability(): ASRAvailability {
    return { available: true };
  }

  private bindListeners(): void {
    if (this.listenersBound) return;
    this.listenersBound = true;

    ExpoSpeechRecognitionModule.addListener("start", () => {
      this.emitStart();
    });

    ExpoSpeechRecognitionModule.addListener(
      "result",
      (event: ExpoSpeechRecognitionResultEvent) => {
        let finalTranscript = "";
        let interimTranscript = "";

        if (event.results && event.results.length > 0) {
          const result = event.results[0];
          if (event.isFinal) {
            finalTranscript = result.transcript;
            this.accumulatedFinalTranscript +=
              (this.accumulatedFinalTranscript ? " " : "") + finalTranscript;
          } else {
            interimTranscript = result.transcript;
          }
        }

        this.emitResult(finalTranscript, interimTranscript);
      }
    );

    ExpoSpeechRecognitionModule.addListener(
      "error",
      (event: ExpoSpeechRecognitionErrorEvent) => {
        switch (event.error) {
          case "network":
            // Network dropouts are usually not an issue!
            break;
          case "audio-capture":
            this.stop();
            Alert.alert(
              "Error",
              "No microphone found. Check your microphone settings and try again."
            );
            break;
          case "not-allowed":
          case "service-not-allowed":
            this.stop();
            Alert.alert(
              "Permission Denied",
              "Permission to use microphone has been denied. Check your microphone settings and try again."
            );
            break;
        }

        this.emitError({ code: event.error, message: event.message });
      }
    );

    ExpoSpeechRecognitionModule.addListener("end", () => {
      /*
        Speech recognition automatically stops after a while.
        Add restarts if the recognition stops.
      */
      if (this.running) {
        const now = Date.now();
        this.previousRestarts.push(now);
        this.previousRestarts = this.previousRestarts.filter(
          (restart) => restart > now - RESTART_TIME_WINDOW
        );
        const timeSinceStart = now - this.startedAt;

        if (this.previousRestarts.length > RESTART_QUANTITY) {
          Alert.alert(
            "Error",
            "Speech recognition is repeatedly stopping. Please try restarting the app."
          );
          this.emitEnd();
        } else if (timeSinceStart < 1000) {
          setTimeout(() => this.startRecognition(), 1000 - timeSinceStart);
        } else {
          this.startRecognition();
        }
      } else {
        this.emitEnd();
      }
    });
  }

  private startRecognition(): void {
    try {
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        // On Android, continuous mode is only supported on Android 13+.
        // For older versions, it will fall back to single recognition.
      });
    } catch (error) {
      console.error("Failed to start speech recognition:", error);
    }
  }

  // Warm-up for this engine is just permissions + listener binding; the Android
  // speech service has no separate model to preload.
  async prepare(): Promise<void> {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      Alert.alert(
        "Permission Required",
        "Microphone permission is required for speech recognition."
      );
      throw new Error("Microphone permission not granted");
    }
    this.bindListeners();
  }

  async start(): Promise<void> {
    await this.prepare();

    this.running = true;
    this.startedAt = Date.now();
    this.previousRestarts = [];
    this.accumulatedFinalTranscript = "";

    this.startRecognition();
  }

  stop(): void {
    // Set running false before stop() so the "end" listener doesn't restart us.
    this.running = false;
    this.previousRestarts = [];
    this.accumulatedFinalTranscript = "";

    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (error) {
      console.error("Failed to stop speech recognition:", error);
    }
  }
}
