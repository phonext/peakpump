// Read a request body up to a cap and stop, rather than buffering whatever
// arrives and measuring afterwards: the point of a cap is that the bytes past
// it are never held. The same loop as the metadata route's string reader, kept
// separate because that one is local to a frozen file and returns UTF-8 text;
// an image route needs the raw bytes.

export async function boundedBytes(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const body = request.body;
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  const joined = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return joined;
}
