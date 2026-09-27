import type { Duplex } from 'node:stream';
import { decode, json, MAX_MESSAGE_BYTES, RuntimeError, type Wire } from './wire';

/** Length-prefixed UTF-8 JSON. No resynchronization after a malformed frame. */
export class Transport {
  private buffer = Buffer.alloc(0);
  private stopped = false;
  private readonly data = (chunk: Buffer) => {
    try {
      if (!Buffer.isBuffer(chunk)) throw new RuntimeError('INVALID', 'Expected binary stream');
      if (this.buffer.length + chunk.length > 256 * 1024) throw new RuntimeError('LIMIT', 'Incoming buffer full');
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (!this.stopped && this.buffer.length >= 4) {
        const length = this.buffer.readUInt32BE(0);
        if (!length || length > MAX_MESSAGE_BYTES) throw new RuntimeError('INVALID', 'Invalid frame length');
        if (this.buffer.length < length + 4) break;
        const body = this.buffer.subarray(4, length + 4);
        this.buffer = this.buffer.subarray(length + 4);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
        this.onMessage(decode(JSON.parse(text), this.direction));
      }
    } catch { this.close(); }
  };
  constructor(readonly stream: Duplex, private readonly direction: 'client' | 'host',
    private readonly onMessage: (message: Wire) => void, private readonly onClose: () => void) {
    stream.on('data', this.data);
    stream.on('error', this.ended);
    stream.on('close', this.ended);
    stream.on('end', this.ended);
  }
  private readonly ended = () => this.close();
  send(message: Wire): void {
    if (this.stopped || this.stream.destroyed) throw new RuntimeError('DISCONNECTED', 'Runtime disconnected');
    const bytes = Buffer.from(JSON.stringify(json(message)));
    if (!bytes.length || bytes.length > MAX_MESSAGE_BYTES) throw new RuntimeError('LIMIT', 'Message exceeds 64 KiB');
    if (this.stream.writableLength + bytes.length + 4 > 256 * 1024)
      throw new RuntimeError('LIMIT', 'Outgoing buffer full');
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(bytes.length);
    this.stream.write(Buffer.concat([header, bytes]));
  }
  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.buffer = Buffer.alloc(0);
    this.stream.off('data', this.data);
    this.stream.destroy();
    this.onClose();
  }
}
