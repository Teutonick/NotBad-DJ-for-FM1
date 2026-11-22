import { calculateTrackDetails } from "./calculateTrackDetails";

self.onmessage = ({ data: { channels, duration, sampleRate } }) => {
  const details = calculateTrackDetails({
    duration,
    sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (index) => channels[index],
  });
  self.postMessage(details, [
    details.waveData.buffer,
    details.bandIndex.buffer,
    details.bandLow.buffer,
  ]);
};
