import type { Frame } from "node-av/lib";

export async function readVideoMetadata(video: Buffer) {
  const { Demuxer } = await import("node-av/api");
  const input = await Demuxer.open(video);
  try {
    const stream = input.video();
    const width = stream?.codecpar.width;
    const height = stream?.codecpar.height;
    const duration = input.duration;
    if (!width || !height || !Number.isFinite(duration) || duration <= 0) {
      throw new Error("The completed clip has invalid video dimensions or duration.");
    }
    return { width, height, durationSeconds: Math.round(duration) };
  } finally {
    await input.close();
  }
}

/**
 * Decode the complete short render so B-frames are flushed, retain only the
 * final decoded frame, and encode that frame as a provider-ready JPEG.
 */
export async function extractVideoClosingFrameJpeg(video: Buffer) {
  if (video.length === 0) {
    throw new Error("Cannot extract a closing frame from an empty video.");
  }

  // Keep the native dependency out of client bundles and paths that never
  // persist completed renders.
  const { Decoder, Demuxer, Scaler } = await import("node-av/api");
  const input = await Demuxer.open(video);

  try {
    const videoStream = input.video();

    if (!videoStream) {
      throw new Error("The completed render does not contain a video stream.");
    }

    const decoder = await Decoder.create(videoStream);

    try {
      const scaler = new Scaler();

      try {
        let closingFrame: Frame | null = null;

        try {
          for await (const frame of decoder.frames(
            input.packets(videoStream.index)
          )) {
            if (!frame) {
              continue;
            }

            try {
              const retainedFrame = frame.clone();

              if (!retainedFrame) {
                throw new Error("Could not retain a decoded closing frame.");
              }

              closingFrame?.free();
              closingFrame = retainedFrame;
            } finally {
              frame.free();
            }
          }

          if (!closingFrame) {
            throw new Error("The completed render did not decode any video frames.");
          }

          return await scaler.toJpeg(closingFrame, {
            quality: 90
          });
        } finally {
          closingFrame?.free();
        }
      } finally {
        scaler[Symbol.dispose]();
      }
    } finally {
      decoder.close();
    }
  } finally {
    await input.close();
  }
}
