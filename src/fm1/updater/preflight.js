import releases from "./releases.json";
import { checkUfw, logicalImage, productOf, sha256hex } from "./fm1pkg.js";

export const release = releases["0.1.0"];
export const flashSize = 1024 * 1024;

export async function verifyPackage(file) {
  if (!file.name.toLowerCase().endsWith(".fwsc") || file.size > 4 * flashSize) {
    return false;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (
    (await sha256hex(bytes)) !== release.sha256 ||
    productOf(bytes) !== release.product
  ) {
    return false;
  }
  checkUfw(logicalImage(bytes));
  return true;
}

export async function verifyBackup(files) {
  if (
    files.length !== 2 ||
    files[0] === files[1] ||
    files.some((file) => file.size !== flashSize)
  ) {
    return null;
  }
  const [first, second] = await Promise.all(
    files.map(async (file) => new Uint8Array(await file.arrayBuffer())),
  );
  if (
    first.length !== flashSize ||
    second.length !== flashSize ||
    first.every((byte) => byte === 0xff) ||
    first.every((byte) => byte === 0) ||
    first.some((byte, index) => byte !== second[index])
  ) {
    return null;
  }
  return sha256hex(first);
}
