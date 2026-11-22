import { analyzeTrackLoudness, analyzeWaveform } from "./utils";

export function calculateTrackDetails(audioBuffer) {
  return {
    ...analyzeWaveform(audioBuffer),
    loudDb: analyzeTrackLoudness(audioBuffer).loudDb,
  };
}
