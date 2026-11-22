import { calculateTrackDetails } from "./calculateTrackDetails";

export function analyzeTrackDetails(audioBuffer) {
  if (typeof Worker === "undefined")
    return Promise.resolve(calculateTrackDetails(audioBuffer));
  const channels = Array.from(
    { length: Math.min(2, audioBuffer.numberOfChannels) },
    (_, index) => audioBuffer.getChannelData(index).slice(),
  );
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./trackDetails.worker.js", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = ({ data }) => {
      worker.terminate();
      resolve(data);
    };
    worker.onerror = (error) => {
      worker.terminate();
      reject(new Error(error.message));
    };
    worker.postMessage(
      {
        channels,
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
      },
      channels.map((channel) => channel.buffer),
    );
  });
}
