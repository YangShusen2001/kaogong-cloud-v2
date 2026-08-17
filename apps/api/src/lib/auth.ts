const encoder = new TextEncoder();

export function randomToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(value).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomCode(): string {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return String((value[0] ?? 0) % 1_000_000).padStart(6, "0");
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function constantEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
