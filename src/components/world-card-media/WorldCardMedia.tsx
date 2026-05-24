"use client";

import { useRef, useState } from "react";
import Image from "next/image";

interface Props {
  thumbnailUrl: string | null;
  videoUrl: string | null;
  alt: string;
  /** next/image sizes attribute — should match the consumer grid breakpoints */
  sizes: string;
  /** Controls the container's aspect ratio class. Defaults to "video" (16:9). */
  aspectRatio?: "video" | "square";
  /** When provided and > 0, shows a read-only heart+count badge over the thumbnail. */
  likesCount?: number;
}

export function WorldCardMedia({
  thumbnailUrl,
  videoUrl,
  alt,
  sizes,
  aspectRatio = "video",
  likesCount,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isHovering, setIsHovering] = useState(false);

  const onEnter = () => {
    setIsHovering(true);
    // play() returns a Promise; swallow rejections — autoplay policies vary
    // across browsers and this is best-effort decorative preview.
    videoRef.current?.play().catch(() => {});
  };

  const onLeave = () => {
    setIsHovering(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0; // reset so next hover starts from 0
    }
  };

  const aspectClass = aspectRatio === "square" ? "aspect-square" : "aspect-video";

  return (
    <div
      className={`relative ${aspectClass} bg-neutral-100 dark:bg-neutral-900`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {thumbnailUrl ? (
        <Image
          src={thumbnailUrl}
          alt={alt}
          fill
          sizes={sizes}
          className={`object-cover transition-opacity duration-150 ${
            isHovering && videoUrl ? "opacity-0" : "opacity-100"
          }`}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-neutral-400 dark:text-neutral-600">
          No preview
        </div>
      )}
      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          loop
          playsInline
          preload="none"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ${
            isHovering ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden // decorative — thumbnail covers the semantics
        />
      )}
      {likesCount !== undefined && likesCount > 0 && (
        <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white backdrop-blur-sm">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 21l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18L12 21z" />
          </svg>
          <span>{likesCount}</span>
        </div>
      )}
    </div>
  );
}
