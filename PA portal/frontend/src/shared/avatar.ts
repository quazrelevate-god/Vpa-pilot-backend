// Deterministic avatar initials + colour from a name, so the same citizen
// always gets the same chip. Kept subtle (mid-tone gradients, white text).

const PALETTE = [
  ["#6366f1", "#4338ca"], // indigo
  ["#0ea5e9", "#0369a1"], // sky
  ["#10b981", "#047857"], // emerald
  ["#f59e0b", "#b45309"], // amber
  ["#ec4899", "#be185d"], // pink
  ["#8b5cf6", "#6d28d9"], // violet
  ["#14b8a6", "#0f766e"], // teal
  ["#f43f5e", "#be123c"], // rose
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const [from, to] = PALETTE[Math.abs(hash) % PALETTE.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}
