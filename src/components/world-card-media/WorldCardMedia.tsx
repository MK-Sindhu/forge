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
}

export function WorldCardMedia({
  thumbnailUrl,
  videoUrl,
  alt,
  sizes,
  aspectRatio = "video",
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
    </div>
  );
}
