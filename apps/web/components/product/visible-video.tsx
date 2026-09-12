"use client";

import { useEffect, useRef, type VideoHTMLAttributes } from "react";

/** Keep native controls; returning to the page never resumes playback by itself. */
export function VisibleVideo(props: VideoHTMLAttributes<HTMLVideoElement>) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let visible = false;
    const pauseWhenHidden = () => {
      const fullscreen = document.fullscreenElement;
      const isFullscreen = fullscreen === video || Boolean(fullscreen?.contains(video));
      if (document.visibilityState !== "visible" || (!visible && !isFullscreen)) video.pause();
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0);
      pauseWhenHidden();
    }, { threshold: [0] });
    if (observer) observer.observe(video);
    else visible = true;
    document.addEventListener("visibilitychange", pauseWhenHidden);
    const pause = () => video.pause();
    window.addEventListener("pagehide", pause);
    video.addEventListener("play", pauseWhenHidden);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", pauseWhenHidden);
      window.removeEventListener("pagehide", pause);
      video.removeEventListener("play", pauseWhenHidden);
      video.pause();
    };
  }, [props.src]);
  return <video {...props} ref={ref} />;
}
