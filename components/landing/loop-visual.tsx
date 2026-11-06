"use client";

import { useEffect, useRef } from "react";

type LoopVisualProps = {
  name: string;
  alt: string;
  className?: string;
  eager?: boolean;
};

// Plays only while on screen, and stays on the poster frame for people who ask for reduced motion.
export function LoopVisual({ name, alt, className, eager = false }: LoopVisualProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !reducedMotion.matches) {
          void video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={videoRef}
      className={className}
      poster={`/landing/${name}.jpg`}
      preload={eager ? "auto" : "none"}
      muted
      loop
      playsInline
      role="img"
      aria-label={alt}
    >
      <source src={`/landing/${name}.mp4`} type="video/mp4" />
    </video>
  );
}
