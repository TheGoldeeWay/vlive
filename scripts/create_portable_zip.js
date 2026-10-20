const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('============================================================');
console.log('  VLive — Creating Portable Release Package');
console.log('  Made by Goldee');
console.log('============================================================');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const stageDir = path.join(distDir, 'VLive_Portable');
const zipFile = path.join(distDir, 'VLive_v2.0_Portable.zip');

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });
if (fs.existsSync(zipFile)) fs.unlinkSync(zipFile);

fs.mkdirSync(stageDir, { recursive: true });
fs.mkdirSync(path.join(stageDir, 'web'), { recursive: true });
fs.mkdirSync(path.join(stageDir, 'drivers'), { recursive: true });
fs.mkdirSync(path.join(stageDir, 'resources'), { recursive: true });

console.log('Copying binary and assets...');
const releaseExe = path.join(rootDir, 'build', 'Release', 'VLive.exe');
if (fs.existsSync(releaseExe)) {
  fs.copyFileSync(releaseExe, path.join(rootDir, 'VLive.exe'));
}
fs.copyFileSync(path.join(rootDir, 'VLive.exe'), path.join(stageDir, 'VLive.exe'));
fs.copyFileSync(path.join(rootDir, 'drivers', 'teVirtualMIDI64.msi'), path.join(stageDir, 'drivers', 'teVirtualMIDI64.msi'));
fs.copyFileSync(path.join(rootDir, 'resources', 'icon.ico'), path.join(stageDir, 'resources', 'icon.ico'));

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDirRecursive(path.join(rootDir, 'web'), path.join(stageDir, 'web'));

const readme = `VLive - Stage MIDI Controller & Studio
Version: 2.0.0
Made by Goldee
------------------------------------------------------------

QUICK START:
1. Double click VLive.exe to start the application.
2. VLive automatically registers "VLive MIDI Controller" with Windows.
3. In your DAW (Ableton Live, FL Studio, REAPER, Cubase, Studio One):
   - Open Preferences / Audio / MIDI.
   - Enable "VLive MIDI Controller" as both Track Input and Output.
4. Connect any phone, tablet, or browser on the same Wi-Fi:
   - Scan the QR code shown in the VLive window, or
   - Open http://[YOUR-PC-IP]:8088 on any mobile device.
   - Tap "Install App" on Android to add VLive to your home screen!

AUTOMATIC DAW SYNCHRONIZATION:
Any fader, knob, or project state loaded in your DAW automatically
moves and maps the controls on your VLive interface in real time!

Requirements: Windows 10/11 x64.
`;

fs.writeFileSync(path.join(stageDir, 'README.txt'), readme, 'utf8');

console.log('Compressing portable distribution package...');
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipFile}' -Force"`, { stdio: 'inherit' });

fs.rmSync(stageDir, { recursive: true, force: true });

if (fs.existsSync(zipFile)) {
  const sizeMB = (fs.statSync(zipFile).size / (1024 * 1024)).toFixed(2);
  console.log(`[SUCCESS] Portable ZIP package created: ${zipFile} (${sizeMB} MB)`);
} else {
  console.error('[ERROR] Failed to create portable package!');
  process.exit(1);
}
