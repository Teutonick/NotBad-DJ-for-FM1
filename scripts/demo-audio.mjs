import { mkdirSync, writeFileSync } from "node:fs";
import { clickTrack, encodeWav } from "../tests/helpers/wav.js";

const folder = new URL("../public/demo/", import.meta.url);
mkdirSync(folder, { recursive: true });
for (const [title, bpm] of [
  ["Beacon", 124],
  ["Afterglow", 128],
]) {
  writeFileSync(
    new URL(`${title}-${bpm}.wav`, folder),
    encodeWav(clickTrack({ bpm, seconds: 20 })),
  );
}
