/**
 * Node script to compile the Inno Setup Windows installer for VLive.
 * Searches for ISCC.exe in standard program directories and Antigravity IDE bundle.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const issPath = path.join(rootDir, 'installer', 'vlive_setup.iss');
const outDir = path.join(rootDir, 'dist');

console.log('============================================================');
console.log('  VLive — Compiling Windows Setup Installer');
console.log('  Made by Goldee');
console.log('============================================================');

const candidatePaths = [
  'iscc.exe',
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs\\Inno Setup 6\\ISCC.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs\\Antigravity IDE\\resources\\app\\node_modules\\innosetup\\bin\\ISCC.exe')
];

let isccExe = null;
for (const p of candidatePaths) {
  if (p === 'iscc.exe') {
    const test = spawnSync('where', ['iscc.exe'], { encoding: 'utf8' });
    if (test.status === 0 && test.stdout.trim()) {
      isccExe = test.stdout.trim().split('\n')[0].trim();
      break;
    }
  } else if (fs.existsSync(p)) {
    isccExe = p;
    break;
  }
}

if (!isccExe) {
  console.error('[ERROR] ISCC.exe compiler not found.');
  process.exit(1);
}

const releaseExe = path.join(rootDir, 'build', 'Release', 'VLive.exe');
if (fs.existsSync(releaseExe)) {
  fs.copyFileSync(releaseExe, path.join(rootDir, 'VLive.exe'));
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const args = [`/O${outDir}`, issPath];
console.log('Compiling installer...');
const result = spawnSync(isccExe, args, { stdio: 'inherit' });

if (result.status === 0) {
  console.log('\n============================================================');
  console.log(' [SUCCESS] Setup installer created in:', outDir);
  console.log('============================================================');
  process.exit(0);
} else {
  console.error('\n[ERROR] Inno Setup compilation failed with code', result.status);
  process.exit(result.status || 1);
}
