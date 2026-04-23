/**
 * Procedural demo image — a misty landscape composition with generous tonal
 * range (near-white sky, mid-gray mountain layers, near-black foreground).
 * Designed to showcase what the image tool does without shipping a real
 * photograph.
 */

import { loadImageFromCanvas, type LoadedImage } from "./imageSource";

const DEMO_WIDTH = 960;
const DEMO_HEIGHT = 560;

function ridge(
  ctx: CanvasRenderingContext2D,
  baseY: number,
  amplitude: number,
  roughness: number,
  width: number,
  height: number,
  fill: string,
  seed: number,
): void {
  // Deterministic jittered polyline across the canvas, closed to the bottom.
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, height);

  // Tiny LCG so the ridge is stable across renders without importing the rng module.
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const step = 24;
  let prev = baseY;
  for (let x = 0; x <= width; x += step) {
    const noise = (rand() - 0.5) * amplitude;
    const smoothed = prev * (1 - roughness) + (baseY + noise) * roughness;
    ctx.lineTo(x, smoothed);
    prev = smoothed;
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
}

function sprinkleGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  amount: number,
): void {
  // subtle film grain so the waveform render has something to bite on in flat regions
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const delta = (Math.random() - 0.5) * amount;
    data[i] = Math.max(0, Math.min(255, data[i] + delta));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + delta));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + delta));
  }
  ctx.putImageData(imageData, 0, 0);
}

export function createDemoImage(): LoadedImage {
  const canvas = document.createElement("canvas");
  canvas.width = DEMO_WIDTH;
  canvas.height = DEMO_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  // Sky — warm paper → slightly dustier horizon
  const sky = ctx.createLinearGradient(0, 0, 0, DEMO_HEIGHT * 0.65);
  sky.addColorStop(0, "#fbf6ea");
  sky.addColorStop(0.55, "#efe8d6");
  sky.addColorStop(1, "#d8cfba");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, DEMO_WIDTH, DEMO_HEIGHT);

  // Soft sun with halo
  const sunX = DEMO_WIDTH * 0.72;
  const sunY = DEMO_HEIGHT * 0.32;
  const halo = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 140);
  halo.addColorStop(0, "rgba(255, 248, 228, 1)");
  halo.addColorStop(0.35, "rgba(255, 243, 216, 0.55)");
  halo.addColorStop(1, "rgba(255, 243, 216, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, DEMO_WIDTH, DEMO_HEIGHT);
  ctx.beginPath();
  ctx.arc(sunX, sunY, 36, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(252, 245, 228, 1)";
  ctx.fill();

  // Far ridge — pale haze
  ridge(ctx, DEMO_HEIGHT * 0.62, 32, 0.55, DEMO_WIDTH, DEMO_HEIGHT, "#a59e8a", 1);

  // Mid ridge — dustier gray
  ridge(ctx, DEMO_HEIGHT * 0.72, 52, 0.5, DEMO_WIDTH, DEMO_HEIGHT, "#5f5b4d", 7);

  // Near ridge — almost black, taller roughness
  ridge(ctx, DEMO_HEIGHT * 0.82, 68, 0.45, DEMO_WIDTH, DEMO_HEIGHT, "#1f1d17", 13);

  // A small structure — a silhouette on the near ridge
  ctx.fillStyle = "#0b0a07";
  ctx.fillRect(DEMO_WIDTH * 0.18, DEMO_HEIGHT * 0.77, 14, DEMO_HEIGHT * 0.06);
  ctx.beginPath();
  ctx.moveTo(DEMO_WIDTH * 0.18 - 4, DEMO_HEIGHT * 0.77);
  ctx.lineTo(DEMO_WIDTH * 0.18 + 7, DEMO_HEIGHT * 0.755);
  ctx.lineTo(DEMO_WIDTH * 0.18 + 18, DEMO_HEIGHT * 0.77);
  ctx.closePath();
  ctx.fill();

  // Foreground — near-black solid base with a gentle horizon curve
  ctx.fillStyle = "#07060a";
  ctx.beginPath();
  ctx.moveTo(0, DEMO_HEIGHT * 0.92);
  ctx.bezierCurveTo(
    DEMO_WIDTH * 0.35,
    DEMO_HEIGHT * 0.88,
    DEMO_WIDTH * 0.65,
    DEMO_HEIGHT * 0.96,
    DEMO_WIDTH,
    DEMO_HEIGHT * 0.9,
  );
  ctx.lineTo(DEMO_WIDTH, DEMO_HEIGHT);
  ctx.lineTo(0, DEMO_HEIGHT);
  ctx.closePath();
  ctx.fill();

  sprinkleGrain(ctx, DEMO_WIDTH, DEMO_HEIGHT, 22);

  return loadImageFromCanvas(canvas);
}
