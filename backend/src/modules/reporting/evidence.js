// Evidence handling: type checked from file contents (not the extension), size-limited,
// image location/device metadata removed by re-encoding, original file names discarded.
// All files from one submission are bundled into one item (one transaction).
import sharp from "sharp";
import { HttpError } from "../../lib/http.js";
import { config } from "../../config.js";

const ALLOWED = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
};
export const ALLOWED_TYPES = Object.keys(ALLOWED);

/** Detects the real type from magic bytes. Returns null for anything not on the list. */
export function sniff(buf) {
  const s = (a, b) => buf.subarray(a, b).toString("latin1");
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return "image/webp";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WAVE") return "audio/wav";
  if (s(0, 5) === "%PDF-") return "application/pdf";
  if (s(0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (s(4, 8) === "ftyp" && /^(M4A |mp42|isom|M4B )/.test(s(8, 12))) return "audio/mp4";
  return null;
}

/** Re-encodes images without metadata (EXIF GPS, device, timestamps). Orientation is applied first. */
async function stripImage(buf, type) {
  const img = sharp(buf, { failOn: "error" }).rotate(); // rotate() applies EXIF orientation, then metadata is dropped
  if (type === "image/jpeg") return img.jpeg({ quality: 90 }).toBuffer();
  if (type === "image/png") return img.png().toBuffer();
  return img.webp({ quality: 90 }).toBuffer();
}

/**
 * Validates and cleans uploaded files (multer memory files).
 * Returns { bundle: Buffer(JSON), files: [{ name, mime, size, metadataStripped }] }.
 */
export async function prepareEvidence(files) {
  if (files.length > config.maxEvidenceFiles) throw new HttpError(400, `At most ${config.maxEvidenceFiles} files can be added at once.`);
  const out = [];
  for (const [i, f] of files.entries()) {
    if (f.size > config.maxEvidenceFileBytes) throw new HttpError(400, "A file is larger than the size limit.");
    const type = sniff(f.buffer);
    if (!type) throw new HttpError(400, "One of the files is not an allowed type (photos, PDF documents or audio only).");
    let data = f.buffer;
    let metadataStripped = false;
    if (type.startsWith("image/")) {
      data = await stripImage(f.buffer, type);
      metadataStripped = true;
    }
    out.push({ name: `evidence-${i + 1}.${ALLOWED[type]}`, mime: type, size: data.length, metadataStripped, data: data.toString("base64") });
  }
  const bundle = Buffer.from(JSON.stringify({ version: 1, files: out }));
  return { bundle, files: out.map(({ data, ...rest }) => rest) };
}
