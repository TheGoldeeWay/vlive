/**
 * VLive Stage MIDI Controller - Custom Studio Client Engine
 * High-performance, ultra-low latency Web MIDI Controller for live performance.
 * Features:
 * - Dedicated Custom UI Canvas (Rotary Knobs, Slider Faders, Drum Pads, Trigger Buttons, Toggle Switches, 2D XY Pads)
 * - Real-time MIDI CC, Note On/Off, and Pitch Bend generation to DAW (VLive MIDI Controller)
 * - Automatic, live QR Dock for instant phone / tablet performance synchronization
 * - Direct in-process virtual MIDI engine & live connection status monitoring
 * - Low-jitter NTP-style microsecond clock synchronization over binary WebSocket
 */

class VLiveController {
  constructor() {
    // Connection State
    this.ws = null;
    this.isConnected = false;

    // Detect mobile or performer URL mode
    const urlParams = new URLSearchParams(window.location.search);
    const isNativeDesktop = !!(window.chrome && window.chrome.webview);
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    this.isPerformerMode = urlParams.get('performer') === '1' || urlParams.get('mobile') === '1' || (isMobileUA && !isNativeDesktop);
    if (this.isPerformerMode) {
      document.body.classList.add('performer-mode');
    }

    // Device Identity & Session
    this.deviceId = 'dev_' + Math.random().toString(36).substr(2, 6);
    this.deviceName = this.isPerformerMode ? 'Mobile Controller' : 'Stage Controller';
    this.assignedRole = this.isPerformerMode ? 'performer' : 'custom';
    this.defaultMidiChannel = 0; // Ch 1 (0-indexed)

    // Clock & Transport
    this.bpm = 120.0;
    this.isPlaying = false;
    this.clockOffsetMs = 0;
    this.rttMs = 0;
    this.lastTapTimes = [];
    this.stepTickCount = 0;

    // Web Audio Metronome
    this.audioCtx = null;
    this.metronomeEnabled = false;

    // Custom Builder State & Multi-Page System (Version 2)
    this.isDesignMode = false;
    this.layoutData = {
      version: 2,
      activePageIndex: 0,
      pages: [
        {
          id: 'page_1',
          name: 'Page 1 — Synth Deck',
          widgets: []
        }
      ]
    };
    this.canvasZoom = 1.0;
    this.clipboardWidget = null;
    this.clipboardWidgets = [];
    this.historyUndo = [];
    this.historyRedo = [];
    this.editingPageIndex = null;
    this.radarScanning = false;
    this.radarAbortCtrl = null;
    this.deferredInstallPrompt = null;
    this.hostIp = null;

    this.editingWidgetId = null;
    this.selectedWidgetId = null;
    this.selectedWidgetIds = new Set();
    this.activeDockTab = 'qr';
    this.serverIps = [];
    this.qrDockOpen = true;

    // Initialize subsystems
    this.initDOM();
    this.initPageSystem();
    this.initDevicePreview();
    this.initZoomControl();
    this.initSubnetRadar();
    this.initPwaServiceWorker();
    this.initBuilder();
    this.initQrDock();
    this.initWebSocket();
    this.initAudio();
    this.initClockSync();
  }

  get activePage() {
    if (!this.layoutData.pages || this.layoutData.pages.length === 0) {
      this.layoutData.pages = [{ id: 'page_1', name: 'Page 1 — Synth Deck', widgets: [] }];
      this.layoutData.activePageIndex = 0;
    }
    const idx = Math.max(0, Math.min(this.layoutData.pages.length - 1, this.layoutData.activePageIndex || 0));
    return this.layoutData.pages[idx];
  }

  get customWidgets() {
    return this.activePage.widgets;
  }

  set customWidgets(list) {
    this.activePage.widgets = list;
  }

  // --- INITIALIZATION ---

