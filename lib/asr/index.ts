import { ExpoASREngine } from "./expo-engine";
import { SherpaASREngine } from "./sherpa-engine";
import type { ASRAvailability, ASREngine, ASREngineId } from "./types";

export type { ASREngine, ASREngineId, ASRError } from "./types";

const availabilityById: Record<ASREngineId, () => ASRAvailability> = {
  expo: ExpoASREngine.availability,
  sherpa: SherpaASREngine.availability,
};

export function getEngineAvailability(id: ASREngineId): ASRAvailability {
  return availabilityById[id]();
}

/**
 * Create an ASR engine by id, falling back to the always-available Expo engine
 * when the requested engine can't run on this device/build.
 */
export function createASREngine(id: ASREngineId = "expo"): ASREngine {
  if (id === "sherpa" && getEngineAvailability("sherpa").available) {
    return new SherpaASREngine();
  }
  return new ExpoASREngine();
}
