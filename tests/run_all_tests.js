const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

async function main() {
  console.log('====================================================');
  console.log('  VLIVE COMPLETE AUTOMATED TEST SUITE');
  console.log('====================================================');

  // 1. Run MIDI unit tests
  console.log('\n[1/4] Running test_midi.exe...');
  await runProc(path.join(rootDir, 'build/Release/test_midi.exe'));

  // 2. Run Sync unit tests
  console.log('\n[2/4] Running test_sync.exe...');
  await runProc(path.join(rootDir, 'build/Release/test_sync.exe'));

  // 3. Run In-Process Virtual MIDI driver & Windows subsystem loopback test
  console.log('\n[3/4] Running test_e2e_virtual_midi.exe...');
  await runProc(path.join(rootDir, 'build/Release/test_e2e_virtual_midi.exe'));

  // 4. Launch VLive Core & Run WebSocket / HTTP Client E2E test
  console.log('\n[4/4] Running Full Network E2E Integration Suite...');
  const core = spawn(path.join(rootDir, 'build/Release/vlive_core.exe'), ['--port', '8095'], {
    cwd: rootDir,
    stdio: ['ignore', 'ignore', 'inherit']
  });
  await sleep(2500);

  let e2eSuccess = false;
  try {
    const env = Object.assign({}, process.env, { VLIVE_PORT: '8095' });
    await runProc(process.execPath, [path.join(rootDir, 'tests/test_client_e2e.js')], { env });
    e2eSuccess = true;
  } catch (err) {
    console.error('E2E test failed:', err);
  } finally {
    console.log('\nTerminating test background core process...');
    core.kill();
    await sleep(500);
  }

  // 5. Run Multi-Page, 12-col Grid, & DAW Automapping unit tests
  console.log('\n[5/5] Running Multi-Page & Grid Unit Tests...');
  await runProc(process.execPath, [path.join(rootDir, 'tests/test_multipage_grid.js')]);

  if (!e2eSuccess) {
    console.error('\n❌ TEST SUITE FAILED!');
    process.exit(1);
  } else {
    console.log('\n====================================================');
    console.log('  ✅ ALL 5 TEST SUITES COMPLETED AND PASSED (100%)');
    console.log('====================================================');
    process.exit(0);
  }
}

function runProc(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, Object.assign({ stdio: 'inherit' }, options));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Process ${cmd} exited with code ${code}`));
    });
    p.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