  initDOM() {
    // Transport Buttons (Desktop)
    const btnPlay = document.getElementById('btnPlay');
    const btnStop = document.getElementById('btnStop');
    if (btnPlay) btnPlay.addEventListener('click', () => this.togglePlay());
    if (btnStop) btnStop.addEventListener('click', () => this.stopPlayback());

    // Transport Buttons (Mobile Performer Bar)
    const mobileBtnPlay = document.getElementById('mobileBtnPlay');
    if (mobileBtnPlay) mobileBtnPlay.addEventListener('click', () => this.togglePlay());

    const mobileBtnTap = document.getElementById('mobileBtnTap');
    if (mobileBtnTap) mobileBtnTap.addEventListener('click', () => this.handleTapTempo());

    const mobileBtnFullscreen = document.getElementById('mobileBtnFullscreen');
    if (mobileBtnFullscreen) {
      mobileBtnFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
          mobileBtnFullscreen.classList.add('active');
        } else {
          document.exitFullscreen().catch(() => {});
          mobileBtnFullscreen.classList.remove('active');
        }
      });
    }

    // Responsive auto-fit scaling listener for viewport resize and device orientation changes
    const handleViewportResize = () => {
      if (this.isPerformerMode) {
        this.renderBuilderCanvas();
      }
      if (this.customWidgets) {
        this.customWidgets.forEach((w) => {
          const card = document.querySelector(`.widget-card[data-id="${w.id}"]`);
          if (card) this.updateComponentInternalGeometry(card, w);
        });
      }
    };

    window.addEventListener('resize', handleViewportResize);
    window.addEventListener('orientationchange', () => {
      setTimeout(handleViewportResize, 50);
      setTimeout(handleViewportResize, 200);
    });
    if (window.screen && window.screen.orientation) {
      window.screen.orientation.addEventListener('change', () => {
        setTimeout(handleViewportResize, 50);
        setTimeout(handleViewportResize, 200);
      });
    }

    const mobileBtnMetro = document.getElementById('mobileBtnMetro');
    if (mobileBtnMetro) {
      mobileBtnMetro.addEventListener('click', () => {
        this.metronomeEnabled = !this.metronomeEnabled;
        mobileBtnMetro.classList.toggle('active', this.metronomeEnabled);
        const desktopMetro = document.getElementById('btnMetronome');
        if (desktopMetro) desktopMetro.classList.toggle('active', this.metronomeEnabled);
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
          this.audioCtx.resume();
        }
      });
    }

    // BPM Controls
    const btnBpmPlus = document.getElementById('btnBpmPlus');
    const btnBpmMinus = document.getElementById('btnBpmMinus');
    const btnTap = document.getElementById('btnTapTempo');
    if (btnBpmPlus) btnBpmPlus.addEventListener('click', () => this.setBpm(this.bpm + 1));
    if (btnBpmMinus) btnBpmMinus.addEventListener('click', () => this.setBpm(this.bpm - 1));
    if (btnTap) btnTap.addEventListener('click', () => this.handleTapTempo());

    // Metronome Toggle (Desktop)
    const btnMetro = document.getElementById('btnMetronome');
    if (btnMetro) {
      btnMetro.addEventListener('click', () => {
        this.metronomeEnabled = !this.metronomeEnabled;
        btnMetro.classList.toggle('active', this.metronomeEnabled);
        if (mobileBtnMetro) mobileBtnMetro.classList.toggle('active', this.metronomeEnabled);
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
          this.audioCtx.resume();
        }
      });
    }

    // Settings Modal
    const btnSettings = document.getElementById('btnSettings');
    const btnCloseSettings = document.getElementById('btnCloseSettings');
    if (btnSettings) {
      btnSettings.addEventListener('click', () => {
        this.toggleSettingsModal(true);
        this.fetchMidiPorts();
      });
    }
    if (btnCloseSettings) {
      btnCloseSettings.addEventListener('click', () => this.toggleSettingsModal(false));
    }

    // DAW Setup Assistant & Master Transport
    const btnDawHelp = document.getElementById('btnDawHelp');
    if (btnDawHelp) {
      btnDawHelp.addEventListener('click', () => {
        this.toggleDawSetupModal(true);
      });
    }

    const btnTopMenu = document.getElementById('btnTopMenu');
    if (btnTopMenu) {
      btnTopMenu.addEventListener('click', () => {
        this.toggleDawSetupModal(true);
      });
    }

    const btnModalOpenDawHelp = document.getElementById('btnModalOpenDawHelp');
    if (btnModalOpenDawHelp) {
      btnModalOpenDawHelp.addEventListener('click', () => {
        this.toggleSettingsModal(false);
        this.toggleDawSetupModal(true);
      });
    }

    const btnCloseDawSetup = document.getElementById('btnCloseDawSetup');
    if (btnCloseDawSetup) {
      btnCloseDawSetup.addEventListener('click', () => this.toggleDawSetupModal(false));
    }

    const btnGotItDaw = document.getElementById('btnGotItDaw');
    if (btnGotItDaw) {
      btnGotItDaw.addEventListener('click', () => this.toggleDawSetupModal(false));
    }

    const btnDawTest = document.getElementById('btnDawTest');
    if (btnDawTest) {
      btnDawTest.addEventListener('click', async () => {
        this.sendTestDawNote(btnDawTest);
      });
    }

    const btnDawModalTest = document.getElementById('btnDawModalTest');
    if (btnDawModalTest) {
      btnDawModalTest.addEventListener('click', async () => {
        this.sendTestDawNote(btnDawModalTest);
      });
    }

    const btnModalDawTest = document.getElementById('btnModalDawTest');
    if (btnModalDawTest) {
      btnModalDawTest.addEventListener('click', async () => {
        this.sendTestDawNote(btnModalDawTest);
      });
    }

    const btnStartDriver = document.getElementById('btnStartDriver');
    if (btnStartDriver) {
      btnStartDriver.addEventListener('click', async () => {
        this.startVirtualMidiDriver();
      });
    }

    const btnQrStartDriver = document.getElementById('btnQrStartDriver');
    if (btnQrStartDriver) {
      btnQrStartDriver.addEventListener('click', async () => {
        this.startVirtualMidiDriver();
      });
    }

    const btnQrTestNote = document.getElementById('btnQrTestNote');
    if (btnQrTestNote) {
      btnQrTestNote.addEventListener('click', async () => {
        this.sendTestDawNote(btnQrTestNote);
      });
    }

    const btnHeaderStartDriver = document.getElementById('btnHeaderStartDriver');
    if (btnHeaderStartDriver) {
      btnHeaderStartDriver.addEventListener('click', async () => {
        this.startVirtualMidiDriver();
      });
    }

    const midiBadge = document.getElementById('virtualMidiBadge');
    if (midiBadge) {
      midiBadge.addEventListener('click', () => {
        if (midiBadge.classList.contains('disconnected')) {
          this.startVirtualMidiDriver();
        }
      });
    }

    const headerPortSelect = document.getElementById('headerPortSelect');
    if (headerPortSelect) {
      headerPortSelect.addEventListener('change', () => {
        this.switchMidiPort(headerPortSelect.value);
      });
    }

    const btnSwitchWinmm = document.getElementById('btnSwitchWinmmPort');
    if (btnSwitchWinmm) {
      btnSwitchWinmm.addEventListener('click', () => {
        const sel = document.getElementById('winmmPortSelect');
        if (sel) this.switchMidiPort(sel.value);
      });
    }

    // DAW Setup Tabs
    document.querySelectorAll('.daw-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const targetDaw = tab.dataset.daw;
        document.querySelectorAll('.daw-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.daw-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const content = document.getElementById(`tab-${targetDaw}`);
        if (content) content.classList.add('active');
      });
    });

    // Screen Wake Lock & Tab Visibility Resumption
    this.initWakeLock();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.requestWakeLock();
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          this.initWebSocket();
        }
      }
    });

    // Keyboard Hotkeys (Space = Play/Pause, T = Tap, F11 = Fullscreen)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.code === 'KeyT') {
        this.handleTapTempo();
      }

      // Design Mode Keyboard Shortcuts (Ctrl+C, Ctrl+V, Ctrl+D, Ctrl+X, Delete, Nudge, Undo/Redo)
      if (this.isDesignMode && !e.target.matches('input, select, textarea, [contenteditable]')) {
        const isCtrlOrMeta = e.ctrlKey || e.metaKey;

        if (isCtrlOrMeta && (e.key === 'a' || e.key === 'A')) {
          e.preventDefault();
          this.selectAllWidgets();
        } else if (isCtrlOrMeta && (e.key === 'c' || e.key === 'C')) {
          e.preventDefault();
          this.copySelectedWidget();
        } else if (isCtrlOrMeta && (e.key === 'v' || e.key === 'V')) {
          e.preventDefault();
          this.pasteWidget();
        } else if (isCtrlOrMeta && (e.key === 'd' || e.key === 'D')) {
          e.preventDefault();
          this.duplicateSelectedWidget();
        } else if (isCtrlOrMeta && (e.key === 'x' || e.key === 'X')) {
          e.preventDefault();
          this.cutSelectedWidget();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          this.deleteSelectedWidget();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.deselectAll();
          this.closeContextMenu();
        } else if (isCtrlOrMeta && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          if (e.shiftKey) {
            this.redoLayout();
          } else {
            this.undoLayout();
          }
        } else if (isCtrlOrMeta && (e.key === 'y' || e.key === 'Y')) {
          e.preventDefault();
          this.redoLayout();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.nudgeSelectedWidget(e.shiftKey ? -10 : -1, 0);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.nudgeSelectedWidget(e.shiftKey ? 10 : 1, 0);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.nudgeSelectedWidget(0, e.shiftKey ? -10 : -1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.nudgeSelectedWidget(0, e.shiftKey ? 10 : 1);
        }
      }
    });
  }

  initAudio() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
    } catch (e) {
      console.warn('Web Audio not supported:', e);
    }
  }

  playMetronomeClick(isHigh = false) {
    if (!this.metronomeEnabled || !this.audioCtx) return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(isHigh ? 1200 : 800, this.audioCtx.currentTime);
      gain.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.04);
    } catch (e) {}
  }

  // --- TRANSPORT & CLOCK ---

  togglePlay() {
    this.isPlaying = !this.isPlaying;
    this.updateTransportUI();
    const statusByte = this.isPlaying ? 0xFA : 0xFC; // START or STOP
    this.sendRawBytes(new Uint8Array([statusByte]));
    this.sendJson({
      type: 'transport_change',
      playing: this.isPlaying,
      bpm: this.bpm
    });
  }

  stopPlayback() {
    this.isPlaying = false;
    this.updateTransportUI();
    this.sendRawBytes(new Uint8Array([0xFC])); // STOP
    this.sendJson({ type: 'transport_change', playing: false, bpm: this.bpm });
  }

  updateTransportUI() {
    const btnPlay = document.getElementById('btnPlay');
    if (btnPlay) {
      btnPlay.classList.toggle('playing', this.isPlaying);
    }
    const mobileBtnPlay = document.getElementById('mobileBtnPlay');
    if (mobileBtnPlay) {
      mobileBtnPlay.classList.toggle('playing', this.isPlaying);
      mobileBtnPlay.textContent = this.isPlaying ? '⏸' : '▶';
    }
  }

  setBpm(newBpm) {
    this.bpm = Math.max(20, Math.min(300, Math.round(newBpm * 10) / 10));
    const bpmVal = document.getElementById('bpmValue');
    if (bpmVal) bpmVal.textContent = this.bpm.toFixed(1);
    const mobileBpm = document.getElementById('mobileBpmVal');
    if (mobileBpm) mobileBpm.textContent = this.bpm.toFixed(1);
    this.sendJson({ type: 'bpm_change', bpm: this.bpm });
  }

  handleTapTempo() {
    const now = performance.now();
    this.lastTapTimes.push(now);
    if (this.lastTapTimes.length > 5) this.lastTapTimes.shift();

    if (this.lastTapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < this.lastTapTimes.length; i++) {
        intervals.push(this.lastTapTimes[i] - this.lastTapTimes[i - 1]);
      }
      const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
      if (avgInterval >= 200 && avgInterval <= 3000) {
        const calculatedBpm = 60000 / avgInterval;
        this.setBpm(calculatedBpm);
      }
    }
  }

  pulseBeatIndicator() {
    const pulse = document.getElementById('beatIndicator');
    if (pulse) {
      pulse.classList.add('flash');
      setTimeout(() => pulse.classList.remove('flash'), 50);
    }
    const mobilePulse = document.getElementById('mobileBeatPulse');
    if (mobilePulse) {
      mobilePulse.classList.add('flash');
      setTimeout(() => mobilePulse.classList.remove('flash'), 50);
    }
  }

  // --- WEBSOCKET & MIDI PROTOCOL ---

  initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let host = window.location.host;
    if (this.hostIp) {
      const port = window.location.port || '8088';
      host = `${this.hostIp}:${port}`;
    } else if (!host) {
      host = 'localhost:8088';
    }
    const wsUrl = `${protocol}//${host}/ws`;

    this.updateConnBadge('CONNECTING...', 'offline');

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.isConnected = true;
        this.updateConnBadge('ONLINE', 'online');
        this.sendJson({
          type: 'hello',
          deviceId: this.deviceId,
          deviceName: this.deviceName,
          role: this.assignedRole
        });
        // If desktop host has existing decks/pages, share active layout with server
        if (!this.isPerformerMode && this.layoutData && Array.isArray(this.layoutData.pages) && this.layoutData.pages.length > 0) {
          this.broadcastLayoutSync();
        }
      };

      this.ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            this.handleJsonMessage(JSON.parse(event.data));
          } catch (err) {
            console.warn('WS JSON parse error:', err);
          }
        } else {
          try {
            this.handleBinaryMessage(new Uint8Array(event.data));
          } catch (err) {
            console.warn('WS Binary message error:', err);
          }
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.updateConnBadge('OFFLINE', 'offline');
        setTimeout(() => this.initWebSocket(), 2000);
      };

      this.ws.onerror = () => {
        this.isConnected = false;
      };
    } catch (e) {
      console.warn('WebSocket init failed:', e);
    }
  }

  sendRawBytes(uint8Data) {
    this.flashVirtualMidiBadge();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(uint8Data.buffer);
    }
  }

  sendJson(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  handleBinaryMessage(bytes) {
    for (let i = 0; i < bytes.length;) {
      const b = bytes[i];
      if (b === 0xF8) {
        this.onClockTick();
        i++;
      } else if (b === 0xFA) {
        this.isPlaying = true;
        this.updateTransportUI();
        i++;
      } else if (b === 0xFC) {
        this.isPlaying = false;
        this.updateTransportUI();
        i++;
      } else if ((b & 0xF0) === 0xB0) { // MIDI CC
        if (i + 2 < bytes.length) {
          const ch = b & 0x0F;
          const cc = bytes[i + 1];
          const val = bytes[i + 2];
          this.updateWidgetsFromMidi('cc', ch, cc, val);
          i += 3;
        } else {
          break;
        }
      } else if ((b & 0xF0) === 0x90) { // Note On
        if (i + 2 < bytes.length) {
          const ch = b & 0x0F;
          const note = bytes[i + 1];
          const vel = bytes[i + 2];
          this.updateWidgetsFromMidi('note', ch, note, vel > 0 ? vel : 0);
          i += 3;
        } else {
          break;
        }
      } else if ((b & 0xF0) === 0x80) { // Note Off
        if (i + 2 < bytes.length) {
          const ch = b & 0x0F;
          const note = bytes[i + 1];
          this.updateWidgetsFromMidi('note', ch, note, 0);
          i += 3;
        } else {
          break;
        }
      } else if ((b & 0xF0) === 0xE0) { // Pitch Bend
        if (i + 2 < bytes.length) {
          const ch = b & 0x0F;
          const lsb = bytes[i + 1];
          const msb = bytes[i + 2];
          const val14 = (msb << 7) | lsb;
          const val = Math.round((val14 / 16383) * 127);
          this.updateWidgetsFromMidi('pitch', ch, 0, val);
          i += 3;
        } else {
          break;
        }
      } else {
        i++;
      }
    }
  }

  handleJsonMessage(data) {
    switch (data.type) {
      case 'pong':
        this.onPongReceived(data);
        break;
      case 'bpm_update':
        this.bpm = data.bpm;
        const bpmVal = document.getElementById('bpmValue');
        if (bpmVal) bpmVal.textContent = this.bpm.toFixed(1);
        const mobileBpm = document.getElementById('mobileBpmVal');
        if (mobileBpm) mobileBpm.textContent = this.bpm.toFixed(1);
        break;
      case 'transport_update':
        this.isPlaying = data.playing;
        this.updateTransportUI();
        break;
      case 'widget_update':
        this.applyRemoteWidgetUpdate(data.id, data.val, data.msgType, data.channel, data.num, data);
        break;
      case 'page_switch':
        if (typeof data.pageIndex === 'number' && data.pageIndex >= 0 && this.layoutData && this.layoutData.pages && data.pageIndex < this.layoutData.pages.length) {
          this.switchPage(data.pageIndex, false);
        }
        break;
      case 'sync_layout':
        if (data.layout) {
          this.applySyncedLayout(data.layout);
        }
        break;
      case 'state_sync':
        if (data.bpm) this.setBpm(data.bpm);
        if (data.playing !== undefined) {
          this.isPlaying = data.playing;
          this.updateTransportUI();
        }
        if (data.layout) {
          this.applySyncedLayout(data.layout);
        }
        break;
    }
  }

  initClockSync() {
    setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendJson({
          type: 'ping',
          t0: performance.now()
        });
      }
    }, 1000);
  }

  onPongReceived(msg) {
    const t3 = performance.now();
    const t0 = msg.t0;
    const t1 = msg.t1;
    const t2 = msg.t2;

    const rtt = (t3 - t0) - (t2 - t1);
    const offset = ((t1 - t0) + (t2 - t3)) / 2;

    this.rttMs = Math.max(0, rtt);
    this.clockOffsetMs = offset;

    const rttStr = this.rttMs.toFixed(1) + ' ms';
    const rttEl = document.getElementById('metricRtt');
    const offsetEl = document.getElementById('metricOffset');
    if (rttEl) rttEl.textContent = rttStr;
    if (offsetEl) offsetEl.textContent = this.clockOffsetMs.toFixed(1) + ' ms';
  }

  onClockTick() {
    this.stepTickCount++;
    if (this.stepTickCount >= 24) {
      this.stepTickCount = 0;
      this.pulseBeatIndicator();
      this.playMetronomeClick(true);
    }
  }

  // --- MIDI MESSAGE BUILDERS ---

  sendNoteOn(note, velocity = 100, channel = 0) {
    const ch = channel & 0x0F;
    const n = Math.max(0, Math.min(127, note));
    const v = Math.max(1, Math.min(127, velocity));
    this.sendRawBytes(new Uint8Array([0x90 | ch, n, v]));
  }

  sendNoteOff(note, channel = 0) {
    const ch = channel & 0x0F;
    const n = Math.max(0, Math.min(127, note));
    this.sendRawBytes(new Uint8Array([0x80 | ch, n, 0x00]));
  }

  sendControlChange(cc, value, channel = 0) {
    const ch = channel & 0x0F;
    const c = Math.max(0, Math.min(127, cc));
    const v = Math.max(0, Math.min(127, value));
    this.sendRawBytes(new Uint8Array([0xB0 | ch, c, v]));
  }

  sendPitchBend(value14bit, channel = 0) {
    const ch = channel & 0x0F;
    const clamped = Math.max(0, Math.min(16383, value14bit));
    const lsb = clamped & 0x7F;
    const msb = (clamped >> 7) & 0x7F;
    this.sendRawBytes(new Uint8Array([0xE0 | ch, lsb, msb]));
  }

  // --- CUSTOM UI BUILDER ---

  initBuilder() {
    // Mode Toggle (Design vs Play)
    const btnMode = document.getElementById('btnToggleBuilderMode');
    if (btnMode) {
      btnMode.addEventListener('click', () => {
        this.isDesignMode = !this.isDesignMode;
        this.updateBuilderModeUI();
      });
    }

    // Add Widget Buttons (.btn-tool-add with data-add="...")
    document.querySelectorAll('.btn-tool-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.add || 'knob';
        this.addCustomWidget(type);
      });
    });

    // Preset Loader
    const presetSelect = document.getElementById('builderPresetSelect');
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val) {
          this.loadPresetLayout(val);
          e.target.value = '';
        }
      });
    }



    // Quick Editing Action Buttons
    const btnQuickDup = document.getElementById('btnQuickDup');
    const btnQuickCopy = document.getElementById('btnQuickCopy');
    const btnQuickPaste = document.getElementById('btnQuickPaste');
    const btnQuickDel = document.getElementById('btnQuickDel');
    const btnQuickUndo = document.getElementById('btnQuickUndo');
    const btnQuickRedo = document.getElementById('btnQuickRedo');

    if (btnQuickDup) btnQuickDup.addEventListener('click', () => this.duplicateSelectedWidget());
    if (btnQuickCopy) btnQuickCopy.addEventListener('click', () => this.copySelectedWidget());
    if (btnQuickPaste) btnQuickPaste.addEventListener('click', () => this.pasteWidget());
    if (btnQuickDel) btnQuickDel.addEventListener('click', () => this.deleteSelectedWidget());
    if (btnQuickUndo) btnQuickUndo.addEventListener('click', () => this.undoLayout());
    if (btnQuickRedo) btnQuickRedo.addEventListener('click', () => this.redoLayout());

    // Save & Load
    const btnSave = document.getElementById('btnSaveLayout');
    if (btnSave) {
      btnSave.addEventListener('click', () => this.saveCustomLayout());
    }

    const btnLoad = document.getElementById('btnLoadSavedLayout');
    if (btnLoad) {
      btnLoad.addEventListener('click', () => {
        if (this.loadSavedLayout()) {
          this.showEditingToast('Layout loaded successfully');
        } else {
          this.showEditingToast('No saved layout found');
        }
      });
    }

    // Export & Import
    const btnExport = document.getElementById('btnExportLayout');
    if (btnExport) {
      btnExport.addEventListener('click', () => this.exportLayoutJson());
    }

    const btnImport = document.getElementById('btnImportLayout');
    const fileImport = document.getElementById('fileImportLayout');
    if (btnImport && fileImport) {
      btnImport.addEventListener('click', () => fileImport.click());
      fileImport.addEventListener('change', (e) => this.importLayoutJson(e));
    }

    // Clear Layout
    const btnClear = document.getElementById('btnClearLayout');
    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        const ok = await this.showConfirm('CLEAR CANVAS', 'Clear all custom widgets from the canvas?', 'Clear Canvas', true);
        if (ok) {
          this.pushUndoHistory();
          this.customWidgets = [];
          this.selectWidget(null);
          this.renderBuilderCanvas();
          this.broadcastLayoutSync();
          this.showEditingToast('Cleared canvas');
        }
      });
    }

    // Inspector Config Modal Buttons
    const btnCloseCfg = document.getElementById('btnCloseWidgetConfig');
    const btnCancelCfg = document.getElementById('btnCancelWidgetConfig');
    const btnSaveCfg = document.getElementById('btnSaveWidgetConfig');
    const btnDelCfg = document.getElementById('btnDeleteWidgetModal');

    if (btnCloseCfg) btnCloseCfg.addEventListener('click', () => this.closeWidgetConfig());
    if (btnCancelCfg) btnCancelCfg.addEventListener('click', () => this.closeWidgetConfig());
    if (btnSaveCfg) btnSaveCfg.addEventListener('click', () => this.saveWidgetConfig());
    if (btnDelCfg) {
      btnDelCfg.addEventListener('click', () => {
        if (this.editingWidgetId) {
          this.customWidgets = this.customWidgets.filter(w => w.id !== this.editingWidgetId);
          this.closeWidgetConfig();
          this.renderBuilderCanvas();
          this.broadcastLayoutSync();
        }
      });
    }

    // Live Note / CC name helper inside modal
    const numInput = document.getElementById('cfgMidiNum');
    const typeSelect = document.getElementById('cfgMsgType');
    const helper = document.getElementById('cfgNoteNameHelper');
    const updateHelper = () => {
      if (!numInput || !typeSelect || !helper) return;
      const val = parseInt(numInput.value) || 0;
      const t = typeSelect.value;
      if (t === 'note') {
        helper.textContent = `Note #${val} (${this.getMidiNoteName(val)})`;
      } else if (t === 'cc') {
        helper.textContent = `CC #${val}`;
      } else {
        helper.textContent = `${t.toUpperCase()} #${val}`;
      }
    };
    if (numInput && typeSelect) {
      numInput.addEventListener('input', updateHelper);
      typeSelect.addEventListener('change', updateHelper);
    }

    // Initialize Right Panel Inspector Listeners
    this.initInspector();
    this.initCanvasMarquee();
    this.initCanvasContextMenu();

    // Load saved layout permanently, or load default studio reference project if no saved layout exists
    if (!this.loadSavedLayout()) {
      this.loadDefaultStudioProject();
    }

    // Set initial mode UI (Perform Mode by default)
    this.updateBuilderModeUI();
  }

  updateBuilderModeUI() {
    const btnMode = document.getElementById('btnToggleBuilderMode');
    const icon = document.getElementById('builderModeIcon');
    const text = document.getElementById('builderModeText');

    if (btnMode) {
      btnMode.classList.toggle('play-mode', !this.isDesignMode);
      btnMode.classList.toggle('design-mode', this.isDesignMode);
      btnMode.setAttribute('title', this.isDesignMode ? 'Switch to Play mode' : 'Switch to Edit mode');
    }
    if (icon) {
      icon.innerHTML = this.isDesignMode
        ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
        : '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
    }
    if (text) {
      text.textContent = this.isDesignMode ? 'GO TO PLAY' : 'GO TO EDIT';
    }

    document.body.classList.toggle('design-mode-active', this.isDesignMode);

    // Add Control Buttons & Action Group: ONLY visible in Design Mode
    const addControls = document.getElementById('builderAddControls');
    if (addControls) addControls.style.display = this.isDesignMode ? 'flex' : 'none';

    const editActions = document.getElementById('builderEditActions');
    if (editActions) editActions.style.display = this.isDesignMode ? 'flex' : 'none';

    const shortcutsHud = document.getElementById('shortcutsHudBar');
    if (shortcutsHud) shortcutsHud.style.display = this.isDesignMode ? 'flex' : 'none';

    // Inspector Tab: ONLY visible in Design Mode
    const btnTabInspector = document.getElementById('btnTabInspector');
    if (btnTabInspector) btnTabInspector.style.display = this.isDesignMode ? 'flex' : 'none';

    if (this.isDesignMode) {
      // In Edit/Design Mode: Open dock and show Inspector
      if (!this.qrDockOpen) {
        this.qrDockOpen = true;
        const panel = document.getElementById('qrDockPanel');
        const btnToggle = document.getElementById('btnToggleQrDock');
        if (panel) panel.classList.remove('collapsed');
        if (btnToggle) btnToggle.classList.add('active');
      }
      this.switchDockTab('inspector');
      if (this.selectedWidgetIds.size === 0 && this.customWidgets.length > 0) {
        this.selectWidget(this.customWidgets[0].id);
      } else {
        this.updateSelectionDOM();
        this.updateInspectorForSelection();
      }
    } else {
      // In Play Live / Perform Mode: Switch dock to QR Code and close inspector
      this.closeContextMenu();
      if (this.activeDockTab === 'inspector') {
        this.switchDockTab('qr');
      }
      this.deselectAll();
    }

    this.renderBuilderCanvas();
  }

  getMidiNoteName(num) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const oct = Math.floor(num / 12) - 1;
    const n = names[num % 12];
    return `${n}${oct}`;
  }

  ensureWidgetCoordinates(w, index = 0) {
    if (!w) return;
    if (w.w === undefined || w.w === null || w.w <= 0) {
      if (w.colSpan) {
        w.w = w.colSpan * 90;
      } else if (w.type === 'xy') {
        w.w = 320;
      } else if (w.type === 'fader') {
        w.w = 160;
      } else if (w.type === 'pad') {
        w.w = 180;
      } else if (w.type === 'button') {
        w.w = 180;
      } else if (w.type === 'toggle') {
        w.w = 160;
      } else {
        w.w = 180;
      }
    }

    if (w.h === undefined || w.h === null || w.h <= 0) {
      if (w.rowSpan) {
        w.h = w.rowSpan * 90;
      } else if (w.type === 'xy') {
        w.h = 240;
      } else if (w.type === 'fader') {
        w.h = 260;
      } else if (w.type === 'pad') {
        w.h = 180;
      } else if (w.type === 'button') {
        w.h = 120;
      } else if (w.type === 'toggle') {
        w.h = 110;
      } else {
        w.h = 220;
      }
    }

    if (w.x === undefined || w.x === null) {
      const cols = 4;
      const col = index % cols;
      w.x = 20 + (col * 200);
    }
    if (w.y === undefined || w.y === null) {
      const cols = 4;
      const row = Math.floor(index / cols);
      w.y = 20 + (row * 270);
    }
  }

  addCustomWidget(type, customX = null, customY = null) {
    if (!this.isDesignMode) return;
    this.pushUndoHistory();
    const id = 'w_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const count = this.customWidgets.length;

    let defaultW = 180;
    let defaultH = 220;
    if (type === 'xy') {
      defaultW = 320;
      defaultH = 240;
    } else if (type === 'fader') {
      defaultW = 160;
      defaultH = 240;
    } else if (type === 'button') {
      defaultW = 180;
      defaultH = 120;
    } else if (type === 'toggle') {
      defaultW = 160;
      defaultH = 110;
    } else if (type === 'pad') {
      defaultW = 180;
      defaultH = 180;
    }

    let x = (typeof customX === 'number') ? customX : (20 + ((count % 4) * 200));
    let y = (typeof customY === 'number') ? customY : (20 + (Math.floor(count / 4) * 240));

    let widget = {
      id,
      type,
      label: `${type.toUpperCase()} ${count + 1}`,
      msgType: (type === 'pad' || type === 'button') ? 'note' : 'cc',
      channel: (type === 'pad') ? 9 : 0, // Ch 10 for pads, Ch 1 for others
      midiNum: (type === 'pad') ? (36 + (count % 16)) : (70 + (count % 20)),
      minVal: 0,
      maxVal: 127,
      value: (type === 'toggle') ? 0 : 64,
      color: ['cyan', 'magenta', 'amber', 'lime', 'violet', 'red'][count % 6],
      behavior: 'standard',
      x,
      y,
      w: defaultW,
      h: defaultH
    };

    if (type === 'toggle') widget.behavior = 'toggle';
    if (type === 'button') widget.behavior = 'momentary';

    this.customWidgets.push(widget);
    this.saveLayoutToStorage();
    this.renderBuilderCanvas();
    this.selectWidget(widget.id);
    this.broadcastLayoutSync();
    this.showEditingToast(`Added ${type.toUpperCase()}`);
  }

  getLayoutBoundingBox() {
    if (!this.customWidgets || this.customWidgets.length === 0) {
      return { x: 0, y: 0, w: 400, h: 400 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = 0;
    let maxY = 0;

    this.customWidgets.forEach((w, idx) => {
      this.ensureWidgetCoordinates(w, idx);
      const wx = typeof w.x === 'number' ? w.x : 20;
      const wy = typeof w.y === 'number' ? w.y : 20;
      const ww = typeof w.w === 'number' ? w.w : 180;
      const wh = typeof w.h === 'number' ? w.h : 220;

      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wx + ww > maxX) maxX = wx + ww;
      if (wy + wh > maxY) maxY = wy + wh;
    });

    if (minX === Infinity) minX = 0;
    if (minY === Infinity) minY = 0;

    const pad = 24;
    const w = Math.max(360, maxX + pad);
    const h = Math.max(360, maxY + pad);

    return { minX, minY, maxX, maxY, w, h };
  }

  updateCanvasBounds() {
    const canvas = document.getElementById('builderCanvas');
    if (!canvas || !this.customWidgets || this.customWidgets.length === 0) return;
    const bbox = this.getLayoutBoundingBox();
    if (this.isPerformerMode) {
      const viewport = document.getElementById('builderCanvasViewport');
      const availW = (viewport && viewport.clientWidth) || window.innerWidth || 390;
      const availH = (viewport && viewport.clientHeight) || (window.innerHeight - 46) || 750;
      const scaleX = availW / bbox.w;
      const scaleY = availH / bbox.h;
      let autoScale = Math.min(scaleX, scaleY);
      if (!isFinite(autoScale) || autoScale <= 0) autoScale = 1.0;

      canvas.style.width = `${bbox.w}px`;
      canvas.style.height = `${bbox.h}px`;
      canvas.style.minWidth = `${bbox.w}px`;
      canvas.style.minHeight = `${bbox.h}px`;
      canvas.style.transform = `translate(-50%, -50%) scale(${autoScale})`;
    } else {
      canvas.style.minWidth = `${bbox.w}px`;
      canvas.style.minHeight = `${Math.max(650, bbox.h)}px`;
    }
  }

  renderBuilderCanvas() {
    const canvas = document.getElementById('builderCanvas');
    const emptyState = document.getElementById('builderEmptyState');
    if (!canvas) return;
    canvas.innerHTML = '';
    canvas.classList.toggle('edit-mode', this.isDesignMode);

    if (this.customWidgets.length === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      this.updateStatusStrip();
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    const viewport = document.getElementById('builderCanvasViewport');
    const bbox = this.getLayoutBoundingBox();

    if (this.isPerformerMode) {
      // Mobile / Tablet Performer Mode: Fixed, strictly non-scrollable stage
      // Proportionally auto-scales layout to fit 100% of ANY screen (portrait or landscape)
      const availW = (viewport && viewport.clientWidth) || window.innerWidth || 390;
      const availH = (viewport && viewport.clientHeight) || (window.innerHeight - 46) || 750;

      const scaleX = availW / bbox.w;
      const scaleY = availH / bbox.h;
      let autoScale = Math.min(scaleX, scaleY);
      if (!isFinite(autoScale) || autoScale <= 0) autoScale = 1.0;

      canvas.style.position = 'absolute';
      canvas.style.left = '50%';
      canvas.style.top = '50%';
      canvas.style.width = `${bbox.w}px`;
      canvas.style.height = `${bbox.h}px`;
      canvas.style.minWidth = `${bbox.w}px`;
      canvas.style.minHeight = `${bbox.h}px`;
      canvas.style.transform = `translate(-50%, -50%) scale(${autoScale})`;
      canvas.style.transformOrigin = 'center center';
    } else {
      // Desktop Studio Mode: Unified freeform canvas with full resize/placement freedom
      canvas.style.position = 'relative';
      canvas.style.left = '0';
      canvas.style.top = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.minWidth = `${bbox.w}px`;
      canvas.style.minHeight = `${Math.max(650, bbox.h)}px`;
      canvas.style.transform = (this.canvasZoom && this.canvasZoom !== 1.0) ? `scale(${this.canvasZoom})` : 'none';
      canvas.style.transformOrigin = 'top left';
    }

    this.customWidgets.forEach((w) => {
      const card = document.createElement('div');
      const isSelected = this.isDesignMode && (this.selectedWidgetIds ? this.selectedWidgetIds.has(w.id) : w.id === this.selectedWidgetId);
      card.className = `widget-card color-${w.color} widget-type-${w.type} ${this.isDesignMode ? 'edit-mode' : ''} ${isSelected ? 'selected' : ''}`;
      card.dataset.id = w.id;

      card.style.setProperty('--widget-x', `${w.x}px`);
      card.style.setProperty('--widget-y', `${w.y}px`);
      card.style.setProperty('--widget-w', `${w.w}px`);
      card.style.setProperty('--widget-h', `${w.h}px`);

      // In Design Mode, clicking anywhere on the card selects it (supports Shift/Ctrl multi-selection)
      if (this.isDesignMode) {
        card.addEventListener('pointerdown', (e) => {
          if (e.target.closest('.btn-card-del') || e.target.closest('.widget-resize-handle') || e.target.closest('.btn-card-opts')) return;
          if (e.shiftKey || e.ctrlKey) {
            e.stopPropagation();
            this.selectWidget(w.id, true);
          } else if (!this.selectedWidgetIds.has(w.id)) {
            this.selectWidget(w.id, false);
          }
        });
      }

      // Widget Card Header
      const midiSubtitle = w.msgType === 'note'
        ? `Note ${w.midiNum} &nbsp;|&nbsp; Ch ${w.channel + 1}`
        : w.msgType === 'pitch'
          ? `Pitch &nbsp;|&nbsp; Ch ${w.channel + 1}`
          : `CC #${w.midiNum} &nbsp;|&nbsp; Ch ${w.channel + 1}`;

      card.innerHTML = `
        <div class="widget-card-header">
          <div class="widget-title-group">
            <div class="widget-title">${w.label}</div>
            <div class="widget-midi-badge">${midiSubtitle}</div>
          </div>
          <button class="btn-card-opts" data-id="${w.id}" title="Control Options">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          </button>
        </div>
      `;

      const optsBtn = card.querySelector('.btn-card-opts');
      if (optsBtn) {
        optsBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectWidget(w.id);
          this.switchDockTab('inspector');
        });
      }

      // Dragging card header is active ONLY in Edit Mode!
      if (this.isDesignMode) {
        this.bindCardDrag(card, w);
      }

      // Interactive Body
      const bodyWrap = document.createElement('div');
      bodyWrap.className = 'widget-body';

      if (w.type === 'knob') {
        const range = (w.maxVal - w.minVal) || 127;
        const frac = Math.max(0, Math.min(1, (w.value - w.minVal) / range));
        const angle = -135 + frac * 270;
        bodyWrap.innerHTML = `
          <div class="custom-knob-surface ${w.color ? `color-${w.color}` : ''}" data-id="${w.id}">
            <div class="custom-knob-dial" style="transform: rotate(${angle}deg)">
              <div class="custom-knob-indicator"></div>
            </div>
            <span class="custom-knob-value">${w.value}</span>
          </div>
        `;
        this.bindCustomKnobEvents(bodyWrap.querySelector('.custom-knob-surface'), w);

      } else if (w.type === 'fader') {
        const range = (w.maxVal - w.minVal) || 127;
        const frac = Math.max(0, Math.min(1, (w.value - w.minVal) / range));
        bodyWrap.innerHTML = `
          <div class="custom-fader-surface ${w.color ? `color-${w.color}` : ''}" data-id="${w.id}">
            <div class="custom-fader-track"></div>
            <div class="custom-fader-thumb" style="bottom: calc(${frac * 100}% - ${frac * 28}px)">
              <div class="fader-thumb-notch"></div>
            </div>
          </div>
          <span class="custom-fader-val">${w.value}</span>
        `;
        this.bindCustomFaderEvents(bodyWrap.querySelector('.custom-fader-surface'), w, bodyWrap.querySelector('.custom-fader-val'));

      } else if (w.type === 'button') {
        const isPressed = w.value > w.minVal;
        const btnLabel = w.label || 'BUTTON';
        bodyWrap.innerHTML = `
          <button class="custom-btn-surface ${isPressed ? 'pressed' : ''} ${w.color ? `color-${w.color}` : ''}" data-id="${w.id}">
            <span class="custom-btn-label">${btnLabel}</span>
          </button>
        `;
        this.bindCustomButtonEvents(bodyWrap.querySelector('.custom-btn-surface'), w);

      } else if (w.type === 'toggle') {
        const isActive = w.value >= (w.maxVal / 2);
        bodyWrap.innerHTML = `
          <div class="custom-toggle-wrap">
            <div class="custom-toggle-surface ${isActive ? 'active' : ''} ${w.color ? `color-${w.color}` : ''}" data-id="${w.id}">
              <div class="custom-toggle-lamp"></div>
            </div>
            <span class="custom-toggle-state-text">${isActive ? 'ON' : 'OFF'}</span>
          </div>
        `;
        this.bindCustomToggleEvents(bodyWrap.querySelector('.custom-toggle-wrap'), w);

      } else if (w.type === 'pad') {
        const isHit = w.value > 0;
        const padText = w.label || 'PAD';
        bodyWrap.innerHTML = `
          <div class="custom-pad-surface ${isHit ? 'hit' : ''} ${w.color ? `color-${w.color}` : ''}" data-id="${w.id}">
            <span class="custom-pad-text">${padText}</span>
          </div>
        `;
        this.bindCustomPadEvents(bodyWrap.querySelector('.custom-pad-surface'), w);

      } else if (w.type === 'xy') {
        const xPct = ((w.valX !== undefined ? w.valX : 64) / 127) * 100;
        const yPct = (1 - ((w.valY !== undefined ? w.valY : 64) / 127)) * 100;
        bodyWrap.innerHTML = `
          <div class="xy-pad ${w.color ? `color-${w.color}` : ''}" style="width:100%; height:100%; min-height:80px; flex:1;" data-id="${w.id}">
            <div class="xy-crosshair-h"></div>
            <div class="xy-crosshair-v"></div>
            <div class="xy-cursor" style="left:${xPct}%; top:${yPct}%; width:20px; height:20px;"></div>
          </div>
        `;
        this.bindCustomXYEvents(bodyWrap.querySelector('.xy-pad'), w);
      }

      card.appendChild(bodyWrap);

      // Interactive Resize Corner Handle - ONLY in Edit Mode on desktop!
      if (this.isDesignMode) {
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'widget-resize-handle';
        resizeHandle.title = 'Drag corner to resize component (⤡)';
        this.bindResizeHandle(resizeHandle, card, w);
        card.appendChild(resizeHandle);
      }

      canvas.appendChild(card);

      // Update internal responsive geometry (knob dial scaling, fader travel)
      this.updateComponentInternalGeometry(card, w);
    });

    // Secondary pass once full DOM render / layout calculation occurs
    requestAnimationFrame(() => {
      this.customWidgets.forEach((w) => {
        const card = canvas.querySelector(`.widget-card[data-id="${w.id}"]`);
        if (card) this.updateComponentInternalGeometry(card, w);
      });
    });

    this.updateStatusStrip();
  }

  // --- WIDGET EVENT BINDINGS ---

  bindCustomKnobEvents(knobEl, widget) {
    let startY = 0;
    let startVal = widget.value;

    const onPointerDown = (e) => {
      e.stopPropagation();
      if (this.isDesignMode && !this.selectedWidgetIds.has(widget.id)) {
        this.selectWidget(widget.id, e.shiftKey || e.ctrlKey);
      }
      try { knobEl.setPointerCapture(e.pointerId); } catch (_) {}
      startY = e.clientY;
      startVal = widget.value;
    };

    const onPointerMove = (e) => {
      if (knobEl.hasPointerCapture(e.pointerId)) {
        const delta = (startY - e.clientY);
        const range = (widget.maxVal - widget.minVal) || 127;
        // 250px travel for full 0..127 range (analog studio feel); 750px if Shift is held for fine tuning
        const travel = e.shiftKey ? 750 : 250;
        const step = Math.round((delta / travel) * range);
        const newVal = Math.max(widget.minVal, Math.min(widget.maxVal, startVal + step));

        if (newVal !== widget.value) {
          widget.value = newVal;
          const dial = knobEl.querySelector('.custom-knob-dial');
          const valLabel = knobEl.querySelector('.custom-knob-value');
          const angle = -135 + ((newVal - widget.minVal) / (((widget.maxVal - widget.minVal) || 127))) * 270;
          if (dial) dial.style.transform = `rotate(${angle}deg)`;
          if (valLabel) valLabel.textContent = newVal;

          this.dispatchCustomWidgetMidi(widget, newVal);
          this.throttleJsonSync(widget.id, {
            type: 'widget_update',
            id: widget.id,
            val: newVal,
            msgType: widget.msgType,
            channel: widget.channel,
            num: widget.midiNum
          });
        }
      }
    };

    knobEl.addEventListener('pointerdown', onPointerDown);
    knobEl.addEventListener('pointermove', onPointerMove);
  }

  bindCustomFaderEvents(faderEl, widget, labelEl) {
    let cachedRect = null;

    const updateFader = (e) => {
      const rect = cachedRect || faderEl.getBoundingClientRect();
      const thumb = faderEl.querySelector('.custom-fader-thumb');
      const thumbH = thumb ? (thumb.offsetHeight || 28) : 28;
      const totalH = rect.height || faderEl.clientHeight || 100;
      const travel = Math.max(1, totalH - thumbH);

      const relY = Math.max(0, Math.min(travel, (rect.bottom - e.clientY - (thumbH / 2))));
      const frac = Math.max(0, Math.min(1, relY / travel));
      const range = (widget.maxVal - widget.minVal) || 127;
      const newVal = Math.round(widget.minVal + frac * range);

      if (newVal !== widget.value) {
        widget.value = newVal;
        if (thumb) {
          thumb.style.bottom = `${relY}px`;
        }
        if (labelEl) labelEl.textContent = newVal;

        this.dispatchCustomWidgetMidi(widget, newVal);
        this.throttleJsonSync(widget.id, {
          type: 'widget_update',
          id: widget.id,
          val: newVal,
          msgType: widget.msgType,
          channel: widget.channel,
          num: widget.midiNum
        });
      }
    };

    faderEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.isDesignMode && !this.selectedWidgetIds.has(widget.id)) {
        this.selectWidget(widget.id, e.shiftKey || e.ctrlKey);
      }
      try { faderEl.setPointerCapture(e.pointerId); } catch (_) {}
      cachedRect = faderEl.getBoundingClientRect();
      updateFader(e);
    });

    faderEl.addEventListener('pointermove', (e) => {
      if (faderEl.hasPointerCapture(e.pointerId)) updateFader(e);
    });

    const releaseFader = () => { cachedRect = null; };
    faderEl.addEventListener('pointerup', releaseFader);
    faderEl.addEventListener('pointercancel', releaseFader);
  }

  bindCustomButtonEvents(btnEl, widget) {
    if (widget.behavior === 'toggle') {
      btnEl.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (this.isDesignMode && !this.selectedWidgetIds.has(widget.id)) {
          this.selectWidget(widget.id, e.shiftKey || e.ctrlKey);
        }
        const isCurrentlyActive = widget.value > widget.minVal;
        const newVal = isCurrentlyActive ? widget.minVal : widget.maxVal;
        widget.value = newVal;
        btnEl.classList.toggle('pressed', newVal > widget.minVal);
        if (newVal > widget.minVal) {
          this.dispatchCustomWidgetMidi(widget, widget.maxVal);
          this.throttleJsonSync(widget.id, {
            type: 'widget_update',
            id: widget.id,
            val: widget.maxVal,
            msgType: widget.msgType,
            channel: widget.channel,
            num: widget.midiNum
          });
        } else {
          if (widget.msgType === 'note') {
            this.sendNoteOff(widget.midiNum, widget.channel);
          } else {
            this.dispatchCustomWidgetMidi(widget, widget.minVal);
          }
          this.throttleJsonSync(widget.id, {
            type: 'widget_update',
            id: widget.id,
            val: widget.minVal,
            msgType: widget.msgType,
            channel: widget.channel,
            num: widget.midiNum
          });
        }
      });
      return;
    }

    // Default: momentary
    btnEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.isDesignMode && !this.selectedWidgetIds.has(widget.id)) {
        this.selectWidget(widget.id, e.shiftKey || e.ctrlKey);
      }
      try { btnEl.setPointerCapture(e.pointerId); } catch (_) {}
      btnEl.classList.add('pressed');
      widget.value = widget.maxVal;
      this.dispatchCustomWidgetMidi(widget, widget.maxVal);
      this.throttleJsonSync(widget.id, {
        type: 'widget_update',
        id: widget.id,
        val: widget.maxVal,
        msgType: widget.msgType,
        channel: widget.channel,
        num: widget.midiNum
      });
    });

    const release = () => {
      if (!btnEl.classList.contains('pressed')) return;
      btnEl.classList.remove('pressed');
      widget.value = widget.minVal;
      if (widget.msgType === 'note') {
        this.sendNoteOff(widget.midiNum, widget.channel);
      } else {
        this.dispatchCustomWidgetMidi(widget, widget.minVal);
      }
      this.throttleJsonSync(widget.id, {
        type: 'widget_update',
        id: widget.id,
        val: widget.minVal,
        msgType: widget.msgType,
        channel: widget.channel,
        num: widget.midiNum
      });
    };

    btnEl.addEventListener('pointerup', release);
    btnEl.addEventListener('pointercancel', release);
  }

  bindCustomToggleEvents(toggleWrap, widget) {
    const toggleEl = toggleWrap.querySelector('.custom-toggle-surface') || toggleWrap;
    const stateTxt = toggleWrap.querySelector('.custom-toggle-state-text');

    toggleWrap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.isDesignMode && !this.selectedWidgetIds.has(widget.id)) {
        this.selectWidget(widget.id, e.shiftKey || e.ctrlKey);
      }
      const isActive = toggleEl.classList.toggle('active');
      if (stateTxt) {
        stateTxt.textContent = isActive ? 'ON' : 'OFF';
      }
      widget.value = isActive ? widget.maxVal : widget.minVal;
      this.dispatchCustomWidgetMidi(widget, widget.value);
      this.throttleJsonSync(widget.id, {
        type: 'widget_update',
        id: widget.id,
        val: widget.value,
        msgType: widget.msgType,
        channel: widget.channel,
        num: widget.midiNum
      });
    });
  }

  bindCustomPadEvents(padEl, widget) {
    padEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.isDesignMode && !this.selectedWidgetIds.has(widget.id)) {
        this.selectWidget(widget.id, e.shiftKey || e.ctrlKey);
      }
      try { padEl.setPointerCapture(e.pointerId); } catch (_) {}
      padEl.classList.add('hit');

      // Strike velocity from vertical touch location
      const rect = padEl.getBoundingClientRect();
      const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / (rect.height || 1)));
      const vel = Math.round(50 + (relY * 77));

      widget.value = vel;
      this.sendNoteOn(widget.midiNum, vel, widget.channel);
      this.throttleJsonSync(widget.id, {
        type: 'widget_update',
        id: widget.id,
        val: vel,
        msgType: 'note',
        channel: widget.channel,
        num: widget.midiNum
      });
    });

    const releasePad = () => {
      padEl.classList.remove('hit');
      widget.value = 0;
      this.sendNoteOff(widget.midiNum, widget.channel);
      this.throttleJsonSync(widget.id, {
        type: 'widget_update',
        id: widget.id,
        val: 0,
        msgType: 'note',
        channel: widget.channel,
        num: widget.midiNum
      });
    };

    padEl.addEventListener('pointerup', releasePad);
    padEl.addEventListener('pointercancel', releasePad);
  }

  bindCustomXYEvents(padEl, widget) {
    const cursor = padEl.querySelector('.xy-cursor');
    let cachedRect = null;

    const updateXY = (e) => {
      const rect = cachedRect || padEl.getBoundingClientRect();
      const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
      const yPct = Math.max(0, Math.min(1, (e.clientY - rect.top) / (rect.height || 1)));

      const valX = Math.round(xPct * 127);
      const valY = Math.round((1 - yPct) * 127);

      if (valX !== widget.valX || valY !== widget.valY) {
        widget.valX = valX;
        widget.valY = valY;

        if (cursor) {
          cursor.style.left = `${xPct * 100}%`;
          cursor.style.top = `${yPct * 100}%`;
        }

        this.sendControlChange(widget.midiNum, valX, widget.channel);
        this.sendControlChange(widget.midiNum + 1, valY, widget.channel);

        this.throttleJsonSync(widget.id, {
          type: 'widget_update',
          id: widget.id,
          val: valX,
          valX: valX,
          valY: valY,
          msgType: widget.msgType,
          channel: widget.channel,
          num: widget.midiNum
        });
      }
    };

    padEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.isDesignMode && !this.selectedWidgetIds.has(widget.id)) {
        this.selectWidget(widget.id, e.shiftKey || e.ctrlKey);
      }
      try { padEl.setPointerCapture(e.pointerId); } catch (_) {}
      cachedRect = padEl.getBoundingClientRect();
      updateXY(e);
    });

    padEl.addEventListener('pointermove', (e) => {
      if (padEl.hasPointerCapture(e.pointerId)) updateXY(e);
    });

    const releaseXY = () => { cachedRect = null; };
    padEl.addEventListener('pointerup', releaseXY);
    padEl.addEventListener('pointercancel', releaseXY);
  }

  dispatchCustomWidgetMidi(widget, val) {
    // 1. Direct Low-Latency Binary MIDI to DAW (Immediate, 0ms latency)
    if (widget.msgType === 'cc') {
      this.sendControlChange(widget.midiNum, val, widget.channel);
    } else if (widget.msgType === 'note') {
      this.sendNoteOn(widget.midiNum, val, widget.channel);
    } else if (widget.msgType === 'pitch') {
      const val14 = Math.round((val / 127) * 16383);
      this.sendPitchBend(val14, widget.channel);
    }

    // 2. Throttled JSON sync for connected phones/performers
    // Prevents network flooding during fast dragging
    this.throttleJsonSync(widget.id, {
      type: 'widget_update',
      id: widget.id,
      val: val,
      msgType: widget.msgType,
      channel: widget.channel,
      num: widget.midiNum
    });
  }

  throttleJsonSync(id, payload) {
    if (!this.syncTimers) this.syncTimers = {};
    if (this.syncTimers[id]) return;

    this.sendJson(payload);
    this.syncTimers[id] = setTimeout(() => {
      delete this.syncTimers[id];
    }, 35); // 35ms throttle ~ 28 updates/sec for multi-device sync, while binary MIDI is 100% immediate
  }

  applyRemoteWidgetUpdate(id, val, msgType, channel, num, extraData = null) {
    let w = this.customWidgets.find(x => x.id === id);
    if (!w && this.layoutData && Array.isArray(this.layoutData.pages)) {
      for (const p of this.layoutData.pages) {
        w = p.widgets.find(x => x.id === id);
        if (w) break;
      }
    }
    if (!w && msgType !== undefined && channel !== undefined && num !== undefined) {
      w = this.customWidgets.find(x => x.msgType === msgType && x.channel === channel && x.midiNum === num);
      if (!w && this.layoutData && Array.isArray(this.layoutData.pages)) {
        for (const p of this.layoutData.pages) {
          w = p.widgets.find(x => x.msgType === msgType && x.channel === channel && x.midiNum === num);
          if (w) break;
        }
      }
    }
    if (w) {
      w.value = val;
      if (extraData && extraData.valX !== undefined) {
        w.valX = extraData.valX;
        w.valY = extraData.valY;
      }
      this.updateWidgetDOM(w, val);
    }
  }

  bindCardDrag(card, widget) {
    const header = card.querySelector('.widget-card-header');
    if (!header) return;

    let startPointerX = 0, startPointerY = 0;
    let isDragging = false;
    let startPositions = new Map();

    const onPointerDown = (e) => {
      if (!this.isDesignMode) return;
      if (e.target.closest('button') || e.target.closest('.btn-card-opts')) return;

      e.stopPropagation();
      e.preventDefault();
      try { header.setPointerCapture(e.pointerId); } catch (_) {}

      // If clicked card is not in current multi-selection, select it (unless Shift/Ctrl held)
      if (!this.selectedWidgetIds.has(widget.id)) {
        this.selectWidget(widget.id, e.shiftKey || e.ctrlKey);
      }

      this.pushUndoHistory();
      isDragging = true;

      startPointerX = e.clientX;
      startPointerY = e.clientY;

      startPositions.clear();
      this.selectedWidgetIds.forEach(id => {
        const w = this.customWidgets.find(x => x.id === id);
        if (w) {
          startPositions.set(id, { x: w.x || 0, y: w.y || 0 });
          const c = document.querySelector(`.widget-card[data-id="${id}"]`);
          if (c) c.classList.add('dragging');
        }
      });
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startPointerX;
      const dy = e.clientY - startPointerY;

      // Prevent dragging any widget off canvas (left/top < 0)
      let minStartX = Infinity;
      let minStartY = Infinity;
      startPositions.forEach(pos => {
        if (pos.x < minStartX) minStartX = pos.x;
        if (pos.y < minStartY) minStartY = pos.y;
      });

      const clampedDx = Math.max(-minStartX, dx);
      const clampedDy = Math.max(-minStartY, dy);

      startPositions.forEach((pos, id) => {
        const w = this.customWidgets.find(x => x.id === id);
        if (w) {
          const newX = Math.round(pos.x + clampedDx);
          const newY = Math.round(pos.y + clampedDy);
          w.x = newX;
          w.y = newY;
          const c = document.querySelector(`.widget-card[data-id="${id}"]`);
          if (c) {
            c.style.setProperty('--widget-x', `${newX}px`);
            c.style.setProperty('--widget-y', `${newY}px`);
          }
        }
      });

      if (this.selectedWidgetId === widget.id) {
        const inX = document.getElementById('inspPosX');
        const inY = document.getElementById('inspPosY');
        if (inX && document.activeElement !== inX) inX.value = widget.x;
        if (inY && document.activeElement !== inY) inY.value = widget.y;
      }
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      this.selectedWidgetIds.forEach(id => {
        const c = document.querySelector(`.widget-card[data-id="${id}"]`);
        if (c) c.classList.remove('dragging');
      });
      try { header.releasePointerCapture(e.pointerId); } catch (_) {}

      this.updateCanvasBounds();
      this.saveLayoutToStorage();
      this.broadcastLayoutSync();
    };

    header.addEventListener('pointerdown', onPointerDown);
    header.addEventListener('pointermove', onPointerMove);
    header.addEventListener('pointerup', onPointerUp);
    header.addEventListener('pointercancel', onPointerUp);
  }

  bindResizeHandle(handle, card, widget) {
    let startX = 0, startY = 0;
    let startWidth = 0, startHeight = 0;
    let isResizing = false;
    let tooltip = null;

    const onPointerDown = (e) => {
      if (!this.isDesignMode) return;
      e.stopPropagation();
      e.preventDefault();
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      this.pushUndoHistory();
      isResizing = true;
      card.classList.add('resizing');
      startX = e.clientX;
      startY = e.clientY;

      startWidth = widget.w || card.offsetWidth || 180;
      startHeight = widget.h || card.offsetHeight || 220;
      this.selectWidget(widget.id);

      tooltip = document.createElement('div');
      tooltip.className = 'widget-resize-tooltip';
      tooltip.textContent = `${startWidth} × ${startHeight} px`;
      card.appendChild(tooltip);
    };

    const onPointerMove = (e) => {
      if (!isResizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const newWidth = Math.max(80, Math.min(2400, Math.round(startWidth + dx)));
      const newHeight = Math.max(60, Math.min(2400, Math.round(startHeight + dy)));

      widget.w = newWidth;
      widget.h = newHeight;

      card.style.setProperty('--widget-w', `${newWidth}px`);
      card.style.setProperty('--widget-h', `${newHeight}px`);

      if (tooltip) {
        tooltip.textContent = `${newWidth} × ${newHeight} px`;
      }

      // Responsive update of internal dial/fader/pad components in real time!
      this.updateComponentInternalGeometry(card, widget);

      // Update inspector size inputs and badge
      if (this.selectedWidgetId === widget.id) {
        const inW = document.getElementById('inspWidth');
        const inH = document.getElementById('inspHeight');
        const badge = document.getElementById('inspDimensionsBadge');
        if (inW && document.activeElement !== inW) inW.value = newWidth;
        if (inH && document.activeElement !== inH) inH.value = newHeight;
        if (badge) badge.textContent = `${newWidth} × ${newHeight} px`;
      }
    };

    const onPointerUp = (e) => {
      if (!isResizing) return;
      isResizing = false;
      card.classList.remove('resizing');
      if (tooltip) {
        tooltip.remove();
        tooltip = null;
      }
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      this.updateCanvasBounds();
      this.saveLayoutToStorage();
      this.broadcastLayoutSync();
    };

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
  }

  updateComponentInternalGeometry(card, widget) {
    if (!card || !widget) return;
    if (widget.type === 'knob') {
      const knobSurface = card.querySelector('.custom-knob-surface');
      if (knobSurface) {
        const availW = Math.max(48, (widget.w || 180) - 24);
        const availH = Math.max(48, (widget.h || 220) - 48);
        const dialSize = Math.max(48, Math.min(availW, availH));
        knobSurface.style.width = `${dialSize}px`;
        knobSurface.style.height = `${dialSize}px`;

        const valLabel = knobSurface.querySelector('.custom-knob-value');
        if (valLabel) {
          valLabel.style.fontSize = `${Math.max(10, Math.round(dialSize * 0.18))}px`;
        }
      }
    } else if (widget.type === 'fader') {
      const faderSurface = card.querySelector('.custom-fader-surface');
      const thumb = card.querySelector('.custom-fader-thumb');
      if (faderSurface && thumb) {
        const thumbH = thumb.offsetHeight || 28;
        const surfaceH = faderSurface.clientHeight || Math.max(60, (widget.h || 220) - 52);
        const travel = Math.max(1, surfaceH - thumbH);
        const range = (widget.maxVal - widget.minVal) || 127;
        const bottomPx = ((widget.value - widget.minVal) / range) * travel;
        thumb.style.bottom = `${bottomPx}px`;
      }
    } else if (widget.type === 'pad') {
      const padText = card.querySelector('.custom-pad-text');
      if (padText) {
        const minDim = Math.min(widget.w || 180, widget.h || 180);
        padText.style.fontSize = `${Math.max(10, Math.min(22, Math.round(minDim * 0.09)))}px`;
      }
    } else if (widget.type === 'button') {
      const btnLabel = card.querySelector('.custom-btn-label');
      if (btnLabel) {
        const minDim = Math.min(widget.w || 180, widget.h || 120);
        btnLabel.style.fontSize = `${Math.max(10, Math.min(16, Math.round(minDim * 0.1)))}px`;
      }
    }
  }

  updateWidgetsFromMidi(msgType, channel, num, val) {
    if (!this.layoutData || !this.layoutData.pages) return;
    let anyChanged = false;
    this.layoutData.pages.forEach(p => {
      p.widgets.forEach(w => {
        if (w.msgType === msgType && w.channel === channel) {
          if (msgType === 'pitch' || w.midiNum === num) {
            w.value = val;
            anyChanged = true;
            // If belongs to active page, update DOM immediately without echo
            if (p === this.activePage) {
              this.updateWidgetDOM(w, val);
            }
          }
        }
      });
    });
    if (anyChanged) {
      try {
        localStorage.setItem('vlive_custom_layout_v2', JSON.stringify(this.layoutData));
      } catch (_) {}
    }
  }

  updateWidgetDOM(w, val) {
    if (this.selectedWidgetId === w.id) {
      const liveSlider = document.getElementById('inspLiveSlider');
      const liveVal = document.getElementById('inspLiveValDisplay');
      if (liveSlider && document.activeElement !== liveSlider) {
        liveSlider.value = val;
      }
      if (liveVal) liveVal.textContent = val;
    }

    const card = document.querySelector(`.widget-card[data-id="${w.id}"]`);
    if (!card) return;

    if (w.type === 'knob') {
      const dial = card.querySelector('.custom-knob-dial');
      const valLabel = card.querySelector('.custom-knob-value');
      const range = (w.maxVal - w.minVal) || 127;
      const frac = Math.max(0, Math.min(1, (val - (w.minVal || 0)) / range));
      const angle = -135 + frac * 270;
      if (dial) dial.style.transform = `rotate(${angle}deg)`;
      if (valLabel) valLabel.textContent = val;
    } else if (w.type === 'fader') {
      const thumb = card.querySelector('.custom-fader-thumb');
      const faderEl = card.querySelector('.custom-fader-surface');
      const valLabel = card.querySelector('.custom-fader-val') || card.querySelector('.custom-knob-value');
      const range = (w.maxVal - w.minVal) || 127;
      if (thumb && faderEl) {
        const thumbH = thumb.offsetHeight || 28;
        const travel = Math.max(1, faderEl.clientHeight - thumbH);
        const bottomPx = ((val - w.minVal) / range) * travel;
        thumb.style.bottom = `${bottomPx}px`;
      } else if (thumb) {
        const pct = ((val - w.minVal) / range);
        thumb.style.bottom = `calc(${pct * 100}% - ${pct * 28}px)`;
      }
      if (valLabel) valLabel.textContent = val;
    } else if (w.type === 'button') {
      const btn = card.querySelector('.custom-btn-surface');
      if (btn) {
        btn.classList.toggle('pressed', val > w.minVal);
      }
    } else if (w.type === 'toggle') {
      const toggle = card.querySelector('.custom-toggle-surface');
      const stateTxt = card.querySelector('.custom-toggle-state-text');
      const isActive = val >= (w.maxVal / 2);
      if (toggle) {
        toggle.classList.toggle('active', isActive);
      }
      if (stateTxt) {
        stateTxt.textContent = isActive ? 'ON' : 'OFF';
      }
    } else if (w.type === 'pad') {
      const pad = card.querySelector('.custom-pad-surface');
      if (pad) {
        pad.classList.toggle('hit', val > 0);
      }
    } else if (w.type === 'xy') {
      const cursor = card.querySelector('.xy-cursor');
      if (cursor && w.valX !== undefined && w.valY !== undefined) {
        cursor.style.left = `${(w.valX / 127) * 100}%`;
        cursor.style.top = `${(1 - (w.valY / 127)) * 100}%`;
      }
    }
  }

  initCanvasMarquee() {
    const viewport = document.getElementById('builderCanvasViewport');
    const marquee = document.getElementById('canvasMarqueeBox');
    if (!viewport || !marquee) return;

    let isMarqueeDragging = false;
    let startX = 0, startY = 0;
    let isAdditive = false;
    let initialSelected = new Set();

    viewport.addEventListener('pointerdown', (e) => {
      if (!this.isDesignMode) return;
      if (e.button !== 0) return; // Left-click only
      // Don't start marquee if user clicked on a widget card, context menu, button, or options
      if (e.target.closest('.widget-card') || e.target.closest('#canvasContextMenu') || e.target.closest('button')) {
        return;
      }

      isAdditive = e.shiftKey || e.ctrlKey;
      if (!isAdditive) {
        this.deselectAll();
      }
      this.closeContextMenu();

      isMarqueeDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialSelected = new Set(this.selectedWidgetIds);

      marquee.style.display = 'none';
      marquee.style.left = `${startX}px`;
      marquee.style.top = `${startY}px`;
      marquee.style.width = '0px';
      marquee.style.height = '0px';
    });

    window.addEventListener('pointermove', (e) => {
      if (!isMarqueeDragging) return;

      const curX = e.clientX;
      const curY = e.clientY;
      const left = Math.min(startX, curX);
      const top = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);

      if (width > 4 || height > 4) {
        marquee.style.display = 'block';
        marquee.style.left = `${left}px`;
        marquee.style.top = `${top}px`;
        marquee.style.width = `${width}px`;
        marquee.style.height = `${height}px`;

        const cards = document.querySelectorAll('.builder-canvas .widget-card');
        const intersectedIds = new Set();
        cards.forEach(card => {
          const r = card.getBoundingClientRect();
          const inBox = !(
            r.right < left ||
            r.left > left + width ||
            r.bottom < top ||
            r.top > top + height
          );
          if (inBox && card.dataset.id) {
            intersectedIds.add(card.dataset.id);
          }
        });

        if (isAdditive) {
          this.selectedWidgetIds = new Set([...initialSelected, ...intersectedIds]);
        } else {
          this.selectedWidgetIds = intersectedIds;
        }

        this.selectedWidgetId = this.selectedWidgetIds.size > 0 ? this.selectedWidgetIds.values().next().value : null;
        this.updateSelectionDOM();
      }
    });

    const finishMarquee = () => {
      if (!isMarqueeDragging) return;
      isMarqueeDragging = false;
      marquee.style.display = 'none';
      this.updateSelectionDOM();
      this.updateInspectorForSelection();
      if (this.selectedWidgetIds.size > 1) {
        this.showEditingToast(`Selected ${this.selectedWidgetIds.size} controls`);
      }
    };

    window.addEventListener('pointerup', finishMarquee);
    window.addEventListener('pointercancel', finishMarquee);
  }

  initCanvasContextMenu() {
    const viewport = document.getElementById('builderCanvasViewport');
    const menu = document.getElementById('canvasContextMenu');
    if (!viewport || !menu) return;

    this.contextMenuPos = { x: 40, y: 40 };

    viewport.addEventListener('contextmenu', (e) => {
      if (!this.isDesignMode) return;
      // Do not trigger empty-space context menu if right clicking a widget card
      if (e.target.closest('.widget-card')) return;

      e.preventDefault();
      e.stopPropagation();

      const canvas = document.getElementById('builderCanvas');
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const zoom = (this.canvasZoom && this.canvasZoom > 0) ? this.canvasZoom : 1.0;
        this.contextMenuPos = {
          x: Math.max(10, Math.round((e.clientX - rect.left) / zoom)),
          y: Math.max(10, Math.round((e.clientY - rect.top) / zoom))
        };
      } else {
        this.contextMenuPos = { x: 40, y: 40 };
      }

      const hasClipboard = (this.clipboardWidgets && this.clipboardWidgets.length > 0) || !!this.clipboardWidget;
      const pasteSep = document.getElementById('contextMenuPasteSep');
      const pasteItem = document.getElementById('contextMenuPaste');
      if (pasteSep) pasteSep.style.display = hasClipboard ? 'block' : 'none';
      if (pasteItem) pasteItem.style.display = hasClipboard ? 'flex' : 'none';

      menu.style.display = 'block';
      const menuW = menu.offsetWidth || 190;
      const menuH = menu.offsetHeight || 260;
      let posX = e.clientX;
      let posY = e.clientY;
      if (posX + menuW > window.innerWidth - 8) posX = window.innerWidth - menuW - 8;
      if (posY + menuH > window.innerHeight - 8) posY = window.innerHeight - menuH - 8;
      menu.style.left = `${posX}px`;
      menu.style.top = `${posY}px`;
    });

    document.addEventListener('pointerdown', (e) => {
      if (menu.style.display !== 'none' && !menu.contains(e.target)) {
        this.closeContextMenu();
      }
    });

    viewport.addEventListener('scroll', () => this.closeContextMenu(), { passive: true });

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.context-menu-item');
      if (!item) return;
      const action = item.dataset.action;
      const type = item.dataset.type;

      if (action === 'add' && type) {
        this.addCustomWidget(type, this.contextMenuPos.x, this.contextMenuPos.y);
      } else if (action === 'paste') {
        this.pasteWidget(this.contextMenuPos.x, this.contextMenuPos.y);
      }

      this.closeContextMenu();
    });
  }

  closeContextMenu() {
    const menu = document.getElementById('canvasContextMenu');
    if (menu) menu.style.display = 'none';
  }

  // --- PAGE TABS CONTEXT MENU ---

  initPageContextMenu() {
    const menu = document.getElementById('pageContextMenu');
    if (!menu) return;

    this.contextMenuPageIndex = null;

    menu.addEventListener('click', async (e) => {
      const item = e.target.closest('.context-menu-item');
      if (!item) return;
      const action = item.dataset.pageAction;
      const idx = this.contextMenuPageIndex;
      this.closePageContextMenu();

      if (idx === null || idx === undefined || !this.layoutData.pages || !this.layoutData.pages[idx]) return;

      if (action === 'rename') {
        const curName = this.layoutData.pages[idx].name || '';
        const newName = await this.showPrompt('RENAME PAGE', 'Enter new name for this page set:', curName);
        if (newName && newName.trim()) {
          this.layoutData.pages[idx].name = newName.trim();
          this.renderPageTabs();
          this.saveLayoutToStorage(true);
          this.broadcastLayoutSync();
          this.showEditingToast(`Renamed to "${newName.trim()}"`);
        }
      } else if (action === 'duplicate') {
        this.duplicatePage(idx);
      } else if (action === 'options') {
        this.openPageOptions(idx);
      } else if (action === 'delete') {
        this.deletePage(idx);
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#pageContextMenu')) {
        this.closePageContextMenu();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closePageContextMenu();
      }
    });
  }

  openPageContextMenu(index, clientX, clientY) {
    this.closeContextMenu();
    const menu = document.getElementById('pageContextMenu');
    if (!menu) return;

    this.contextMenuPageIndex = index;
    const page = this.layoutData.pages ? this.layoutData.pages[index] : null;
    const titleEl = document.getElementById('pageContextMenuTitle');
    if (titleEl && page) {
      titleEl.textContent = page.name ? page.name.toUpperCase() : `PAGE ${index + 1}`;
    }

    menu.style.display = 'block';
    menu.style.visibility = 'hidden';

    requestAnimationFrame(() => {
      const menuW = menu.offsetWidth || 180;
      const menuH = menu.offsetHeight || 150;
      const winW = window.innerWidth;
      const winH = window.innerHeight;

      let posX = clientX;
      let posY = clientY;

      if (posX + menuW > winW - 10) posX = winW - menuW - 10;
      if (posY + menuH > winH - 10) posY = winH - menuH - 10;
      if (posX < 10) posX = 10;
      if (posY < 10) posY = 10;

      menu.style.left = `${posX}px`;
      menu.style.top = `${posY}px`;
      menu.style.visibility = 'visible';
    });
  }

  closePageContextMenu() {
    const menu = document.getElementById('pageContextMenu');
    if (menu) menu.style.display = 'none';
    this.contextMenuPageIndex = null;
  }

  // --- RIGHT PANEL DOCK & CONTROL INSPECTOR ---

  switchDockTab(tab) {
    if (tab === 'inspector' && !this.isDesignMode) {
      tab = 'qr';
    }
    this.activeDockTab = tab;
    const inspectorView = document.getElementById('dockInspectorView');
    const qrView = document.getElementById('dockQrView');
    const btnTabInspector = document.getElementById('btnTabInspector');
    const btnTabQr = document.getElementById('btnTabQr');

    if (tab === 'inspector') {
      if (inspectorView) inspectorView.style.display = 'block';
      if (qrView) qrView.style.display = 'none';
      if (btnTabInspector) btnTabInspector.classList.add('active');
      if (btnTabQr) btnTabQr.classList.remove('active');
    } else {
      if (inspectorView) inspectorView.style.display = 'none';
      if (qrView) qrView.style.display = 'block';
      if (btnTabInspector) btnTabInspector.classList.remove('active');
      if (btnTabQr) btnTabQr.classList.add('active');
      this.refreshQrCode();
    }
  }

  selectWidget(id, isToggle = false) {
    if (!id) {
      this.deselectAll();
      return;
    }
    if (isToggle) {
      if (this.selectedWidgetIds.has(id)) {
        this.selectedWidgetIds.delete(id);
      } else {
        this.selectedWidgetIds.add(id);
      }
    } else {
      this.selectedWidgetIds.clear();
      this.selectedWidgetIds.add(id);
    }

    this.selectedWidgetId = this.selectedWidgetIds.size > 0 ? Array.from(this.selectedWidgetIds)[0] : null;
    this.updateSelectionDOM();
    this.updateInspectorForSelection();
  }

  deselectAll() {
    this.selectedWidgetIds.clear();
    this.selectedWidgetId = null;
    this.updateSelectionDOM();
    this.updateInspectorForSelection();
  }

  updateSelectionDOM() {
    document.querySelectorAll('.widget-card').forEach(card => {
      card.classList.toggle('selected', this.selectedWidgetIds.has(card.dataset.id));
    });
  }

  updateInspectorForSelection() {
    const emptyState = document.getElementById('inspectorEmptyState');
    const content = document.getElementById('inspectorContent');

    if (!this.selectedWidgetId || this.selectedWidgetIds.size === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      if (content) content.style.display = 'none';
      return;
    }

    const widget = this.customWidgets.find(w => w.id === this.selectedWidgetId);
    if (!widget) {
      if (emptyState) emptyState.style.display = 'flex';
      if (content) content.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (content) content.style.display = 'block';

    const typeBadge = document.getElementById('inspWidgetTypeBadge');
    const title = document.getElementById('inspWidgetTitle');
    const labelInput = document.getElementById('inspWidgetLabel');
    const msgTypeSelect = document.getElementById('inspMsgType');
    const channelSelect = document.getElementById('inspChannel');
    const midiNumInput = document.getElementById('inspMidiNum');
    const minInput = document.getElementById('inspMinVal');
    const maxInput = document.getElementById('inspMaxVal');
    const behaviorSelect = document.getElementById('inspBehavior');
    const liveSlider = document.getElementById('inspLiveSlider');
    const liveVal = document.getElementById('inspLiveValDisplay');

    if (typeBadge) {
      typeBadge.textContent = this.selectedWidgetIds.size > 1 ? `${this.selectedWidgetIds.size} CONTROLS` : widget.type.toUpperCase();
    }
    if (title) {
      title.textContent = this.selectedWidgetIds.size > 1 ? `${this.selectedWidgetIds.size} Controls Selected` : widget.label;
    }
    if (labelInput) labelInput.value = widget.label;
    if (msgTypeSelect) msgTypeSelect.value = widget.msgType;
    if (channelSelect) channelSelect.value = widget.channel.toString();
    if (midiNumInput) midiNumInput.value = widget.midiNum;
    if (minInput) minInput.value = widget.minVal !== undefined ? widget.minVal : 0;
    if (maxInput) maxInput.value = widget.maxVal !== undefined ? widget.maxVal : 127;
    if (behaviorSelect) behaviorSelect.value = widget.behavior || 'standard';

    // Freeform Position & Dimensions
    const posXInput = document.getElementById('inspPosX');
    const posYInput = document.getElementById('inspPosY');
    const widthInput = document.getElementById('inspWidth');
    const heightInput = document.getElementById('inspHeight');
    const dimBadge = document.getElementById('inspDimensionsBadge');

    if (posXInput) posXInput.value = widget.x !== undefined ? widget.x : 0;
    if (posYInput) posYInput.value = widget.y !== undefined ? widget.y : 0;
    if (widthInput) widthInput.value = widget.w !== undefined ? widget.w : 180;
    if (heightInput) heightInput.value = widget.h !== undefined ? widget.h : 220;
    if (dimBadge) dimBadge.textContent = `${widget.w || 180} × ${widget.h || 220} px`;

    // Accent color swatches
    document.querySelectorAll('#inspColorSwatches .color-swatch-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === widget.color);
    });

    // Update MIDI helper badge and pill
    this.updateInspectorMidiHelper(widget);

    // Live Slider test
    if (liveSlider) {
      liveSlider.min = widget.minVal !== undefined ? widget.minVal : 0;
      liveSlider.max = widget.maxVal !== undefined ? widget.maxVal : 127;
      liveSlider.value = widget.value !== undefined ? widget.value : 64;
    }
    if (liveVal) {
      liveVal.textContent = widget.value !== undefined ? widget.value : 64;
    }
  }

  updateInspectorMidiHelper(widget) {
    if (!widget) return;
    const midiBadge = document.getElementById('inspMidiHelperBadge');
    const notePill = document.getElementById('inspNoteNameDisplay');
    const midiNumLabel = document.getElementById('inspMidiNumLabel');

    let desc = '';
    if (widget.msgType === 'note') {
      desc = `Note #${widget.midiNum} (${this.getMidiNoteName(widget.midiNum)})`;
      if (midiNumLabel) midiNumLabel.textContent = 'MIDI Note Number (0..127)';
    } else if (widget.msgType === 'cc') {
      desc = `CC #${widget.midiNum}`;
      if (midiNumLabel) midiNumLabel.textContent = 'Control Change # (0..127)';
    } else if (widget.msgType === 'pitch') {
      desc = `Pitch Bend`;
      if (midiNumLabel) midiNumLabel.textContent = 'Pitch Bend (-8192..+8191)';
    }

    if (midiBadge) midiBadge.textContent = desc;
    if (notePill) notePill.textContent = desc;
  }

  initInspector() {
    const labelInput = document.getElementById('inspWidgetLabel');
    const msgTypeSelect = document.getElementById('inspMsgType');
    const channelSelect = document.getElementById('inspChannel');
    const midiNumInput = document.getElementById('inspMidiNum');
    const minInput = document.getElementById('inspMinVal');
    const maxInput = document.getElementById('inspMaxVal');
    const behaviorSelect = document.getElementById('inspBehavior');
    const liveSlider = document.getElementById('inspLiveSlider');
    const liveVal = document.getElementById('inspLiveValDisplay');
    const btnDup = document.getElementById('btnInspDuplicate');
    const btnDel = document.getElementById('btnInspDelete');

    const onInspectorChange = (rebuildCard = false) => {
      const widget = this.customWidgets.find(w => w.id === this.selectedWidgetId);
      if (!widget) return;

      if (labelInput) {
        widget.label = labelInput.value.trim() || `${widget.type.toUpperCase()}`;
        const title = document.getElementById('inspWidgetTitle');
        if (title) title.textContent = widget.label;
      }
      if (msgTypeSelect) widget.msgType = msgTypeSelect.value;
      if (channelSelect) widget.channel = parseInt(channelSelect.value) || 0;
      if (midiNumInput) widget.midiNum = parseInt(midiNumInput.value) || 0;
      if (minInput) widget.minVal = parseInt(minInput.value) || 0;
      if (maxInput) widget.maxVal = parseInt(maxInput.value) || 127;
      if (behaviorSelect) widget.behavior = behaviorSelect.value;

      this.updateInspectorMidiHelper(widget);

      if (liveSlider) {
        liveSlider.min = widget.minVal;
        liveSlider.max = widget.maxVal;
      }

      if (rebuildCard) {
        this.renderBuilderCanvas();
        this.selectWidget(widget.id);
      } else {
        const card = document.querySelector(`.widget-card[data-id="${widget.id}"]`);
        if (card) {
          const t = card.querySelector('.widget-title');
          if (t) t.textContent = widget.label;
          const b = card.querySelector('.widget-midi-badge');
          if (b) {
            b.innerHTML = widget.msgType === 'note'
              ? `Note ${widget.midiNum} &nbsp;|&nbsp; Ch ${widget.channel + 1}`
              : widget.msgType === 'pitch'
                ? `Pitch &nbsp;|&nbsp; Ch ${widget.channel + 1}`
                : `CC #${widget.midiNum} &nbsp;|&nbsp; Ch ${widget.channel + 1}`;
          }
          const btnLabel = card.querySelector('.custom-btn-label');
          if (btnLabel) btnLabel.textContent = widget.label;
          const padText = card.querySelector('.custom-pad-text');
          if (padText) padText.textContent = widget.label;
        }
      }
      this.broadcastLayoutSync();
    };

    if (labelInput) labelInput.addEventListener('input', () => onInspectorChange(false));
    if (msgTypeSelect) msgTypeSelect.addEventListener('change', () => onInspectorChange(true));
    if (channelSelect) channelSelect.addEventListener('change', () => onInspectorChange(false));
    if (midiNumInput) midiNumInput.addEventListener('input', () => onInspectorChange(false));
    if (minInput) minInput.addEventListener('input', () => onInspectorChange(false));
    if (maxInput) maxInput.addEventListener('input', () => onInspectorChange(false));
    if (behaviorSelect) behaviorSelect.addEventListener('change', () => onInspectorChange(true));

    // Freeform Position & Dimension Listeners
    const posXInput = document.getElementById('inspPosX');
    const posYInput = document.getElementById('inspPosY');
    const widthInput = document.getElementById('inspWidth');
    const heightInput = document.getElementById('inspHeight');
    const dimBadge = document.getElementById('inspDimensionsBadge');

    if (posXInput) {
      posXInput.addEventListener('input', () => {
        const widget = this.customWidgets.find(w => w.id === this.selectedWidgetId);
        if (!widget) return;
        widget.x = Math.max(0, parseInt(posXInput.value) || 0);
        const card = document.querySelector(`.widget-card[data-id="${widget.id}"]`);
        if (card) card.style.setProperty('--widget-x', `${widget.x}px`);
        this.saveLayoutToStorage();
        this.broadcastLayoutSync();
      });
    }

    if (posYInput) {
      posYInput.addEventListener('input', () => {
        const widget = this.customWidgets.find(w => w.id === this.selectedWidgetId);
        if (!widget) return;
        widget.y = Math.max(0, parseInt(posYInput.value) || 0);
        const card = document.querySelector(`.widget-card[data-id="${widget.id}"]`);
        if (card) card.style.setProperty('--widget-y', `${widget.y}px`);
        this.saveLayoutToStorage();
        this.broadcastLayoutSync();
      });
    }

    if (widthInput) {
      widthInput.addEventListener('input', () => {
        const widget = this.customWidgets.find(w => w.id === this.selectedWidgetId);
        if (!widget) return;
        widget.w = Math.max(60, parseInt(widthInput.value) || 180);
        const card = document.querySelector(`.widget-card[data-id="${widget.id}"]`);
        if (card) {
          card.style.setProperty('--widget-w', `${widget.w}px`);
          this.updateComponentInternalGeometry(card, widget);
        }
        if (dimBadge) dimBadge.textContent = `${widget.w} × ${widget.h || 220} px`;
        this.saveLayoutToStorage();
        this.broadcastLayoutSync();
      });
    }

    if (heightInput) {
      heightInput.addEventListener('input', () => {
        const widget = this.customWidgets.find(w => w.id === this.selectedWidgetId);
        if (!widget) return;
        widget.h = Math.max(50, parseInt(heightInput.value) || 220);
        const card = document.querySelector(`.widget-card[data-id="${widget.id}"]`);
        if (card) {
          card.style.setProperty('--widget-h', `${widget.h}px`);
          this.updateComponentInternalGeometry(card, widget);
        }
        if (dimBadge) dimBadge.textContent = `${widget.w || 180} × ${widget.h} px`;
        this.saveLayoutToStorage();
        this.broadcastLayoutSync();
      });
    }

    // Quick size preset buttons
    document.querySelectorAll('#quickSizeButtons .btn-quick-size').forEach(btn => {
      btn.addEventListener('click', () => {
        const widget = this.customWidgets.find(w => w.id === this.selectedWidgetId);
        if (!widget) return;
        const wVal = parseInt(btn.dataset.w) || 180;
        const hVal = parseInt(btn.dataset.h) || 220;
        widget.w = wVal;
        widget.h = hVal;
        const card = document.querySelector(`.widget-card[data-id="${widget.id}"]`);
        if (card) {
          card.style.setProperty('--widget-w', `${wVal}px`);
          card.style.setProperty('--widget-h', `${hVal}px`);
          this.updateComponentInternalGeometry(card, widget);
        }
        if (widthInput) widthInput.value = wVal;
        if (heightInput) heightInput.value = hVal;
        if (dimBadge) dimBadge.textContent = `${wVal} × ${hVal} px`;
        this.saveLayoutToStorage();
        this.broadcastLayoutSync();
      });
    });

    // Accent color buttons
    document.querySelectorAll('#inspColorSwatches .color-swatch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const widget = this.customWidgets.find(w => w.id === this.selectedWidgetId);
        if (!widget) return;
        const col = btn.dataset.color;
        widget.color = col;
        document.querySelectorAll('#inspColorSwatches .color-swatch-btn').forEach(b => {
          b.classList.toggle('active', b === btn);
        });
        const card = document.querySelector(`.widget-card[data-id="${widget.id}"]`);
        if (card) {
          card.className = card.className.replace(/\bcolor-\w+/g, '');
          card.classList.add(`color-${col}`);
        }
        this.broadcastLayoutSync();
      });
    });

    // Live Slider
    if (liveSlider) {
      liveSlider.addEventListener('input', (e) => {
        const widget = this.customWidgets.find(w => w.id === this.selectedWidgetId);
        if (!widget) return;
        const val = parseInt(e.target.value) || 0;
        if (val !== widget.value) {
          widget.value = val;
          if (liveVal) liveVal.textContent = val;
          this.dispatchCustomWidgetMidi(widget, val);
          this.updateWidgetDOM(widget, val);
        }
      });
    }

    // Duplicate Button
    if (btnDup) {
      btnDup.addEventListener('click', () => this.duplicateSelectedWidget());
    }

    // Delete Button
    if (btnDel) {
      btnDel.addEventListener('click', () => this.deleteSelectedWidget());
    }
  }

  // --- STAGE & DESIGN EDITING SHORTCUT METHODS ---

  setTargetStage(_stageKey) {
    // Single unified edit mode - responsive auto-scaling handles all screens
  }

  pushUndoHistory() {
    try {
      const snap = JSON.stringify(this.layoutData);
      if (this.historyUndo.length > 0 && this.historyUndo[this.historyUndo.length - 1] === snap) {
        return;
      }
      this.historyUndo.push(snap);
      if (this.historyUndo.length > 30) this.historyUndo.shift();
      this.historyRedo = [];
    } catch (_) {}
  }

  undoLayout() {
    if (!this.isDesignMode) return;
    if (this.historyUndo.length === 0) {
      this.showEditingToast('Nothing to undo');
      return;
    }
    const currentSnap = JSON.stringify(this.layoutData);
    this.historyRedo.push(currentSnap);

    const prevSnap = this.historyUndo.pop();
    try {
      const data = JSON.parse(prevSnap);
      this.layoutData = data;
      this.renderPageTabs();
      this.renderBuilderCanvas();
      this.updateStatusStrip();
      this.saveLayoutToStorage();
      this.broadcastLayoutSync();
      this.showEditingToast('Undid layout edit');
    } catch (e) {
      console.warn('Undo failed:', e);
    }
  }

  redoLayout() {
    if (!this.isDesignMode) return;
    if (this.historyRedo.length === 0) {
      this.showEditingToast('Nothing to redo');
      return;
    }
    const currentSnap = JSON.stringify(this.layoutData);
    this.historyUndo.push(currentSnap);

    const nextSnap = this.historyRedo.pop();
    try {
      const data = JSON.parse(nextSnap);
      this.layoutData = data;
      this.renderPageTabs();
      this.renderBuilderCanvas();
      this.updateStatusStrip();
      this.saveLayoutToStorage();
      this.broadcastLayoutSync();
      this.showEditingToast('Redid layout edit');
    } catch (e) {
      console.warn('Redo failed:', e);
    }
  }

  selectAllWidgets() {
    if (!this.isDesignMode || this.customWidgets.length === 0) return;
    this.selectedWidgetIds.clear();
    this.customWidgets.forEach(w => this.selectedWidgetIds.add(w.id));
    this.selectedWidgetId = this.customWidgets[0].id;
    this.updateSelectionDOM();
    this.updateInspectorForSelection();
    this.showEditingToast(`Selected all ${this.customWidgets.length} controls`);
  }

  copySelectedWidget() {
    if (!this.isDesignMode || this.selectedWidgetIds.size === 0) {
      this.showEditingToast('Select controls to copy');
      return;
    }
    const toCopy = this.customWidgets.filter(w => this.selectedWidgetIds.has(w.id));
    if (toCopy.length === 0) return;
    this.clipboardWidgets = JSON.parse(JSON.stringify(toCopy));
    this.clipboardWidget = this.clipboardWidgets[0];
    const label = toCopy.length === 1 ? `"${toCopy[0].label}"` : `${toCopy.length} controls`;
    this.showEditingToast(`Copied ${label}`);
  }

  pasteWidget(customX = null, customY = null) {
    if (!this.isDesignMode) return;
    const items = (this.clipboardWidgets && this.clipboardWidgets.length > 0)
      ? this.clipboardWidgets
      : (this.clipboardWidget ? [this.clipboardWidget] : []);

    if (items.length === 0) {
      this.showEditingToast('Clipboard empty (press Ctrl+C to copy)');
      return;
    }

    this.pushUndoHistory();

    let minX = Infinity, minY = Infinity;
    items.forEach(w => {
      if ((w.x || 0) < minX) minX = w.x || 0;
      if ((w.y || 0) < minY) minY = w.y || 0;
    });

    const isExplicit = (typeof customX === 'number' && typeof customY === 'number');
    const offsetX = isExplicit ? (customX - minX) : 24;
    const offsetY = isExplicit ? (customY - minY) : 24;

    const newlyPastedIds = new Set();
    const clonedList = items.map((w, idx) => {
      const clone = JSON.parse(JSON.stringify(w));
      clone.id = 'w_' + Date.now() + '_' + idx + '_' + Math.floor(Math.random() * 1000);
      clone.label = items.length === 1 ? `${clone.label} (Copy)` : clone.label;

      let nextX = Math.max(0, (w.x || 0) + offsetX);
      let nextY = Math.max(0, (w.y || 0) + offsetY);
      if (nextX > 3200) nextX = 20;
      if (nextY > 3200) nextY = 20;

      clone.x = nextX;
      clone.y = nextY;

      if (clone.msgType === 'note' || clone.msgType === 'cc') {
        clone.midiNum = Math.min(127, (clone.midiNum || 0) + 1);
      }

      newlyPastedIds.add(clone.id);
      return clone;
    });

    this.customWidgets.push(...clonedList);
    this.saveLayoutToStorage();
    this.renderBuilderCanvas();

    this.selectedWidgetIds = newlyPastedIds;
    this.selectedWidgetId = clonedList[0].id;
    this.updateSelectionDOM();
    this.updateInspectorForSelection();

    this.broadcastLayoutSync();
    const label = clonedList.length === 1 ? `"${clonedList[0].label}"` : `${clonedList.length} controls`;
    this.showEditingToast(`Pasted ${label}`);
  }

  duplicateSelectedWidget() {
    if (!this.isDesignMode || this.selectedWidgetIds.size === 0) {
      this.showEditingToast('Select controls to duplicate');
      return;
    }
    this.copySelectedWidget();
    this.pasteWidget();
  }

  cutSelectedWidget() {
    if (!this.isDesignMode || this.selectedWidgetIds.size === 0) return;
    this.copySelectedWidget();
    this.deleteSelectedWidget();
    this.showEditingToast('Cut controls');
  }

  deleteSelectedWidget() {
    if (!this.isDesignMode || this.selectedWidgetIds.size === 0) return;
    this.pushUndoHistory();

    const count = this.selectedWidgetIds.size;
    const remaining = this.customWidgets.filter(w => !this.selectedWidgetIds.has(w.id));
    this.customWidgets = remaining;

    this.deselectAll();
    if (this.customWidgets.length > 0) {
      this.selectWidget(this.customWidgets[0].id);
    }

    this.updateCanvasBounds();
    this.saveLayoutToStorage();
    this.renderBuilderCanvas();
    this.broadcastLayoutSync();
    this.showEditingToast(`Deleted ${count} control${count > 1 ? 's' : ''}`);
  }

  nudgeSelectedWidget(deltaX, deltaY) {
    if (!this.isDesignMode || this.selectedWidgetIds.size === 0) return;

    let minX = Infinity, minY = Infinity;
    this.selectedWidgetIds.forEach(id => {
      const w = this.customWidgets.find(x => x.id === id);
      if (w) {
        if ((w.x || 0) < minX) minX = w.x || 0;
        if ((w.y || 0) < minY) minY = w.y || 0;
      }
    });

    const clampedDx = (minX + deltaX < 0) ? -minX : deltaX;
    const clampedDy = (minY + deltaY < 0) ? -minY : deltaY;

    this.selectedWidgetIds.forEach(id => {
      const w = this.customWidgets.find(x => x.id === id);
      if (w) {
        w.x = Math.max(0, Math.min(4000, (w.x || 0) + clampedDx));
        w.y = Math.max(0, Math.min(4000, (w.y || 0) + clampedDy));
        const card = document.querySelector(`.widget-card[data-id="${w.id}"]`);
        if (card) {
          card.style.setProperty('--widget-x', `${w.x}px`);
          card.style.setProperty('--widget-y', `${w.y}px`);
        }
      }
    });

    if (this.selectedWidgetId) {
      const activeW = this.customWidgets.find(x => x.id === this.selectedWidgetId);
      if (activeW) {
        const inX = document.getElementById('inspPosX');
        const inY = document.getElementById('inspPosY');
        if (inX && document.activeElement !== inX) inX.value = activeW.x;
        if (inY && document.activeElement !== inY) inY.value = activeW.y;
      }
    }

    this.updateCanvasBounds();
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => {
      this.saveLayoutToStorage();
      this.broadcastLayoutSync();
    }, 120);
  }

  showEditingToast(msg) {
    const toast = document.getElementById('editingToast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 1800);
  }

  showPrompt(title, message, defaultValue = '', placeholder = '') {
    return new Promise((resolve) => {
      const modal = document.getElementById('modalVLiveDialog');
      const titleEl = document.getElementById('vliveDialogTitle');
      const msgEl = document.getElementById('vliveDialogMessage');
      const inputWrap = document.getElementById('vliveDialogInputWrapper');
      const inputEl = document.getElementById('vliveDialogInput');
      const btnCancel = document.getElementById('btnVLiveDialogCancel');
      const btnConfirm = document.getElementById('btnVLiveDialogConfirm');
      const btnClose = document.getElementById('btnVLiveDialogClose');

      if (!modal || !inputEl) {
        const res = window.prompt(message || title, defaultValue);
        return resolve(res);
      }

      titleEl.textContent = title || 'PROMPT';
      msgEl.textContent = message || '';
      inputWrap.style.display = 'flex';
      inputEl.value = defaultValue;
      inputEl.placeholder = placeholder || '';
      btnCancel.style.display = 'inline-block';
      btnCancel.textContent = 'Cancel';
      btnConfirm.textContent = 'OK';
      btnConfirm.className = 'btn-primary';

      const cleanup = () => {
        modal.classList.remove('open');
        modal.style.display = 'none';
        btnConfirm.removeEventListener('click', onConfirm);
        btnCancel.removeEventListener('click', onCancel);
        btnClose.removeEventListener('click', onCancel);
        inputEl.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keydown', onWinKeyDown);
      };

      const onConfirm = () => {
        const val = inputEl.value;
        cleanup();
        resolve(val);
      };

      const onCancel = () => {
        cleanup();
        resolve(null);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onConfirm();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      };

      const onWinKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      };

      btnConfirm.addEventListener('click', onConfirm);
      btnCancel.addEventListener('click', onCancel);
      btnClose.addEventListener('click', onCancel);
      inputEl.addEventListener('keydown', onKeyDown);
      window.addEventListener('keydown', onWinKeyDown);

      modal.style.display = 'flex';
      modal.classList.add('open');
      setTimeout(() => {
        inputEl.focus();
        inputEl.select();
      }, 50);
    });
  }

  showConfirm(title, message, confirmText = 'Confirm', isDanger = false) {
    return new Promise((resolve) => {
      const modal = document.getElementById('modalVLiveDialog');
      const titleEl = document.getElementById('vliveDialogTitle');
      const msgEl = document.getElementById('vliveDialogMessage');
      const inputWrap = document.getElementById('vliveDialogInputWrapper');
      const btnCancel = document.getElementById('btnVLiveDialogCancel');
      const btnConfirm = document.getElementById('btnVLiveDialogConfirm');
      const btnClose = document.getElementById('btnVLiveDialogClose');

      if (!modal) {
        return resolve(window.confirm(message || title));
      }

      titleEl.textContent = title || 'CONFIRM';
      msgEl.textContent = message || '';
      inputWrap.style.display = 'none';
      btnCancel.style.display = 'inline-block';
      btnCancel.textContent = 'Cancel';
      btnConfirm.textContent = confirmText;
      btnConfirm.className = isDanger ? 'btn-primary vlive-dialog-confirm-danger' : 'btn-primary';

      const cleanup = () => {
        modal.classList.remove('open');
        modal.style.display = 'none';
        btnConfirm.removeEventListener('click', onConfirm);
        btnCancel.removeEventListener('click', onCancel);
        btnClose.removeEventListener('click', onCancel);
        window.removeEventListener('keydown', onWinKeyDown);
      };

      const onConfirm = () => {
        cleanup();
        resolve(true);
      };

      const onCancel = () => {
        cleanup();
        resolve(false);
      };

      const onWinKeyDown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onConfirm();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      };

      btnConfirm.addEventListener('click', onConfirm);
      btnCancel.addEventListener('click', onCancel);
      btnClose.addEventListener('click', onCancel);
      window.addEventListener('keydown', onWinKeyDown);

      modal.style.display = 'flex';
      modal.classList.add('open');
      setTimeout(() => btnConfirm.focus(), 50);
    });
  }

  showAlert(title, message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('modalVLiveDialog');
      const titleEl = document.getElementById('vliveDialogTitle');
      const msgEl = document.getElementById('vliveDialogMessage');
      const inputWrap = document.getElementById('vliveDialogInputWrapper');
      const btnCancel = document.getElementById('btnVLiveDialogCancel');
      const btnConfirm = document.getElementById('btnVLiveDialogConfirm');
      const btnClose = document.getElementById('btnVLiveDialogClose');

      if (!modal) {
        window.alert(message || title);
        return resolve();
      }

      titleEl.textContent = title || 'NOTICE';
      msgEl.textContent = message || '';
      inputWrap.style.display = 'none';
      btnCancel.style.display = 'none';
      btnConfirm.textContent = 'OK';
      btnConfirm.className = 'btn-primary';

      const cleanup = () => {
        modal.classList.remove('open');
        modal.style.display = 'none';
        btnConfirm.removeEventListener('click', onConfirm);
        btnClose.removeEventListener('click', onConfirm);
        window.removeEventListener('keydown', onWinKeyDown);
      };

      const onConfirm = () => {
        cleanup();
        resolve();
      };

      const onWinKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          onConfirm();
        }
      };

      btnConfirm.addEventListener('click', onConfirm);
      btnClose.addEventListener('click', onConfirm);
      window.addEventListener('keydown', onWinKeyDown);

      modal.style.display = 'flex';
      modal.classList.add('open');
      setTimeout(() => btnConfirm.focus(), 50);
    });
  }

  // --- INSPECTOR CONFIG MODAL ---

  openWidgetConfig(id) {
    const widget = this.customWidgets.find(w => w.id === id);
    if (!widget) return;
    this.editingWidgetId = id;

    const labelInput = document.getElementById('cfgWidgetLabel');
    const typeSelect = document.getElementById('cfgMsgType');
    const channelSelect = document.getElementById('cfgChannel');
    const midiNumInput = document.getElementById('cfgMidiNum');
    const colorSelect = document.getElementById('cfgColor');
    const minValInput = document.getElementById('cfgMinVal');
    const maxValInput = document.getElementById('cfgMaxVal');
    const behaviorSelect = document.getElementById('cfgBehavior');

    if (labelInput) labelInput.value = widget.label;
    if (typeSelect) typeSelect.value = widget.msgType;
    if (channelSelect) channelSelect.value = widget.channel.toString();
    if (midiNumInput) midiNumInput.value = widget.midiNum;
    if (colorSelect) colorSelect.value = widget.color;
    if (minValInput) minValInput.value = widget.minVal;
    if (maxValInput) maxValInput.value = widget.maxVal;
    if (behaviorSelect) behaviorSelect.value = widget.behavior || 'standard';

    const helper = document.getElementById('cfgNoteNameHelper');
    if (helper) {
      if (widget.msgType === 'note') {
        helper.textContent = `Note #${widget.midiNum} (${this.getMidiNoteName(widget.midiNum)})`;
      } else {
        helper.textContent = `CC #${widget.midiNum}`;
      }
    }

    const modal = document.getElementById('widgetConfigModal');
    if (modal) modal.classList.add('open');
  }

  closeWidgetConfig() {
    this.editingWidgetId = null;
    const modal = document.getElementById('widgetConfigModal');
    if (modal) modal.classList.remove('open');
  }

  saveWidgetConfig() {
    if (!this.editingWidgetId) return;
    const widget = this.customWidgets.find(w => w.id === this.editingWidgetId);
    if (!widget) return;

    const labelInput = document.getElementById('cfgWidgetLabel');
    const typeSelect = document.getElementById('cfgMsgType');
    const channelSelect = document.getElementById('cfgChannel');
    const midiNumInput = document.getElementById('cfgMidiNum');
    const colorSelect = document.getElementById('cfgColor');
    const minValInput = document.getElementById('cfgMinVal');
    const maxValInput = document.getElementById('cfgMaxVal');
    const behaviorSelect = document.getElementById('cfgBehavior');

    if (labelInput) widget.label = labelInput.value.trim() || 'Widget';
    if (typeSelect) widget.msgType = typeSelect.value;
    if (channelSelect) widget.channel = parseInt(channelSelect.value) || 0;
    if (midiNumInput) widget.midiNum = parseInt(midiNumInput.value) || 0;
    if (colorSelect) widget.color = colorSelect.value;
    if (minValInput) widget.minVal = parseInt(minValInput.value) || 0;
    if (maxValInput) widget.maxVal = parseInt(maxValInput.value) || 127;
    if (behaviorSelect) widget.behavior = behaviorSelect.value;

    this.closeWidgetConfig();
    this.renderBuilderCanvas();
    this.broadcastLayoutSync();
  }

  // --- PRESETS, PERSISTENCE & EXPORT ---

  loadDefaultStudioProject() {
    this.layoutData = {
      version: 2,
      activePageIndex: 1, // Start on Deck 2 - Drums matching reference image media_1790935238134.png
      pages: [
        {
          id: 'page_1',
          name: 'Main Deck',
          widgets: [
            { id: 'sw_1', type: 'knob', label: 'Filter Cutoff', msgType: 'cc', channel: 0, midiNum: 74, minVal: 0, maxVal: 127, value: 64, color: 'cyan', behavior: 'standard', x: 20, y: 20, w: 180, h: 220 },
            { id: 'sw_2', type: 'knob', label: 'Resonance', msgType: 'cc', channel: 0, midiNum: 71, minVal: 0, maxVal: 127, value: 40, color: 'cyan', behavior: 'standard', x: 220, y: 20, w: 180, h: 220 },
            { id: 'sw_3', type: 'fader', label: 'Master Vol', msgType: 'cc', channel: 0, midiNum: 7, minVal: 0, maxVal: 127, value: 100, color: 'cyan', behavior: 'standard', x: 420, y: 20, w: 160, h: 260 },
            { id: 'sw_4', type: 'button', label: 'Octave Up', msgType: 'note', channel: 0, midiNum: 72, minVal: 0, maxVal: 127, value: 127, color: 'lime', behavior: 'momentary', x: 600, y: 20, w: 180, h: 120 }
          ]
        },
        {
          id: 'page_2',
          name: 'Deck 2 - Drums',
          widgets: [
            { id: 'w_knob_1', type: 'knob', label: 'KNOB 1', msgType: 'cc', channel: 0, midiNum: 1, minVal: 0, maxVal: 127, value: 64, color: 'cyan', behavior: 'standard', x: 20, y: 20, w: 180, h: 220 },
            { id: 'w_fader_2', type: 'fader', label: 'FADER 2', msgType: 'cc', channel: 0, midiNum: 21, minVal: 0, maxVal: 127, value: 1, color: 'cyan', behavior: 'standard', x: 220, y: 20, w: 160, h: 260 },
            { id: 'w_fader_3', type: 'fader', label: 'FADER 3', msgType: 'cc', channel: 0, midiNum: 22, minVal: 0, maxVal: 127, value: 1, color: 'lime', behavior: 'standard', x: 400, y: 20, w: 160, h: 260 },
            { id: 'w_pad_4', type: 'pad', label: 'PAD 4', msgType: 'note', channel: 0, midiNum: 36, minVal: 0, maxVal: 127, value: 127, color: 'magenta', behavior: 'momentary', x: 580, y: 20, w: 180, h: 180 },
            { id: 'w_btn_5', type: 'button', label: 'BUTTON 5', msgType: 'cc', channel: 0, midiNum: 10, minVal: 0, maxVal: 127, value: 127, color: 'lime', behavior: 'momentary', x: 780, y: 20, w: 180, h: 120 },
            { id: 'w_toggle_6', type: 'toggle', label: 'TOGGLE 6', msgType: 'cc', channel: 0, midiNum: 11, minVal: 0, maxVal: 127, value: 1, color: 'cyan', behavior: 'toggle', x: 780, y: 160, w: 180, h: 120 }
          ]
        }
      ]
    };
    this.saveLayoutToStorage();
    this.renderPageTabs();
    this.renderBuilderCanvas();
    this.updateStatusStrip();
  }

  loadPresetLayout(presetName) {
    this.pushUndoHistory();
    if (presetName === 'reference' || presetName === 'drums') {
      this.customWidgets = [
        { id: 'w_knob_1', type: 'knob', label: 'KNOB 1', msgType: 'cc', channel: 0, midiNum: 1, minVal: 0, maxVal: 127, value: 64, color: 'cyan', behavior: 'standard', x: 20, y: 20, w: 180, h: 220 },
        { id: 'w_fader_2', type: 'fader', label: 'FADER 2', msgType: 'cc', channel: 0, midiNum: 21, minVal: 0, maxVal: 127, value: 1, color: 'cyan', behavior: 'standard', x: 220, y: 20, w: 160, h: 260 },
        { id: 'w_fader_3', type: 'fader', label: 'FADER 3', msgType: 'cc', channel: 0, midiNum: 22, minVal: 0, maxVal: 127, value: 1, color: 'lime', behavior: 'standard', x: 400, y: 20, w: 160, h: 260 },
        { id: 'w_pad_4', type: 'pad', label: 'PAD 4', msgType: 'note', channel: 0, midiNum: 36, minVal: 0, maxVal: 127, value: 127, color: 'magenta', behavior: 'momentary', x: 580, y: 20, w: 180, h: 180 },
        { id: 'w_btn_5', type: 'button', label: 'BUTTON 5', msgType: 'cc', channel: 0, midiNum: 10, minVal: 0, maxVal: 127, value: 127, color: 'lime', behavior: 'momentary', x: 780, y: 20, w: 180, h: 120 },
        { id: 'w_toggle_6', type: 'toggle', label: 'TOGGLE 6', msgType: 'cc', channel: 0, midiNum: 11, minVal: 0, maxVal: 127, value: 1, color: 'cyan', behavior: 'toggle', x: 780, y: 160, w: 180, h: 120 }
      ];
    } else if (presetName === 'synth') {
      this.customWidgets = [
        { id: 'sw_1', type: 'knob', label: 'Filter Cutoff', msgType: 'cc', channel: 0, midiNum: 74, minVal: 0, maxVal: 127, value: 64, color: 'cyan', behavior: 'standard', x: 20, y: 20, w: 180, h: 220 },
        { id: 'sw_2', type: 'knob', label: 'Resonance', msgType: 'cc', channel: 0, midiNum: 71, minVal: 0, maxVal: 127, value: 40, color: 'cyan', behavior: 'standard', x: 220, y: 20, w: 180, h: 220 },
        { id: 'sw_3', type: 'knob', label: 'Attack Time', msgType: 'cc', channel: 0, midiNum: 73, minVal: 0, maxVal: 127, value: 20, color: 'amber', behavior: 'standard', x: 420, y: 20, w: 180, h: 220 },
        { id: 'sw_4', type: 'knob', label: 'Release Time', msgType: 'cc', channel: 0, midiNum: 72, minVal: 0, maxVal: 127, value: 50, color: 'amber', behavior: 'standard', x: 620, y: 20, w: 180, h: 220 },
        { id: 'sw_5', type: 'button', label: 'Octave Up', msgType: 'note', channel: 0, midiNum: 72, minVal: 0, maxVal: 127, value: 127, color: 'lime', behavior: 'momentary', x: 20, y: 260, w: 180, h: 120 },
        { id: 'sw_6', type: 'button', label: 'Octave Down', msgType: 'note', channel: 0, midiNum: 48, minVal: 0, maxVal: 127, value: 127, color: 'lime', behavior: 'momentary', x: 220, y: 260, w: 180, h: 120 },
        { id: 'sw_7', type: 'toggle', label: 'Glide / Port', msgType: 'cc', channel: 0, midiNum: 65, minVal: 0, maxVal: 127, value: 0, color: 'magenta', behavior: 'toggle', x: 420, y: 260, w: 180, h: 120 },
        { id: 'sw_8', type: 'toggle', label: 'Arpeggiator', msgType: 'cc', channel: 0, midiNum: 64, minVal: 0, maxVal: 127, value: 0, color: 'magenta', behavior: 'toggle', x: 620, y: 260, w: 180, h: 120 }
      ];
    } else if (presetName === 'dj') {
      this.customWidgets = [
        { id: 'dj_1', type: 'knob', label: 'High EQ', msgType: 'cc', channel: 15, midiNum: 16, minVal: 0, maxVal: 127, value: 64, color: 'cyan', behavior: 'standard', x: 20, y: 20, w: 180, h: 200 },
        { id: 'dj_2', type: 'knob', label: 'Mid EQ', msgType: 'cc', channel: 15, midiNum: 17, minVal: 0, maxVal: 127, value: 64, color: 'cyan', behavior: 'standard', x: 220, y: 20, w: 180, h: 200 },
        { id: 'dj_3', type: 'knob', label: 'Low EQ', msgType: 'cc', channel: 15, midiNum: 18, minVal: 0, maxVal: 127, value: 64, color: 'cyan', behavior: 'standard', x: 420, y: 20, w: 180, h: 200 },
        { id: 'dj_4', type: 'knob', label: 'Filter Sweep', msgType: 'cc', channel: 15, midiNum: 19, minVal: 0, maxVal: 127, value: 64, color: 'amber', behavior: 'standard', x: 620, y: 20, w: 180, h: 200 },
        { id: 'dj_5', type: 'xy', label: 'Filter & Delay', msgType: 'cc', channel: 15, midiNum: 74, minVal: 0, maxVal: 127, value: 64, color: 'magenta', behavior: 'standard', x: 20, y: 240, w: 380, h: 240 },
        { id: 'dj_6', type: 'toggle', label: 'Roll FX', msgType: 'cc', channel: 15, midiNum: 20, minVal: 0, maxVal: 127, value: 0, color: 'lime', behavior: 'toggle', x: 420, y: 240, w: 180, h: 110 },
        { id: 'dj_7', type: 'toggle', label: 'Tape Stop', msgType: 'cc', channel: 15, midiNum: 21, minVal: 0, maxVal: 127, value: 0, color: 'red', behavior: 'toggle', x: 620, y: 240, w: 180, h: 110 }
      ];
    } else if (presetName === 'mix4') {
      this.customWidgets = [
        { id: 'm4_1', type: 'fader', label: 'Track 1 Vol', msgType: 'cc', channel: 15, midiNum: 20, minVal: 0, maxVal: 127, value: 100, color: 'cyan', behavior: 'standard', x: 20, y: 20, w: 150, h: 300 },
        { id: 'm4_2', type: 'fader', label: 'Track 2 Vol', msgType: 'cc', channel: 15, midiNum: 21, minVal: 0, maxVal: 127, value: 100, color: 'cyan', behavior: 'standard', x: 190, y: 20, w: 150, h: 300 },
        { id: 'm4_3', type: 'fader', label: 'Track 3 Vol', msgType: 'cc', channel: 15, midiNum: 22, minVal: 0, maxVal: 127, value: 100, color: 'cyan', behavior: 'standard', x: 360, y: 20, w: 150, h: 300 },
        { id: 'm4_4', type: 'fader', label: 'Track 4 Vol', msgType: 'cc', channel: 15, midiNum: 23, minVal: 0, maxVal: 127, value: 100, color: 'cyan', behavior: 'standard', x: 530, y: 20, w: 150, h: 300 },
        { id: 'm4_5', type: 'knob', label: 'Track 1 Pan', msgType: 'cc', channel: 15, midiNum: 28, minVal: 0, maxVal: 127, value: 64, color: 'amber', behavior: 'standard', x: 20, y: 340, w: 150, h: 180 },
        { id: 'm4_6', type: 'knob', label: 'Track 2 Pan', msgType: 'cc', channel: 15, midiNum: 29, minVal: 0, maxVal: 127, value: 64, color: 'amber', behavior: 'standard', x: 190, y: 340, w: 150, h: 180 },
        { id: 'm4_7', type: 'knob', label: 'Track 3 Pan', msgType: 'cc', channel: 15, midiNum: 30, minVal: 0, maxVal: 127, value: 64, color: 'amber', behavior: 'standard', x: 360, y: 340, w: 150, h: 180 },
        { id: 'm4_8', type: 'knob', label: 'Track 4 Pan', msgType: 'cc', channel: 15, midiNum: 31, minVal: 0, maxVal: 127, value: 64, color: 'amber', behavior: 'standard', x: 530, y: 340, w: 150, h: 180 }
      ];
    } else if (presetName === 'pads8') {
      const drumMap = [
        { name: 'KICK', note: 36, color: 'cyan' },
        { name: 'SNARE', note: 38, color: 'amber' },
        { name: 'CLAP', note: 39, color: 'magenta' },
        { name: 'CLOSED HH', note: 42, color: 'lime' },
        { name: 'OPEN HH', note: 46, color: 'lime' },
        { name: 'LOW TOM', note: 41, color: 'violet' },
        { name: 'CRASH', note: 49, color: 'red' },
        { name: 'RIDE', note: 51, color: 'red' }
      ];
      this.customWidgets = drumMap.map((d, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        return {
          id: 'p8_' + i,
          type: 'pad',
          label: d.name,
          msgType: 'note',
          channel: 9, // Ch 10
          midiNum: d.note,
          minVal: 0,
          maxVal: 127,
          value: 100,
          color: d.color,
          behavior: 'momentary',
          x: 20 + (col * 200),
          y: 20 + (row * 200),
          w: 180,
          h: 180
        };
      });
    }

    this.saveLayoutToStorage();
    this.renderBuilderCanvas();
    this.broadcastLayoutSync();
    if (this.isDesignMode && this.customWidgets.length > 0) {
      this.selectWidget(this.customWidgets[0].id);
    }
    this.showEditingToast(`Loaded preset: ${presetName.toUpperCase()}`);
  }

  applySyncedLayout(incomingLayout) {
    if (!incomingLayout) return false;
    let layoutObj = incomingLayout;
    if (typeof incomingLayout === 'string') {
      try {
        layoutObj = JSON.parse(incomingLayout);
      } catch (err) {
        console.warn('Failed parsing incoming layout JSON string:', err);
        return false;
      }
    }

    if (layoutObj && typeof layoutObj === 'object') {
      if (Array.isArray(layoutObj.pages) && layoutObj.pages.length > 0) {
        // Multi-page layout (Version 2)
        this.layoutData.pages = layoutObj.pages;
        if (typeof layoutObj.activePageIndex === 'number') {
          this.layoutData.activePageIndex = Math.max(0, Math.min(layoutObj.pages.length - 1, layoutObj.activePageIndex));
        } else if (this.layoutData.activePageIndex >= layoutObj.pages.length) {
          this.layoutData.activePageIndex = 0;
        }
        if (layoutObj.version) this.layoutData.version = layoutObj.version;

        this.renderPageTabs();
        this.renderBuilderCanvas();
        this.updateStatusStrip();
        this.saveLayoutToStorage();
        if (this.isDesignMode && this.customWidgets.length > 0) {
          this.selectWidget(this.customWidgets[0].id);
        }
        console.log(`[VLive Sync] Synced ${this.layoutData.pages.length} decks across devices`);
        return true;
      } else if (Array.isArray(layoutObj)) {
        // Flat array of widgets (Legacy Version 1)
        this.customWidgets = layoutObj;
        this.renderPageTabs();
        this.renderBuilderCanvas();
        this.updateStatusStrip();
        this.saveLayoutToStorage();
        if (this.isDesignMode && this.customWidgets.length > 0) {
          this.selectWidget(this.customWidgets[0].id);
        }
        console.log(`[VLive Sync] Synced legacy widget layout (${layoutObj.length} controls)`);
        return true;
      }
    }
    return false;
  }

  broadcastLayoutSync() {
    this.sendJson({
      type: 'sync_layout',
      layout: this.layoutData
    });
    this.saveLayoutToStorage();
    this.updateStatusStrip();
  }

  saveLayoutToStorage(notify = false) {
    try {
      const activeIdx = (this.layoutData && this.layoutData.activePageIndex !== undefined) ? this.layoutData.activePageIndex : 0;
      localStorage.setItem('vlive_custom_layout_v2', JSON.stringify(this.layoutData));
      localStorage.setItem('vlive_last_active_page_idx', String(activeIdx));
      localStorage.setItem('vlive_custom_layout', JSON.stringify(this.customWidgets)); // legacy fallback
      if (notify) {
        this.flashVirtualMidiBadge();
      }
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  }

  saveCustomLayout() {
    this.saveLayoutToStorage(true);
    this.showEditingToast('Layout and page sets saved!');
  }

  loadSavedLayout() {
    try {
      const savedV2 = localStorage.getItem('vlive_custom_layout_v2');
      const lastPageIdxStr = localStorage.getItem('vlive_last_active_page_idx');
      if (savedV2) {
        const parsed = JSON.parse(savedV2);
        if (parsed && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          parsed.pages.forEach(p => {
            if (Array.isArray(p.widgets)) {
              p.widgets.forEach((w, i) => this.ensureWidgetCoordinates(w, i));
            }
          });
          this.layoutData = parsed;
          let targetIdx = 0;
          if (lastPageIdxStr !== null && !isNaN(parseInt(lastPageIdxStr))) {
            targetIdx = parseInt(lastPageIdxStr);
          } else if (this.layoutData.activePageIndex !== undefined) {
            targetIdx = this.layoutData.activePageIndex;
          }
          this.layoutData.activePageIndex = Math.max(0, Math.min(this.layoutData.pages.length - 1, targetIdx));
          this.renderPageTabs();
          this.renderBuilderCanvas();
          this.updateStatusStrip();
          if (this.isDesignMode && this.customWidgets.length > 0) {
            this.selectWidget(this.customWidgets[0].id);
          }
          return true;
        }
      }

      // Legacy fallback
      const saved = localStorage.getItem('vlive_custom_layout');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach((w, i) => this.ensureWidgetCoordinates(w, i));
          this.layoutData.pages = [
            { id: 'page_1', name: 'Page 1 — Main Deck', widgets: parsed }
          ];
          this.layoutData.activePageIndex = 0;
          this.renderPageTabs();
          this.renderBuilderCanvas();
          this.updateStatusStrip();
          if (this.isDesignMode && this.customWidgets.length > 0) {
            this.selectWidget(this.customWidgets[0].id);
          }
          return true;
        }
      }
    } catch (e) {
      console.warn('Failed loading layout:', e);
    }
    return false;
  }

  exportLayoutJson() {
    const activePage = (this.layoutData.pages && this.layoutData.pages[this.layoutData.activePageIndex || 0]);
    const pageSlug = activePage ? activePage.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') : 'layout';
    const filename = `vlive_${pageSlug}.gvl`;

    const gvlData = {
      format: 'GVL',
      version: '2.0',
      appName: 'Goldee VLive MIDI Controller',
      exportedAt: new Date().toISOString(),
      activePageIndex: this.layoutData.activePageIndex || 0,
      pages: this.layoutData.pages
    };

    const jsonStr = JSON.stringify(gvlData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showEditingToast(`Exported "${filename}"`);
  }

  importLayoutJson(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (parsed && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          parsed.pages.forEach(p => {
            if (Array.isArray(p.widgets)) {
              p.widgets.forEach((w, i) => this.ensureWidgetCoordinates(w, i));
            }
          });
          const activeIdx = (parsed.activePageIndex !== undefined && parsed.activePageIndex >= 0 && parsed.activePageIndex < parsed.pages.length)
            ? parsed.activePageIndex
            : 0;
          this.layoutData = {
            activePageIndex: activeIdx,
            pages: parsed.pages
          };
          this.saveLayoutToStorage(true);
          this.renderPageTabs();
          this.renderBuilderCanvas();
          this.broadcastLayoutSync();
          if (this.isDesignMode && this.customWidgets.length > 0) {
            this.selectWidget(this.customWidgets[0].id);
          }
          this.showEditingToast(`Loaded .gvl project: ${file.name}`);
        } else if (Array.isArray(parsed)) {
          // Legacy single-page JSON format
          parsed.forEach((w, i) => this.ensureWidgetCoordinates(w, i));
          this.layoutData = {
            activePageIndex: 0,
            pages: [
              { id: 'page_1', name: 'Page 1 — Imported Deck', widgets: parsed }
            ]
          };
          this.saveLayoutToStorage(true);
          this.renderPageTabs();
          this.renderBuilderCanvas();
          this.broadcastLayoutSync();
          if (this.isDesignMode && this.customWidgets.length > 0) {
            this.selectWidget(this.customWidgets[0].id);
          }
          this.showEditingToast(`Loaded layout: ${file.name}`);
        } else {
          this.showAlert('UNRECOGNIZED FORMAT', 'Unrecognized layout format. Please select a valid .gvl or .json file.');
        }
      } catch (err) {
        console.error('Import error:', err);
        this.showAlert('INVALID FILE', 'Invalid or corrupted .gvl / .json layout file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // --- MULTI-PAGE SYSTEM ---

  initPageSystem() {
    this.initPageContextMenu();
    const btnAddPage = document.getElementById('btnAddPage');
    if (btnAddPage) {
      btnAddPage.addEventListener('click', async () => {
        const pageNum = this.layoutData.pages.length + 1;
        const name = await this.showPrompt('NEW PAGE SET', 'Enter name for the new page set:', `Page ${pageNum} — Deck`);
        if (name && name.trim()) {
          this.addPage(name.trim());
        }
      });
    }

    // Page Options Modal buttons
    const btnClose = document.getElementById('btnClosePageOptions');
    const btnCancel = document.getElementById('btnCancelPageOptions');
    const btnSave = document.getElementById('btnSavePageOptions');
    const btnDup = document.getElementById('btnDuplicatePage');
    const btnDel = document.getElementById('btnDeletePage');

    if (btnClose) btnClose.addEventListener('click', () => this.togglePageOptionsModal(false));
    if (btnCancel) btnCancel.addEventListener('click', () => this.togglePageOptionsModal(false));
    if (btnSave) btnSave.addEventListener('click', () => this.savePageOptions());
    if (btnDup) {
      btnDup.addEventListener('click', () => {
        if (this.editingPageIndex !== null) {
          this.duplicatePage(this.editingPageIndex);
          this.togglePageOptionsModal(false);
        }
      });
    }
    if (btnDel) {
      btnDel.addEventListener('click', () => {
        if (this.editingPageIndex !== null) {
          this.deletePage(this.editingPageIndex);
          this.togglePageOptionsModal(false);
        }
      });
    }

    // Hotkeys 1-9 to switch pages in performance
    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, select, textarea')) return;
      if (e.key >= '1' && e.key <= '9') {
        const pageIdx = parseInt(e.key, 10) - 1;
        if (pageIdx < this.layoutData.pages.length) {
          this.switchPage(pageIdx);
        }
      }
    });

    // Mobile Horizontal Swipe Navigation
    const viewport = document.getElementById('builderCanvasViewport');
    if (viewport) {
      let touchStartX = 0;
      let touchStartY = 0;
      viewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      viewport.addEventListener('touchend', (e) => {
        if (e.changedTouches.length === 1) {
          const deltaX = e.changedTouches[0].clientX - touchStartX;
          const deltaY = e.changedTouches[0].clientY - touchStartY;
          if (Math.abs(deltaX) > 90 && Math.abs(deltaY) < 60) {
            if (deltaX < 0) {
              if (this.layoutData.activePageIndex < this.layoutData.pages.length - 1) {
                this.switchPage(this.layoutData.activePageIndex + 1);
              }
            } else {
              if (this.layoutData.activePageIndex > 0) {
                this.switchPage(this.layoutData.activePageIndex - 1);
              }
            }
          }
        }
      }, { passive: true });
    }
  }

  addPage(name) {
    const id = 'page_' + Date.now();
    this.layoutData.pages.push({
      id,
      name,
      widgets: []
    });
    this.switchPage(this.layoutData.pages.length - 1, false);
    this.broadcastLayoutSync();
  }

  duplicatePage(index) {
    if (index >= 0 && index < this.layoutData.pages.length) {
      const src = this.layoutData.pages[index];
      const clonedWidgets = JSON.parse(JSON.stringify(src.widgets));
      clonedWidgets.forEach(w => {
        w.id = 'w_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      });
      const newPage = {
        id: 'page_' + Date.now(),
        name: src.name + ' (Copy)',
        widgets: clonedWidgets
      };
      this.layoutData.pages.splice(index + 1, 0, newPage);
      this.switchPage(index + 1, false);
      this.broadcastLayoutSync();
    }
  }

  async deletePage(index) {
    if (this.layoutData.pages.length <= 1) {
      this.showAlert('CANNOT DELETE', 'You must have at least one page set in your project.');
      return;
    }
    const pageName = this.layoutData.pages[index].name;
    const ok = await this.showConfirm('DELETE PAGE', `Delete page "${pageName}"? This action cannot be undone.`, 'Delete Page', true);
    if (ok) {
      this.layoutData.pages.splice(index, 1);
      const newIdx = Math.max(0, Math.min(this.layoutData.pages.length - 1, index));
      this.switchPage(newIdx, false);
      this.broadcastLayoutSync();
    }
  }

  switchPage(index, broadcast = true) {
    if (index >= 0 && index < this.layoutData.pages.length) {
      this.layoutData.activePageIndex = index;
      this.selectedWidgetId = null;
      this.renderPageTabs();
      this.renderBuilderCanvas();
      this.updateStatusStrip();
      this.saveLayoutToStorage();
      if (this.isDesignMode && this.customWidgets.length > 0) {
        this.selectWidget(this.customWidgets[0].id);
      }
      if (navigator.vibrate) navigator.vibrate(30);

      if (broadcast) {
        this.sendJson({
          type: 'page_switch',
          pageIndex: index
        });
      }
    }
  }

  renderPageTabs() {
    const container = document.getElementById('pageTabsContainer');
    const topBarPages = document.getElementById('topBarPages');
    const activeIdx = this.layoutData.activePageIndex || 0;

    // 1. Lower Toolbar Page Tabs (Matches media_1790931426566.png)
    if (container) {
      container.innerHTML = '';
      this.layoutData.pages.forEach((page, idx) => {
        const tab = document.createElement('div');
        const isActive = idx === activeIdx;
        tab.className = `page-tab ${isActive ? 'active' : ''}`;
        tab.dataset.index = idx;

        tab.innerHTML = `
          <span class="page-tab-dot ${isActive ? 'active' : ''}"></span>
          <span class="page-tab-title">${page.name}</span>
          <button class="btn-tab-opts" title="Page Options">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          </button>
        `;

        tab.addEventListener('click', (e) => {
          if (e.target.closest('.btn-tab-opts')) return;
          this.switchPage(idx);
        });

        tab.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.openPageContextMenu(idx, e.clientX, e.clientY);
        });

        const optsBtn = tab.querySelector('.btn-tab-opts');
        if (optsBtn) {
          optsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openPageOptions(idx);
          });
        }

        container.appendChild(tab);
      });
    }

    // 2. Top Bar Header Page Navigation (Matches reference layout media_1790931426566.png)
    if (topBarPages) {
      topBarPages.innerHTML = '';
      this.layoutData.pages.forEach((page, idx) => {
        const btn = document.createElement('button');
        const isActive = idx === activeIdx;
        btn.className = `top-header-page-btn ${isActive ? 'active' : ''}`;
        btn.dataset.page = idx;
        
        let shortName = page.name || `PAGE ${idx + 1}`;
        if (shortName.includes('—')) {
          shortName = shortName.split('—')[1].trim();
        } else if (shortName.includes('-')) {
          shortName = shortName.split('-')[1].trim();
        }
        btn.textContent = shortName.toUpperCase();

        btn.addEventListener('click', () => {
          this.switchPage(idx);
        });

        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.openPageContextMenu(idx, e.clientX, e.clientY);
        });

        topBarPages.appendChild(btn);
      });

      const addBtn = document.createElement('button');
      addBtn.className = 'top-header-page-add';
      addBtn.id = 'btnTopAddPage';
      addBtn.textContent = '+ NEW PAGE';
      addBtn.addEventListener('click', async () => {
        const pageNum = this.layoutData.pages.length + 1;
        const name = await this.showPrompt('NEW PAGE SET', 'Enter name for the new page set:', `Page ${pageNum} — Deck`);
        if (name && name.trim()) {
          this.addPage(name.trim());
        }
      });
      topBarPages.appendChild(addBtn);
    }

    // 3. Mobile Performer Bar Deck Navigation (Syncs decks across connected phones)
    const mobileDeckTabs = document.getElementById('mobileDeckTabs');
    if (mobileDeckTabs) {
      mobileDeckTabs.innerHTML = '';
      if (this.layoutData.pages && this.layoutData.pages.length > 1) {
        mobileDeckTabs.style.display = 'flex';
        this.layoutData.pages.forEach((page, idx) => {
          const btn = document.createElement('button');
          const isActive = idx === activeIdx;
          btn.className = `mobile-deck-btn ${isActive ? 'active' : ''}`;
          btn.dataset.page = idx;
          let shortName = page.name || `P${idx + 1}`;
          if (shortName.includes('—')) shortName = shortName.split('—')[1].trim();
          else if (shortName.includes('-')) shortName = shortName.split('-')[1].trim();
          btn.textContent = shortName.toUpperCase();
          btn.addEventListener('click', () => {
            this.switchPage(idx);
          });
          mobileDeckTabs.appendChild(btn);
        });
      } else {
        mobileDeckTabs.style.display = 'none';
      }
    }
  }

  openPageOptions(index) {
    this.editingPageIndex = index;
    const page = this.layoutData.pages[index];
    if (!page) return;

    const titleEl = document.getElementById('pageOptionsModalTitle');
    const inputEl = document.getElementById('pageRenameInput');
    if (titleEl) titleEl.textContent = `OPTIONS: PAGE ${index + 1}`;
    if (inputEl) inputEl.value = page.name;

    this.togglePageOptionsModal(true);
  }

  savePageOptions() {
    if (this.editingPageIndex === null) return;
    const inputEl = document.getElementById('pageRenameInput');
    if (inputEl && inputEl.value.trim()) {
      this.layoutData.pages[this.editingPageIndex].name = inputEl.value.trim();
      this.renderPageTabs();
      this.updateStatusStrip();
      this.broadcastLayoutSync();
    }
    this.togglePageOptionsModal(false);
  }

  togglePageOptionsModal(open) {
    const modal = document.getElementById('modalPageOptions');
    if (modal) modal.classList.toggle('open', open);
  }

  updateStatusStrip() {
    const pageLbl = document.getElementById('statusActivePageLbl');
    const countLbl = document.getElementById('statusWidgetCountLbl');
    if (pageLbl) {
      pageLbl.textContent = `Page ${(this.layoutData.activePageIndex || 0) + 1}: ${this.activePage.name}`;
    }
    if (countLbl) {
      countLbl.textContent = `${this.customWidgets.length} Controls`;
    }
  }

  // --- DEVICE PREVIEW & ZOOM ---

  initDevicePreview() {
    // Single unified edit mode - responsive auto-scaling handles all screens
  }

  initZoomControl() {
    const slider = document.getElementById('canvasZoomSlider');
    const valDisplay = document.getElementById('canvasZoomVal');
    const canvas = document.getElementById('builderCanvas');
    if (slider) {
      slider.addEventListener('input', (e) => {
        const pct = parseInt(e.target.value, 10);
        this.canvasZoom = pct / 100;
        if (valDisplay) valDisplay.textContent = pct + '%';
        if (canvas && !this.isPerformerMode) {
          canvas.style.transform = this.canvasZoom === 1.0 ? 'none' : `scale(${this.canvasZoom})`;
          canvas.style.transformOrigin = 'top left';
        }
      });
    }
  }

  // --- SUBNET AUTO-DISCOVERY RADAR ---

  initSubnetRadar() {
    const btnRadar = document.getElementById('btnSubnetRadar');
    const mobileBtnRadar = document.getElementById('mobileBtnSubnetRadar');
    const btnClose = document.getElementById('btnCloseRadar');
    const btnCancel = document.getElementById('btnCancelRadar');
    const btnStart = document.getElementById('btnStartRadarScan');

    if (btnRadar) btnRadar.addEventListener('click', () => this.openSubnetRadar());
    if (mobileBtnRadar) mobileBtnRadar.addEventListener('click', () => this.openSubnetRadar());
    if (btnClose) btnClose.addEventListener('click', () => this.closeSubnetRadar());
    if (btnCancel) btnCancel.addEventListener('click', () => this.closeSubnetRadar());
    if (btnStart) btnStart.addEventListener('click', () => this.startSubnetRadar());

    // Auto-launch radar if running as installed PWA on mobile and disconnected
    if (this.isPerformerMode && !this.isConnected) {
      setTimeout(() => {
        if (!this.isConnected) {
          this.openSubnetRadar();
          this.startSubnetRadar();
        }
      }, 1200);
    }
  }

  openSubnetRadar() {
    const modal = document.getElementById('modalSubnetRadar');
    if (modal) modal.classList.add('open');
    const blip = document.getElementById('radarTargetBlip');
    if (blip) blip.style.display = 'none';
  }

  closeSubnetRadar() {
    this.stopSubnetRadar();
    const modal = document.getElementById('modalSubnetRadar');
    if (modal) modal.classList.remove('open');
  }

  stopSubnetRadar() {
    this.radarScanning = false;
    if (this.radarAbortCtrl) {
      this.radarAbortCtrl.abort();
      this.radarAbortCtrl = null;
    }
  }

  async startSubnetRadar() {
    if (this.radarScanning) return;
    this.radarScanning = true;
    this.radarAbortCtrl = new AbortController();

    const statusLine = document.getElementById('radarStatusLine');
    const meterBar = document.getElementById('radarMeterBar');
    const hostDetected = document.getElementById('radarHostDetected');
    const blip = document.getElementById('radarTargetBlip');

    if (statusLine) statusLine.textContent = 'Probing local Wi-Fi network for VLive Host...';
    if (meterBar) meterBar.style.width = '10%';
    if (hostDetected) hostDetected.textContent = '';
    if (blip) blip.style.display = 'none';

    // 1. Try last known IP first
    const lastIp = localStorage.getItem('vlive_last_host_ip');
    if (lastIp) {
      if (statusLine) statusLine.textContent = `Testing last known host: ${lastIp}...`;
      const found = await this.probeHostCandidate(lastIp, 600);
      if (found) {
        this.onHostRadarFound(lastIp, found);
        return;
      }
    }

    // 2. Try window.location.hostname
    const currentHost = window.location.hostname;
    if (currentHost && currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
      const found = await this.probeHostCandidate(currentHost, 600);
      if (found) {
        this.onHostRadarFound(currentHost, found);
        return;
      }
    }

    // 3. Scan subnet ranges
    let subnetPrefixes = [];
    if (currentHost && /^\d+\.\d+\.\d+\./.test(currentHost)) {
      const parts = currentHost.split('.');
      subnetPrefixes.push(`${parts[0]}.${parts[1]}.${parts[2]}.`);
    }
    if (lastIp && /^\d+\.\d+\.\d+\./.test(lastIp)) {
      const parts = lastIp.split('.');
      const p = `${parts[0]}.${parts[1]}.${parts[2]}.`;
      if (!subnetPrefixes.includes(p)) subnetPrefixes.push(p);
    }
    ['192.168.1.', '192.168.0.', '192.168.2.', '10.0.0.', '172.20.10.'].forEach(p => {
      if (!subnetPrefixes.includes(p)) subnetPrefixes.push(p);
    });

    for (const prefix of subnetPrefixes) {
      if (!this.radarScanning) break;
      if (statusLine) statusLine.textContent = `Scanning subnet ${prefix}x:8088...`;

      // Parallel batch scanning
      const batchSize = 25;
      for (let i = 1; i <= 254; i += batchSize) {
        if (!this.radarScanning) break;
        const promises = [];
        for (let j = i; j < i + batchSize && j <= 254; j++) {
          const ip = prefix + j;
          promises.push(this.probeHostCandidate(ip, 350));
        }

        const pct = Math.min(95, Math.round((i / 254) * 100));
        if (meterBar) meterBar.style.width = pct + '%';

        const results = await Promise.all(promises);
        for (let k = 0; k < results.length; k++) {
          if (results[k]) {
            const foundIp = prefix + (i + k);
            this.onHostRadarFound(foundIp, results[k]);
            return;
          }
        }
      }
    }

    if (this.radarScanning) {
      this.radarScanning = false;
      if (statusLine) statusLine.textContent = 'Scan complete. No VLive host found. Ensure PC is on same Wi-Fi.';
      if (meterBar) meterBar.style.width = '100%';
    }
  }

  async probeHostCandidate(ip, timeoutMs = 400) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(`http://${ip}:8088/api/info`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ok') return data;
      }
    } catch (_) {}
    return null;
  }

  onHostRadarFound(ip, hostInfo) {
    this.radarScanning = false;
    const statusLine = document.getElementById('radarStatusLine');
    const meterBar = document.getElementById('radarMeterBar');
    const hostDetected = document.getElementById('radarHostDetected');
    const blip = document.getElementById('radarTargetBlip');

    if (statusLine) statusLine.textContent = 'LOCKED ONTO VLIVE HOST';
    if (meterBar) meterBar.style.width = '100%';
    if (hostDetected) {
      hostDetected.innerHTML = `Connected to <strong>${ip}:8088</strong> • ${hostInfo.virtual_midi_name || 'DAW Ready'}`;
    }
    if (blip) blip.style.display = 'block';

    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    localStorage.setItem('vlive_last_host_ip', ip);
    this.connectToHost(ip);

    setTimeout(() => {
      this.closeSubnetRadar();
    }, 1400);
  }

  connectToHost(ip) {
    this.hostIp = ip;
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    this.initWebSocket();
  }

  // --- ANDROID / WEB PWA INSTALLATION ---

  initPwaServiceWorker() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isStandalone) {
      document.body.classList.add('pwa-installed');
      console.log('VLive running as installed standalone PWA.');
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        console.log('VLive Service Worker registered on scope:', reg.scope);
      }).catch(err => {
        console.warn('VLive Service Worker registration failed:', err);
      });
    }

    const btnPwa = document.getElementById('btnPwaInstall');
    const mobileBtnPwa = document.getElementById('mobileBtnPwaInstall');
    const installModal = document.getElementById('pwaInstallModal');
    const btnCloseModal = document.getElementById('btnClosePwaModal');
    const btnGotItModal = document.getElementById('btnGotItPwaModal');
    const btnTriggerNative = document.getElementById('btnTriggerNativeInstall');

    const showInstallModal = () => {
      if (installModal) {
        installModal.style.display = 'flex';
        if (btnTriggerNative) {
          btnTriggerNative.style.display = this.deferredInstallPrompt ? 'inline-block' : 'none';
        }
      }
    };

    const closeInstallModal = () => {
      if (installModal) installModal.style.display = 'none';
    };

    if (btnCloseModal) btnCloseModal.addEventListener('click', closeInstallModal);
    if (btnGotItModal) btnGotItModal.addEventListener('click', closeInstallModal);

    // If not standalone, make install buttons visible and active
    if (!isStandalone) {
      if (btnPwa) btnPwa.style.display = 'inline-flex';
      if (mobileBtnPwa) mobileBtnPwa.style.display = 'inline-flex';
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      if (!isStandalone) {
        if (btnPwa) btnPwa.style.display = 'inline-flex';
        if (mobileBtnPwa) mobileBtnPwa.style.display = 'inline-flex';
      }
      if (btnTriggerNative) btnTriggerNative.style.display = 'inline-block';
    });

    const triggerInstall = () => {
      if (this.deferredInstallPrompt) {
        this.deferredInstallPrompt.prompt();
        this.deferredInstallPrompt.userChoice.then((choice) => {
          if (choice.outcome === 'accepted') {
            if (btnPwa) btnPwa.style.display = 'none';
            if (mobileBtnPwa) mobileBtnPwa.style.display = 'none';
            closeInstallModal();
            this.showEditingToast('VLive installing to home screen');
          }
          this.deferredInstallPrompt = null;
        });
      } else {
        showInstallModal();
      }
    };

    if (btnPwa) btnPwa.addEventListener('click', triggerInstall);
    if (mobileBtnPwa) mobileBtnPwa.addEventListener('click', triggerInstall);
    if (btnTriggerNative) {
      btnTriggerNative.addEventListener('click', () => {
        if (this.deferredInstallPrompt) {
          this.deferredInstallPrompt.prompt();
          this.deferredInstallPrompt.userChoice.then((choice) => {
            if (choice.outcome === 'accepted') {
              closeInstallModal();
            }
            this.deferredInstallPrompt = null;
          });
        }
      });
    }

    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      document.body.classList.add('pwa-installed');
      if (btnPwa) btnPwa.style.display = 'none';
      if (mobileBtnPwa) mobileBtnPwa.style.display = 'none';
      closeInstallModal();
      this.showEditingToast('VLive installed as standalone app');
    });
  }

  // --- AUTOMATIC QR DOCK & HARDWARE HUB ---

  initQrDock() {
    const btnToggle = document.getElementById('btnToggleQrDock');
    const panel = document.getElementById('qrDockPanel');
    const btnClose = document.getElementById('btnCloseQrDock');
    const btnCopy = document.getElementById('btnCopyDockUrl');

    if (btnToggle && panel) {
      btnToggle.addEventListener('click', () => {
        this.qrDockOpen = !this.qrDockOpen;
        panel.classList.toggle('collapsed', !this.qrDockOpen);
        btnToggle.classList.toggle('active', this.qrDockOpen);
      });
    }

    const btnTabInspector = document.getElementById('btnTabInspector');
    const btnTabQr = document.getElementById('btnTabQr');

    if (btnTabInspector) {
      btnTabInspector.addEventListener('click', () => this.switchDockTab('inspector'));
    }

    if (btnTabQr) {
      btnTabQr.addEventListener('click', () => this.switchDockTab('qr'));
    }

    // Set initial dock view (Inspector for design mode, QR for play mode)
    this.switchDockTab(this.isDesignMode ? 'inspector' : 'qr');

    if (btnClose && panel && btnToggle) {
      btnClose.addEventListener('click', () => {
        this.qrDockOpen = false;
        panel.classList.add('collapsed');
        btnToggle.classList.remove('active');
      });
    }

    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        const primary = this.getPrimaryUrl(true);
        navigator.clipboard.writeText(primary).then(() => {
          this.showEditingToast(`Copied performer link: ${primary}`);
        });
      });
    }

    const ipSelect = document.getElementById('qrIpSelect');
    if (ipSelect) {
      ipSelect.addEventListener('change', () => {
        this.selectedIp = ipSelect.value;
        const urlDisplay = document.getElementById('qrPrimaryUrlDisplay');
        if (urlDisplay) urlDisplay.textContent = this.getPrimaryUrl(true);
        this.refreshQrCode();
      });
    }

    const btnCopyIp = document.getElementById('btnCopyIp');
    if (btnCopyIp && ipSelect) {
      btnCopyIp.addEventListener('click', () => {
        navigator.clipboard.writeText(ipSelect.value || '').then(() => {
          this.showEditingToast(`Copied IP: ${ipSelect.value}`);
        });
      });
    }

    const btnCopyUrlInline = document.getElementById('btnCopyUrlInline');
    if (btnCopyUrlInline) {
      btnCopyUrlInline.addEventListener('click', () => {
        const primary = this.getPrimaryUrl(true);
        navigator.clipboard.writeText(primary).then(() => {
          this.showEditingToast(`Copied performer link: ${primary}`);
        });
      });
    }

    // Refresh QR code image on launch
    this.refreshQrCode();

    // Query server hardware & ports
    this.fetchServerInfo();
    this.fetchMidiPorts();

    // Periodically sync hardware status
    setInterval(() => this.fetchServerInfo(), 2500);
  }

  getPrimaryUrl(forQr = false) {
    const port = window.location.port || '8088';
    let base = '';
    if (this.selectedIp) {
      base = `http://${this.selectedIp}:${port}`;
    } else if (this.serverIps && this.serverIps.length > 0) {
      base = `http://${this.serverIps[0]}:${port}`;
    } else {
      const host = window.location.hostname;
      if (host && host !== 'localhost') {
        base = `http://${host}:${port}`;
      } else {
        base = `http://127.0.0.1:${port}`;
      }
    }
    return forQr ? `${base}/?performer=1` : base;
  }

  async refreshQrCode() {
    const wrap = document.getElementById('qrDockWrap');
    const targetUrl = this.getPrimaryUrl(true);

    // 1. Instant client-side vector SVG generation (0ms, 100% offline & robust)
    if (typeof qrcode === 'function') {
      try {
        const qr = qrcode(0, 'M');
        qr.addData(targetUrl);
        qr.make();
        const svg = qr.createSvgTag({ scalable: true, margin: 4 });
        if (wrap && svg) {
          wrap.innerHTML = svg;
          return;
        }
      } catch (err) {
        console.warn('Client-side QR generation fallback:', err);
      }
    }

    // 2. Fallback to server /api/qr endpoint
    const qrEndpoint = `/api/qr?url=${encodeURIComponent(targetUrl)}&t=${Date.now()}`;
    try {
      const res = await fetch(qrEndpoint);
      if (res.ok) {
        const svgText = await res.text();
        if (wrap && svgText.includes('<svg')) {
          wrap.innerHTML = svgText;
          return;
        }
      }
    } catch (e) {
      console.warn('QR fetch error:', e);
    }

    const img = document.getElementById('autoQrImage');
    if (img) {
      img.src = qrEndpoint;
    }
  }

  async fetchServerInfo() {
    try {
      const res = await fetch('/api/info');
      if (res.ok) {
        const info = await res.json();
        const prevIp = this.serverIps.length > 0 ? this.serverIps[0] : '';
        this.serverIps = info.ips || [];
        this.updateVirtualMidiStatus(info.virtual_midi_active, info.virtual_midi_name, info.winmm_active, info.winmm_port);

        // Update DAW IN Hint badge
        const dawHintVal = document.querySelector('.daw-hint-val');
        if (dawHintVal) {
          if (info.virtual_midi_active) {
            dawHintVal.textContent = info.virtual_midi_name || 'VLive MIDI Controller';
            dawHintVal.title = `Direct In-Process Virtual MIDI Port Active: ${info.virtual_midi_name || 'VLive MIDI Controller'}`;
          } else if (info.winmm_active && info.winmm_port) {
            dawHintVal.textContent = info.winmm_port;
            dawHintVal.title = `Direct Windows MIDI Out active: ${info.winmm_port}`;
          } else {
            dawHintVal.textContent = 'VLive MIDI Controller';
            dawHintVal.title = 'In-Process Virtual MIDI Port ready for DAW';
          }
        }

        // Populate Adapter dropdown if available
        if (info.adapters && info.adapters.length > 0) {
          const ipSelect = document.getElementById('qrIpSelect');
          if (ipSelect) {
            const currentVal = this.selectedIp || ipSelect.value;
            const existingIps = Array.from(ipSelect.options).map(o => o.value).join(',');
            const newIps = info.adapters.map(a => a.ip).join(',');
            if (existingIps !== newIps) {
              ipSelect.innerHTML = '';
              info.adapters.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a.ip;
                let tag = a.is_wifi ? ' (Wi-Fi/Hotspot) [Recommended]' : (a.is_virtual ? ' (Virtual)' : '');
                opt.textContent = `${a.ip} [${a.name || 'Net'}]${tag}`;
                ipSelect.appendChild(opt);
              });
              if (currentVal && info.adapters.some(a => a.ip === currentVal)) {
                ipSelect.value = currentVal;
                this.selectedIp = currentVal;
              } else if (info.lanIp) {
                ipSelect.value = info.lanIp;
                this.selectedIp = info.lanIp;
              }
            }
          }
        }

        // Update QR Dock primary URL display
        const urlDisplay = document.getElementById('qrPrimaryUrlDisplay');
        if (urlDisplay) {
          urlDisplay.textContent = this.getPrimaryUrl(true);
        }

        // Refresh QR code if IP changed or first load
        const currIp = this.selectedIp || (this.serverIps.length > 0 ? this.serverIps[0] : '');
        if (prevIp !== currIp) {
          this.refreshQrCode();
        }

        // Update performer count if reported
        const perfEl = document.getElementById('qrPerformersCount');
        if (perfEl && info.connected_clients !== undefined) {
          const count = info.connected_clients;
          perfEl.textContent = `${count} Device${count === 1 ? '' : 's'} Synced`;
        }
      }
    } catch (e) {
      this.serverIps = [window.location.hostname || '127.0.0.1'];
      const urlDisplay = document.getElementById('qrPrimaryUrlDisplay');
      if (urlDisplay) urlDisplay.textContent = this.getPrimaryUrl(true);
    }
  }

  updateVirtualMidiStatus(active, name, winmmActive = false, winmmPort = '') {
    const badge = document.getElementById('virtualMidiBadge');
    const label = document.getElementById('virtualMidiLabel');
    const modalStatus = document.getElementById('virtualMidiModalStatus');
    const btnStart = document.getElementById('btnStartDriver');
    const btnQrStart = document.getElementById('btnQrStartDriver');
    const btnQrTest = document.getElementById('btnQrTestNote');
    const qrBadge = document.getElementById('qrMidiStatusBadge');
    const qrDesc = document.getElementById('qrMidiPortDesc');
    const statusLbl = document.getElementById('statusVirtualMidiLbl');

    // 1. QR Section Panel Controls
    if (qrBadge) {
      if (active) {
        qrBadge.textContent = 'ACTIVE';
        qrBadge.style.background = 'rgba(34,197,94,0.2)';
        qrBadge.style.color = '#4ade80';
      } else {
        qrBadge.textContent = 'STOPPED';
        qrBadge.style.background = 'rgba(239,68,68,0.2)';
        qrBadge.style.color = '#f87171';
      }
    }
    if (qrDesc) {
      qrDesc.innerHTML = `Device: <strong>${name || 'VLive MIDI Controller'}</strong>`;
    }
    if (btnQrStart) {
      if (active) {
        btnQrStart.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> <span>RESTART DRIVER</span>';
        btnQrStart.style.background = '#181818';
        btnQrStart.style.border = '1px solid #333333';
        btnQrStart.style.color = '#e5e5e5';
        btnQrStart.style.boxShadow = 'none';
      } else {
        btnQrStart.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> <span>START DRIVER</span>';
        btnQrStart.style.background = '#181818';
        btnQrStart.style.border = '1px solid #ffffff';
        btnQrStart.style.color = '#ffffff';
        btnQrStart.style.boxShadow = 'none';
      }
    }
    if (btnQrTest) {
      btnQrTest.style.display = active ? 'block' : 'none';
    }

    // 2. Settings Modal Controls
    if (btnStart) {
      btnStart.innerHTML = active
        ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> <span>Restart Driver</span>'
        : '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> <span>Start Driver</span>';
    }
    if (modalStatus) {
      if (active) {
        modalStatus.textContent = `Device: ${name || 'VLive MIDI Controller'} (Active)`;
        modalStatus.style.color = '#4ade80';
      } else {
        modalStatus.textContent = 'Virtual MIDI Inactive (Driver service stopped)';
        modalStatus.style.color = '#f87171';
      }
    }

    // 3. Bottom Studio Status Strip
    if (statusLbl) {
      if (active) {
        statusLbl.innerHTML = `Virtual MIDI: <strong>${name || 'VLive MIDI Controller'}</strong>`;
        statusLbl.style.color = '';
      } else {
        statusLbl.innerHTML = `Virtual MIDI: <span style="color:#f87171; font-weight:700;">Stopped</span> <span id="btnFooterStartDriver" style="color:#ffffff; text-decoration:underline; cursor:pointer; margin-left:4px;" title="Click to start driver">[Start Driver]</span>`;
        const footerBtn = document.getElementById('btnFooterStartDriver');
        if (footerBtn) {
          footerBtn.onclick = () => this.startVirtualMidiDriver();
        }
      }
    }

    // 4. Legacy/HUD Elements
    if (badge && label) {
      if (active) {
        badge.className = 'hud-badge virtual-midi-badge connected';
        label.textContent = `MIDI: ${name || 'VLive MIDI Controller'}`;
      } else if (winmmActive && winmmPort) {
        badge.className = 'hud-badge virtual-midi-badge connected';
        label.textContent = `WINMM: ${winmmPort}`;
      } else {
        badge.className = 'hud-badge virtual-midi-badge disconnected';
        label.innerHTML = 'MIDI: INACTIVE';
      }
    }
  }

  async startVirtualMidiDriver() {
    const btnStart = document.getElementById('btnStartDriver');
    const btnQrStart = document.getElementById('btnQrStartDriver');
    if (btnStart) {
      btnStart.disabled = true;
      btnStart.textContent = 'Starting Driver...';
    }
    if (btnQrStart) {
      btnQrStart.disabled = true;
      btnQrStart.textContent = 'STARTING...';
    }
    try {
      const res = await fetch('/api/start_driver');
      const data = await res.json();
      if (data && data.virtual_active) {
        this.updateVirtualMidiStatus(true, data.virtual_name);
        this.showAlert('VIRTUAL MIDI ACTIVE', `Virtual MIDI Port "${data.virtual_name}" is now active!\nIt is visible in your DAW (Ableton Live, FL Studio, REAPER, Cubase).`);
      } else {
        this.showAlert('DRIVER SETUP', 'Virtual MIDI driver setup initiated.\nIf prompted by Windows User Account Control (UAC), please click "Yes" to allow driver activation.');
      }
    } catch (e) {
      console.warn('Failed to start virtual MIDI driver:', e);
    } finally {
      if (btnStart) {
        btnStart.disabled = false;
        btnStart.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> <span>Start Driver (Admin)</span>';
      }
      if (btnQrStart) {
        btnQrStart.disabled = false;
        btnQrStart.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> <span>START DRIVER (ADMIN)</span>';
      }
    }
  }

  flashVirtualMidiBadge() {
    const badge = document.getElementById('virtualMidiBadge');
    if (badge) {
      badge.classList.add('midi-flash');
      setTimeout(() => badge.classList.remove('midi-flash'), 120);
    }
  }

  async sendTestDawNote(btn) {
    if (btn) {
      btn.classList.add('active');
      const originalText = btn.innerHTML;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> SENT!';
      try {
        await fetch('/api/test_note');
      } catch (e) {}
      this.flashVirtualMidiBadge();
      setTimeout(() => {
        btn.classList.remove('active');
        btn.innerHTML = originalText;
      }, 400);
    } else {
      try {
        await fetch('/api/test_note');
      } catch (e) {}
      this.flashVirtualMidiBadge();
    }
  }

  async fetchMidiPorts() {
    try {
      const res = await fetch('/api/ports');
      if (res.ok) {
        const data = await res.json();
        const headerSel = document.getElementById('headerPortSelect');
        const modalSel = document.getElementById('winmmPortSelect');

        [headerSel, modalSel].forEach(select => {
          if (!select || !data.ports) return;
          select.innerHTML = '';

          const defOpt = document.createElement('option');
          defOpt.value = '';
          defOpt.textContent = `Virtual Port: ${data.virtual_name || 'VLive MIDI Controller'}`;
          select.appendChild(defOpt);

          data.ports.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = `${p} ${p === data.active ? '(WinMM Active)' : ''}`;
            if (p === data.active) opt.selected = true;
            select.appendChild(opt);
          });
        });

        const dawModalPort = document.getElementById('dawModalPortName');
        if (dawModalPort) {
          dawModalPort.textContent = data.virtual_name || 'VLive MIDI Controller';
        }
      }
    } catch (e) {}
  }

  async switchMidiPort(port) {
    try {
      const res = await fetch(`/api/connect_port?port=${encodeURIComponent(port)}`);
      if (res.ok) {
        await this.fetchServerInfo();
        await this.fetchMidiPorts();
      }
    } catch (e) {}
  }

  updateConnBadge(text, stateClass) {
    const badge = document.getElementById('connBadge');
    const label = document.getElementById('connLabel');
    if (badge) badge.className = `hud-badge ${stateClass}`;
    if (label) label.textContent = text;
  }

  async initWakeLock() {
    await this.requestWakeLock();
  }

  async requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        if (!this.screenWakeLock) {
          this.screenWakeLock = await navigator.wakeLock.request('screen');
          this.screenWakeLock.addEventListener('release', () => {
            this.screenWakeLock = null;
          });
        }
      } catch (_) {
        // WakeLock request can fail in background tabs or low battery mode
      }
    }
  }

  toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        const el = document.documentElement;
        if (el.requestFullscreen) {
          el.requestFullscreen().catch(() => {});
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    } catch (_) {}
  }

  toggleSettingsModal(open) {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.classList.toggle('open', open);
  }

  toggleDawSetupModal(open) {
    const modal = document.getElementById('modalDawSetup');
    if (modal) modal.classList.toggle('open', open);
  }
}

// Instantiate controller safely regardless of document ready state
function initVLiveApp() {
  if (!window.vlive) {
    try {
      window.vlive = new VLiveController();
    } catch (err) {
      console.error('Failed to initialize VLiveController:', err);
    }
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initVLiveApp);
} else {
  initVLiveApp();
}
