/*
This file turns a number of seconds into "m:ss" text, like 125 -> "2:05".
Edit this file if times should be shown differently. Copy it for another small text helper.
*/

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
