"use strict";

// The MP4 the Android 12 DMP signage players play: measured from a file that plays on the real player
// (25 Nov 2026). An earlier export in H.264 High, 30 fps, with a silent AAC track did not play, so every value here
// is required, not a preference. README.md → "Download MP4" holds the same table, and
// test/video-format.test.js checks a real file against it with ffprobe.

const FPS = 25;
const GOP = 50; // a keyframe exactly every 2 s
const SIZES = { portrait: { w: 1080, h: 1920 }, landscape: { w: 1920, h: 1080 } };
// Longest loop the export renders (3,000 frames): one render at a time, so this bounds how long the next person
// waits, and keeps a render well inside the tighter worker limit, AWS Lambda's 15 minutes (README.md → "Download
// MP4"). Every default promotion is 7 to 12 seconds.
const MAX_SECONDS = 120;

const sizeOf = (orientation) => SIZES[orientation === "landscape" ? "landscape" : "portrait"];

/**
 * ffmpeg's arguments: JPEG frames on stdin at 25 fps in, the signage MP4 out (to `out`, a path or "pipe:1" is not
 * allowed: faststart needs a seekable file).
 */
function ffmpegArgs(orientation, out) {
  const { w, h } = sizeOf(orientation);
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0",
    "-an",
    "-vf", `scale=${w}:${h}:out_color_matrix=bt709:out_range=tv,fps=${FPS},format=yuv420p,setsar=1`,
    "-c:v", "libx264", "-preset", "slow", "-profile:v", "main", "-level:v", "4.0", "-crf", "18",
    "-maxrate", "6M", "-bufsize", "12M",
    "-g", String(GOP), "-keyint_min", String(GOP), "-sc_threshold", "0", "-bf", "3",
    "-colorspace", "bt709", "-color_range", "tv",
    "-bsf:v", "filter_units=remove_types=6",
    "-fps_mode", "cfr", "-video_track_timescale", "12800",
    // -fflags +bitexact: without it ffmpeg still writes an "encoder" tag; the format asks for no metadata at all.
    "-map_metadata", "-1", "-fflags", "+bitexact", "-movflags", "+faststart", "-brand", "mp42",
    "-f", "mp4", out,
  ];
}

/** Frames in one loop of `seconds`: whole frames at 25 fps (a loop is never cut short by rounding). */
const frameCount = (seconds) => Math.max(1, Math.round(seconds * FPS));

const slug = (v) => String(v || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");

/** `<pharmacy-name>-<promotion>-<portrait|landscape>-<seconds>s_android.mp4`, lower case and hyphenated. */
function videoFileName({ pharmacy, promotion, orientation, seconds }) {
  const secs = Math.round(Number(seconds) || 0);
  return [slug(pharmacy) || "pharmacy", slug(promotion) || "promotion", orientation === "landscape" ? "landscape" : "portrait", `${secs}s_android.mp4`].join("-");
}

module.exports = { FPS, GOP, SIZES, MAX_SECONDS, sizeOf, ffmpegArgs, frameCount, videoFileName, slug };
