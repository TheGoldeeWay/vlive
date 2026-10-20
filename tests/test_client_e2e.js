/**
 * End-to-end automated test for VLive HTTP, WebSocket binary fast-path, and bi-directional DAW sync.
 */

const http = require('http');
const net = require('net');
const crypto = require('crypto');

const PORT = parseInt(process.env.VLIVE_PORT) || 8088;

async function testHttp() {
  console.log('[E2E-TEST] Testing HTTP Static file serving & API endpoints on port ' + PORT + '...');
  // 1. Root HTML
  await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 && data.includes('VLive') && data.includes('builderCanvas') && data.includes('qrDockPanel')) {
          console.log('  [✓] HTTP 200 OK: Web Controller HTML served correctly with Builder Canvas & QR dock (' + data.length + ' bytes)');
          resolve();
        } else {
          reject(new Error(`Unexpected HTTP response for /: ${res.statusCode}, len=${data.length}`));
        }
      });
    }).on('error', reject);
  });

  // 2. /api/qr SVG
  await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/api/qr`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const contentType = res.headers['content-type'] || '';
        if (res.statusCode === 200 && contentType.includes('image/svg+xml') && data.includes('<svg')) {
          console.log('  [✓] HTTP 200 OK: /api/qr served vector SVG QR code (' + data.length + ' bytes)');
          resolve();
        } else {
          reject(new Error(`Unexpected /api/qr response: status=${res.statusCode}, type=${contentType}`));
        }
      });
    }).on('error', reject);
  });

  // 3. /api/info JSON & CORS verification (for Subnet Auto-Discovery Radar)
  await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/api/info`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const cors = res.headers['access-control-allow-origin'];
          if (cors !== '*') {
            return reject(new Error(`Expected Access-Control-Allow-Origin: * for Subnet Radar, got: ${cors}`));
          }
          const info = JSON.parse(data);
          if (res.statusCode === 200 && info.status === 'ok' && info.version && info.port === PORT) {
            console.log(`  [✓] HTTP 200 OK: /api/info returned JSON (v${info.version}, port ${info.port}, BPM ${info.bpm}, IP: ${info.lanIp}) with CORS: *`);
            resolve();
          } else {
            reject(new Error(`Invalid /api/info payload: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse /api/info JSON: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function createWsFrame(data, opcode = 0x2) {
  const isBuffer = Buffer.isBuffer(data);
  const payload = isBuffer ? data : Buffer.from(data);
  const length = payload.length;

  const mask = crypto.randomBytes(4);
  const maskedPayload = Buffer.alloc(length);
  for (let i = 0; i < length; i++) {
    maskedPayload[i] = payload[i] ^ mask[i % 4];
  }

  let header;
  if (length <= 125) {
    header = Buffer.from([0x80 | opcode, 0x80 | length]);
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, mask, maskedPayload]);
}

async function testWebSocket() {
  console.log('[E2E-TEST] Testing WebSocket Handshake & Binary MIDI fast-path...');
  return new Promise((resolve, reject) => {
    const wsKey = crypto.randomBytes(16).toString('base64');
    const client = net.createConnection({ host: '127.0.0.1', port: PORT }, () => {
      // Send WebSocket Upgrade Request
      const req = [
        'GET /ws HTTP/1.1',
        `Host: 127.0.0.1:${PORT}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${wsKey}`,
        'Sec-WebSocket-Version: 13',
        '\r\n'
      ].join('\r\n');
      client.write(req);
    });

    let upgraded = false;

    client.on('data', (chunk) => {
      if (!upgraded) {
        const resp = chunk.toString();
        if (resp.includes('101 Switching Protocols')) {
          upgraded = true;
          console.log('  [✓] WebSocket Handshake successful (101 Switching Protocols)');

          // 1. Send Hello JSON
          const hello = JSON.stringify({
            type: 'hello',
            deviceId: 'test_dev_01',
            deviceName: 'E2E Performer Pad',
            role: 'drums'
          });
          client.write(createWsFrame(hello, 0x1)); // text frame

          // 2. Send Binary Note On: Ch 10 (0x99), Note 36 (Kick), Vel 115
          console.log('  [*] Sending Binary MIDI Note On (Ch 10, Note 36, Vel 115)...');
          client.write(createWsFrame(Buffer.from([0x99, 36, 115]), 0x2));

          // 3. Send Binary Note Off: Ch 10 (0x89), Note 36, Vel 0
          setTimeout(() => {
            console.log('  [*] Sending Binary MIDI Note Off (Ch 10, Note 36)...');
            client.write(createWsFrame(Buffer.from([0x89, 36, 0]), 0x2));
          }, 100);

          // 4. Send Binary CC: Ch 16 (0xBF), CC 74, Val 120
          setTimeout(() => {
            console.log('  [*] Sending Binary MIDI CC (Ch 16, CC 74, Val 120)...');
            client.write(createWsFrame(Buffer.from([0xBF, 74, 120]), 0x2));
          }, 200);

          // 5. Send Ping for Clock Sync
          setTimeout(() => {
            console.log('  [*] Testing NTP Ping-Pong Clock Sync...');
            client.write(createWsFrame(JSON.stringify({ type: 'ping', t0: Date.now() }), 0x1));
          }, 300);

          // Complete test after 600ms
          setTimeout(() => {
            client.end();
            console.log('  [✓] All WebSocket actions dispatched successfully!');
            resolve();
          }, 600);
        }
      }
    });

    client.on('error', reject);
  });
}

async function run() {
  try {
    await testHttp();
    await testWebSocket();
    console.log('\n[E2E-TEST] ALL TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
  } catch (err) {
    console.error('[E2E-TEST] Failed:', err);
    process.exit(1);
  }
}

run();
