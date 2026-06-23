/** One path per line; also splits accidental `C:\a C:\b` on one line. */
export function parseStompPathLines(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/\s+(?=[A-Za-z]:[\\/])/)
    for (const part of parts) {
      const t = part.trim()
      if (t) out.push(t)
    }
  }
  return out
}
