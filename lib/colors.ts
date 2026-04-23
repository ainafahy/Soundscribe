export type RGB = readonly [number, number, number];

export function hexToRgb(s: string, fallback: RGB = [0, 0, 0]): RGB {
  const trimmed = (s ?? "").replace("#", "");
  if (trimmed.length !== 6) return fallback;
  const n = parseInt(trimmed, 16);
  if (Number.isNaN(n)) return fallback;
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function rgbToHex(c: RGB): string {
  const [r, g, b] = c;
  const h = (v: number) => v.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function rgbToCss(c: RGB): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function lerpColor(a: RGB, b: RGB, t: number): RGB {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] * (1 - clamped) + b[0] * clamped),
    Math.round(a[1] * (1 - clamped) + b[1] * clamped),
    Math.round(a[2] * (1 - clamped) + b[2] * clamped),
  ] as const;
}

export function rgbEq(a: RGB, b: RGB): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
