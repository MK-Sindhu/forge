"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MediaItem {
  id: string;
  type: "thumbnail" | "image" | "video";
  url: string;
  sizeBytes: number;
  position: number;
}

interface MediaCarouselProps {
  media: MediaItem[];
  /** Used for the aria-label on the carousel region. */
  worldTitle: string;
}

// ---------------------------------------------------------------------------
// Internal: VideoSlide
// ---------------------------------------------------------------------------

interface VideoSlideProps {
  item: MediaItem;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
}

function VideoSlide({ item, videoRef }: VideoSlideProps) {
  const [hasPlayed, setHasPlayed] = useState(false);

  return (
    <>
      <video
        ref={videoRef}
        src={item.url}
        controls={hasPlayed}
        playsInline
        preload="metadata"
        className="h-full w-full object-contain"
        onPlay={() => setHasPlayed(true)}
      />
      {!hasPlayed && (
        <button
          type="button"
          onClick={() => videoRef.current?.play()}
          aria-label="Play video"
          className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main: MediaCarousel
// ---------------------------------------------------------------------------

export default function MediaCarousel({ media, worldTitle }: MediaCarouselProps) {
  const [current, setCurrent] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Pause any playing video when the user navigates to a different slide.
  useEffect(() => {
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
  }, [current]);

  const goTo = (i: number) => {
    const next = Math.max(0, Math.min(media.length - 1, i));
    setCurrent(next);
  };

  // Swipe support — no library needed: track touchstart X, compare on touchend.
  const touchStartX = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -50) goTo(current + 1);
    else if (dx > 50) goTo(current - 1);
    touchStartX.current = null;
  };

  // Keyboard: left/right arrows navigate slides when the region is focused.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(current - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(current + 1);
    }
  };

  const item = media[current];

  return (
    <div
      role="region"
      aria-label={`Media gallery for ${worldTitle}`}
      tabIndex={0}
      className="relative w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
      onKeyDown={onKeyDown}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Slide area — aspect-video enforces 16:9; relative is required for next/image fill */}
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900">
        {item.type === "video" ? (
          <VideoSlide key={item.id} item={item} videoRef={videoRef} />
        ) : (
          <Image
            key={item.id}
            src={item.url}
            alt={`${worldTitle} - slide ${current + 1} of ${media.length}`}
            fill
            sizes="(max-width: 768px) 100vw, 80vw"
            className="object-contain"
          />
        )}

        {/* Previous arrow */}
        <button
          type="button"
          onClick={() => goTo(current - 1)}
          disabled={current === 0}
          aria-label="Previous slide"
          className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white opacity-70 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Next arrow */}
        <button
          type="button"
          onClick={() => goTo(current + 1)}
          disabled={current === media.length - 1}
          aria-label="Next slide"
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white opacity-70 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Indicator dots */}
      <div
        role="tablist"
        aria-label="Slide indicators"
        className="mt-3 flex justify-center gap-2"
      >
        {media.map((m, i) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={i === current}
            aria-label={`Go to slide ${i + 1} of ${media.length}`}
            aria-current={i === current ? "true" : undefined}
            onClick={() => goTo(i)}
            className={`h-2 w-2 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 ${
              i === current
                ? "bg-neutral-900 dark:bg-neutral-100"
                : "bg-neutral-300 hover:bg-neutral-500 dark:bg-neutral-700 dark:hover:bg-neutral-500"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
