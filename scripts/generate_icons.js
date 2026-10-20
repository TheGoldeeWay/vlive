/**
 * Generates multi-resolution icon.ico and PNG icons for VLive Studio (Made by Goldee)
 * using the authentic source logo at "my assets/Vliveicon.png".
 */
const { spawnSync } = require('child_process');
const path = require('path');

const psScript = path.join(__dirname, 'generate_compliant_icons.ps1');
console.log('[ICON] Generating compliant multi-resolution icons from "my assets/Vliveicon.png"...');

const res = spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', psScript], {
  stdio: 'inherit'
});

if (res.status === 0) {
  console.log('[ICON] All application icons successfully generated.');
  process.exit(0);
} else {
  console.error('[ICON] Error generating icons:', res.status);
  process.exit(res.status || 1);
}
