import fs from 'node:fs';

const CHUNK_BYTES = 64 * 1024;
const NEWLINE = 0x0a;

function* splitChunk(chunk: Buffer, fragments: Buffer[]): IterableIterator<string> {
  let start = 0;
  for (let end = chunk.indexOf(NEWLINE); end !== -1; end = chunk.indexOf(NEWLINE, start)) {
    if (fragments.length === 0) {
      yield chunk.toString('utf8', start, end);
    } else {
      fragments.push(chunk.subarray(start, end));
      const line = Buffer.concat(fragments).toString('utf8');
      fragments.length = 0;
      yield line;
    }
    start = end + 1;
  }
  // The synchronous reader reuses its input buffer, so copy any unfinished line.
  if (start < chunk.length) fragments.push(Buffer.from(chunk.subarray(start)));
}

export async function* readJsonlLines(file: string): AsyncIterableIterator<string> {
  const fragments: Buffer[] = [];
  for await (const chunk of fs.createReadStream(file, { highWaterMark: CHUNK_BYTES })) {
    yield* splitChunk(chunk, fragments);
  }
  if (fragments.length > 0) yield Buffer.concat(fragments).toString('utf8');
}

export function* readJsonlLinesSync(file: string): IterableIterator<string> {
  const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
  const fragments: Buffer[] = [];
  const fd = fs.openSync(file, 'r');
  try {
    let bytes = fs.readSync(fd, chunk);
    while (bytes > 0) {
      yield* splitChunk(chunk.subarray(0, bytes), fragments);
      bytes = fs.readSync(fd, chunk);
    }
    if (fragments.length > 0) yield Buffer.concat(fragments).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}
