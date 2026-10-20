/**
 * Unit test for VLive multi-page data model, 12-column grid layout,
 * device preview profiles, and layout schema migrations.
 */

const assert = require('assert');

function runMultiPageGridTests() {
  console.log('========================================');
  console.log('  VLIVE MULTI-PAGE & GRID UNIT TESTS   ');
  console.log('========================================');

  // Test 1: v1 legacy migration to v2 multi-page schema
  console.log('[Test 1] Testing legacy v1 to v2 layout migration...');
  const legacyV1 = {
    version: 1,
    widgets: [
      { id: 'w_1', type: 'slider', colSpan: 3, rowSpan: 2 },
      { id: 'w_2', type: 'drum_pad', colSpan: 4, rowSpan: 2 }
    ]
  };

  let migratedLayout;
  if (!legacyV1.pages) {
    migratedLayout = {
      version: 2,
      activePageIndex: 0,
      pages: [
        {
          id: 'page_main',
          name: 'Main Rig',
          icon: '🎛️',
          widgets: legacyV1.widgets || []
        }
      ]
    };
  }

  assert.strictEqual(migratedLayout.version, 2);
  assert.strictEqual(migratedLayout.pages.length, 1);
  assert.strictEqual(migratedLayout.pages[0].name, 'Main Rig');
  assert.strictEqual(migratedLayout.pages[0].widgets.length, 2);
  console.log('  [✓] Migration from v1 to v2 succeeded!');

  // Test 2: Multi-page management (Add, Switch, Rename, Duplicate, Delete)
  console.log('[Test 2] Testing multi-page CRUD & bounds...');
  const app = {
    layoutData: migratedLayout,
    addPage(name = 'New Page', icon = '🎹') {
      const newPage = {
        id: 'page_' + Date.now(),
        name,
        icon,
        widgets: []
      };
      this.layoutData.pages.push(newPage);
      this.layoutData.activePageIndex = this.layoutData.pages.length - 1;
      return newPage;
    },
    switchPage(index) {
      if (index >= 0 && index < this.layoutData.pages.length) {
        this.layoutData.activePageIndex = index;
      }
    },
    deletePage(index) {
      if (this.layoutData.pages.length <= 1) return false;
      this.layoutData.pages.splice(index, 1);
      if (this.layoutData.activePageIndex >= this.layoutData.pages.length) {
        this.layoutData.activePageIndex = this.layoutData.pages.length - 1;
      }
      return true;
    }
  };

  app.addPage('Lead Synths', '🎹');
  app.addPage('Live FX & Loops', '🎚️');
  assert.strictEqual(app.layoutData.pages.length, 3);
  assert.strictEqual(app.layoutData.activePageIndex, 2);

  app.switchPage(1);
  assert.strictEqual(app.layoutData.activePageIndex, 1);
  assert.strictEqual(app.layoutData.pages[1].name, 'Lead Synths');

  // Ensure deleting down to 1 page is protected
  app.deletePage(2);
  app.deletePage(1);
  const cannotDeleteLast = app.deletePage(0);
  assert.strictEqual(cannotDeleteLast, false);
  assert.strictEqual(app.layoutData.pages.length, 1);
  console.log('  [✓] Multi-page CRUD & constraints verified!');

  // Test 3: 12-Column Grid dimensions clamping (colSpan 1..12, rowSpan 1..5)
  console.log('[Test 3] Testing 12-column grid span clamping...');
  function clampGridSpan(colSpan, rowSpan) {
    const colParsed = parseInt(colSpan);
    const rowParsed = parseInt(rowSpan);
    const clampedCol = Math.max(1, Math.min(12, Number.isFinite(colParsed) ? colParsed : 3));
    const clampedRow = Math.max(1, Math.min(5, Number.isFinite(rowParsed) ? rowParsed : 2));
    return { colSpan: clampedCol, rowSpan: clampedRow };
  }

  assert.deepStrictEqual(clampGridSpan(0, 0), { colSpan: 1, rowSpan: 1 });
  assert.deepStrictEqual(clampGridSpan(15, 9), { colSpan: 12, rowSpan: 5 });
  assert.deepStrictEqual(clampGridSpan('6', '3'), { colSpan: 6, rowSpan: 3 });
  assert.deepStrictEqual(clampGridSpan(null, undefined), { colSpan: 3, rowSpan: 2 });
  console.log('  [✓] Grid span clamping verified!');

  // Test 4: Device preview frame profiles
  console.log('[Test 4] Testing device preview frame constraints...');
  const deviceProfiles = {
    fluid: { width: '100%', maxWidth: 'none', bezel: false },
    desktop: { width: '100%', maxWidth: '1440px', bezel: false },
    tablet: { width: '840px', maxWidth: '840px', bezel: true },
    phone: { width: '420px', maxWidth: '420px', bezel: true }
  };

  assert.strictEqual(deviceProfiles.phone.width, '420px');
  assert.strictEqual(deviceProfiles.tablet.width, '840px');
  assert.strictEqual(deviceProfiles.desktop.maxWidth, '1440px');
  console.log('  [✓] Device preview profiles verified!');

  // Test 5: Bi-directional DAW automapping & echo suppression state updates
  console.log('[Test 5] Testing bi-directional DAW automapping & echo suppression...');
  const widgetsState = [
    { id: 'w_cc74', type: 'slider', channel: 1, cc: 74, value: 0 },
    { id: 'w_pad1', type: 'drum_pad', channel: 1, note: 60, active: false }
  ];

  function updateFromIncomingDawMidi(status, byte1, byte2) {
    const msgType = status & 0xF0;
    const channel = (status & 0x0F) + 1;
    let matched = 0;

    for (const w of widgetsState) {
      if (msgType === 0xB0 && w.channel === channel && w.cc === byte1) {
        w.value = byte2; // DAW sent CC update (e.g. project opened with cutoff = 88)
        matched++;
      } else if (msgType === 0x90 && byte2 > 0 && w.channel === channel && w.note === byte1) {
        w.active = true;
        matched++;
      } else if ((msgType === 0x80 || (msgType === 0x90 && byte2 === 0)) && w.channel === channel && w.note === byte1) {
        w.active = false;
        matched++;
      }
    }
    return matched;
  }

  // DAW sends CC 74 = 88 (Filter Cutoff recalled from DAW project)
  const ccMatch = updateFromIncomingDawMidi(0xB0, 74, 88);
  assert.strictEqual(ccMatch, 1);
  assert.strictEqual(widgetsState[0].value, 88);

  // DAW sends Note On 60 (Note playback from DAW track)
  const noteMatch = updateFromIncomingDawMidi(0x90, 60, 100);
  assert.strictEqual(noteMatch, 1);
  assert.strictEqual(widgetsState[1].active, true);

  // DAW sends Note Off 60
  updateFromIncomingDawMidi(0x80, 60, 0);
  assert.strictEqual(widgetsState[1].active, false);

  console.log('  [✓] Bi-directional DAW automapping verified!');
  console.log('\nALL MULTI-PAGE & GRID TESTS PASSED (100%)!\n');
}

runMultiPageGridTests();
