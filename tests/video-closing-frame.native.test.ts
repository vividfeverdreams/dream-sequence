import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractVideoClosingFrameJpeg, readVideoMetadata } from "@/lib/video-closing-frame";

describe("real MP4 story handoff", () => {
  it("decodes delayed H.264 frames and hands off the bright final frame, at its actual dimensions", async () => {
    const { Decoder, Demuxer, Encoder, Muxer, Scaler } = await import("node-av/api");
    const { Frame, Rational } = await import("node-av/lib");
    const { AV_PIX_FMT_YUV420P, FF_ENCODER_LIBX264 } = await import("node-av/constants");
    const directory = await mkdtemp(join(tmpdir(), "dream-frame-test-"));
    const file = join(directory, "story.mp4");
    try {
      const encoder = await Encoder.create(FF_ENCODER_LIBX264, {
        context: { maxBFrames: 2, timeBase: new Rational(1, 4) },
        options: { preset: "fast", crf: 18 }
      });
      const output = await Muxer.open(file);
      try {
        const stream = output.addStream(encoder);
        async function* frames() {
          for (let index = 0; index < 8; index += 1) {
            const pixels = Buffer.alloc(64 * 64 * 3 / 2, 128);
            pixels.fill(index === 7 ? 230 : 24, 0, 64 * 64);
            const frame = Frame.fromVideoBuffer(pixels, {
              width: 64, height: 64, format: AV_PIX_FMT_YUV420P,
              timeBase: { num: 1, den: 4 }, pts: BigInt(index)
            });
            try { yield frame; } finally { frame.free(); }
          }
          yield null;
        }
        for await (const packet of encoder.packets(frames())) {
          if (!packet) continue;
          try { await output.writePacket(packet, stream); } finally { packet.free(); }
        }
      } finally {
        await output.close();
        encoder.close();
      }
      const video = await readFile(file);
      expect(await readVideoMetadata(video)).toEqual({ width: 64, height: 64, durationSeconds: 2 });
      const jpeg = await extractVideoClosingFrameJpeg(video);
      const image = await Demuxer.open(jpeg);
      try {
        const stream = image.video()!;
        const decoder = await Decoder.create(stream);
        const scaler = new Scaler();
        try {
          let luminance = 0;
          for await (const frame of decoder.frames(image.packets(stream.index))) {
            if (!frame) continue;
            try {
              const pixels = await scaler.toBuffer(frame, { format: "gray" });
              luminance = pixels.reduce((sum, pixel) => sum + pixel, 0) / pixels.length;
            } finally { frame.free(); }
          }
          expect(luminance).toBeGreaterThan(200);
        } finally {
          scaler[Symbol.dispose]();
          decoder.close();
        }
      } finally { await image.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
