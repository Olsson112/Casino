'use strict';
/* Minimal WebSocket-server (RFC 6455) utan beroenden. */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MSG = 64 * 1024;

function frame(op, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

function upgrade(req, socket, onConnection) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30000);

  const ws = new EventEmitter();
  let open = true;
  let buf = Buffer.alloc(0);
  let fragments = [];

  ws.send = (str) => { if (open && !socket.destroyed) socket.write(frame(1, Buffer.from(str))); };
  ws.close = () => {
    if (!open) return;
    open = false;
    try { socket.end(frame(8, Buffer.alloc(0))); } catch (e) { /* ignorera */ }
    setTimeout(() => socket.destroy(), 1000);
    ws.emit('close');
  };
  ws.ping = () => { if (open && !socket.destroyed) socket.write(frame(9, Buffer.alloc(0))); };

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_MSG) { ws.close(); return; }
      const maskLen = masked ? 4 : 0;
      if (buf.length < off + maskLen + len) return;
      const mask = masked ? buf.subarray(off, off + 4) : null;
      off += maskLen;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(off + len);

      if (op === 8) { ws.close(); return; }
      if (op === 9) { socket.write(frame(10, payload)); continue; }
      if (op === 10) { ws.emit('pong'); continue; }
      if (op === 1 || op === 2 || op === 0) {
        fragments.push(payload);
        if (fin) {
          const msg = Buffer.concat(fragments).toString('utf8');
          fragments = [];
          ws.emit('message', msg);
        }
      }
    }
  });
  const done = () => { if (open) { open = false; ws.emit('close'); } };
  socket.on('close', done);
  socket.on('error', done);
  socket.on('end', done);
  onConnection(ws, req);
}

module.exports = { upgrade };
