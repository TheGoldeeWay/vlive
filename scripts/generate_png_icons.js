const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const webDir = path.resolve(__dirname, '../web');

function crc32(buf) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

const table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  table[i] = c;
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + len);
  return chunk;
}

function createPng(size) {
  const width = size;
  const height = size;
  const rawScanlines = Buffer.alloc(height * (1 + width * 4));

  const cx = width / 2;
  const cy = height / 2;
  const radius = width * 0.45;

  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawScanlines[offset++] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        const ringEdge = Math.abs(dist - radius);
        if (ringEdge < Math.max(2, size * 0.04)) {
          // Neon Cyan Ring
          rawScanlines[offset++] = 0;   // R
          rawScanlines[offset++] = 240; // G
          rawScanlines[offset++] = 255; // B
          rawScanlines[offset++] = 255; // A
        } else {
          // Inner V Motif
          const normX = Math.abs(dx) / (radius * 0.8);
          const normY = (cy - y) / (radius * 0.8);
          const isV = (normY < -normX * 1.4 + 0.6) && (normY > -normX * 1.4 - 0.3) && (normX < 0.85);

          if (isV) {
            rawScanlines[offset++] = 255; // R
            rawScanlines[offset++] = 255; // G
            rawScanlines[offset++] = 255; // B
            rawScanlines[offset++] = 255; // A
          } else {
            // Dark Stage Radial Background
            const t = dist / radius;
            rawScanlines[offset++] = Math.round(14 + t * 15);
            rawScanlines[offset++] = Math.round(14 + t * 10);
            rawScanlines[offset++] = Math.round(26 + t * 25);
            rawScanlines[offset++] = 255;
          }
        }
      } else {
        // Transparent outside
        rawScanlines[offset++] = 0;
        rawScanlines[offset++] = 0;
        rawScanlines[offset++] = 0;
        rawScanlines[offset++] = 0;
      }
    }
  }

  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8 bits per channel
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);

  const ihdrChunk = makeChunk('IHDR', ihdrData);
  const idatChunk = makeChunk('IDAT', zlib.deflateSync(rawScanlines));
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

fs.writeFileSync(path.join(webDir, 'icon-192.png'), createPng(192));
fs.writeFileSync(path.join(webDir, 'icon-512.png'), createPng(512));
console.log('[✓] Generated web/icon-192.png and web/icon-512.png');
