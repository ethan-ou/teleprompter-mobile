import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from "expo-speech-recognition";
import { Alert } from "react-native";

type SubscriberFunction = (finalTranscript: string, interimTranscript: string) => void;
type ErrorSubscriberFunction = (error: ExpoSpeechRecognitionErrorEvent) => void;
type EmptySubscriberFunction = () => void;

// Assume a restart amount of once per second is an infinite loop.
const RESTART_TIME_WINDOW = 60 * 1000;
const RESTART_QUANTITY = 60;

export default class SpeechRecognizer {
  private startSubscribers: EmptySubscriberFunction[] = [];
  private subscribers: SubscriberFunction[] = [];
  private errorSubscribers: ErrorSubscriberFunction[] = [];
  private endSubscribers: EmptySubscriberFunction[] = [];

  private running: boolean = false;
  private startedAt: number = new Date().getTime();
  private previousRestarts: number[] = [];

  // Store accumulated final transcript for continuous mode
  private accumulatedFinalTranscript: string = "";

  constructor() {
    this.setupListeners();
  }

  private setupListeners(): void {
    ExpoSpeechRecognitionModule.addListener("start", () => {
      for (let subscriber of this.startSubscribers) {
        subscriber();
      }
    });

    ExpoSpeechRecognitionModule.addListener("result", (event: ExpoSpeechRecognitionResultEvent) => {
      let finalTranscript = "";
      let interimTranscript = "";

      // Process results from the event
      if (event.results && event.results.length > 0) {
        const result = event.results[0];

        if (event.isFinal) {
          finalTranscript = result.transcript;
          // In continuous mode, accumulate final transcripts
          this.accumulatedFinalTranscript +=
            (this.accumulatedFinalTranscript ? " " : "") + finalTranscript;
        } else {
          interimTranscript = result.transcript;
        }
      }

      for (let subscriber of this.subscribers) {
        subscriber(finalTranscript, interimTranscript);
      }
    });

    ExpoSpeechRecognitionModule.addListener("error", (event: ExpoSpeechRecognitionErrorEvent) => {
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

      for (let subscriber of this.errorSubscribers) {
        subscriber(event);
      }
    });

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

        // If multiple speech recognition sessions are being used,
        // the service may go into an infinite loop.
        if (this.previousRestarts.length > RESTART_QUANTITY) {
          Alert.alert(
            "Error",
            "Speech recognition is repeatedly stopping. Please try restarting the app."
          );
          for (let subscriber of this.endSubscribers) {
            subscriber();
          }
        } else {
          if (timeSinceStart < 1000) {
            setTimeout(() => {
              this.startRecognition();
            }, 1000 - timeSinceStart);
          } else {
            this.startRecognition();
          }
        }
      } else {
        for (let subscriber of this.endSubscribers) {
          subscriber();
        }
      }
    });
  }

  private async startRecognition(): Promise<void> {
    try {
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        // On Android, continuous mode is only supported on Android 13+
        // For older versions, it will fall back to single recognition
      });
    } catch (error) {
      console.error("Failed to start speech recognition:", error);
    }
  }

  async start(): Promise<void> {
    // Request permissions first
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      Alert.alert(
        "Permission Required",
        "Microphone permission is required for speech recognition."
      );
      return;
    }

    this.running = true;
    this.startedAt = new Date().getTime();
    this.previousRestarts = [];
    this.accumulatedFinalTranscript = "";

    await this.startRecognition();
  }

  stop(): void {
    // Make sure running is set to false before calling stop.
    // Otherwise, the recognizer will continue restarting.
    this.running = false;
    this.previousRestarts = [];
    this.accumulatedFinalTranscript = "";

    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (error) {
      console.error("Failed to stop speech recognition:", error);
    }
  }

  onstart(subscriber: EmptySubscriberFunction): void {
    this.startSubscribers.push(subscriber);
  }

  onresult(subscriber: SubscriberFunction): void {
    this.subscribers.push(subscriber);
  }

  onerror(subscriber: ErrorSubscriberFunction): void {
    this.errorSubscribers.push(subscriber);
  }

  onend(subscriber: EmptySubscriberFunction): void {
    this.endSubscribers.push(subscriber);
  }

  // Cleanup method to remove all listeners
  cleanup(): void {
    this.startSubscribers = [];
    this.subscribers = [];
    this.errorSubscribers = [];
    this.endSubscribers = [];
  }
}
