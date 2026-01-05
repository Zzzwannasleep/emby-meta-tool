import { zipSync, strToU8 } from "fflate";

export type ZipInput = Record<string, Uint8Array>;

export function makeZip(files: ZipInput): Uint8Array {
  return zipSync(files, { level: 6 });
}

export function textFile(s: string): Uint8Array {
  return strToU8(s, true);
}
