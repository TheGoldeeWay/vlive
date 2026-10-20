# VLive — Standalone Virtual Studio MIDI Controller System

[![Release](https://img.shields.io/badge/Release-v2.0.0-00ffcc?style=flat-square&logo=github)](https://github.com/blaze8486/vlive/releases/tag/v2.0.0)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011%20x64-0078d4?style=flat-square&logo=windows)](https://github.com/blaze8486/vlive/releases/latest)
[![C++](https://img.shields.io/badge/Standard-C%2B%2B20%20(Static%20%2FMT)-f34b7d?style=flat-square&logo=cplusplus)](https://github.com/blaze8486/vlive)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

**VLive** is a professional, high-performance virtual MIDI controller and live performance ecosystem engineered for sub-millisecond stage responsiveness, multi-performer synchronization, and instant DAW integration on Windows.

VLive is **100% standalone and software-based**: it creates an in-process native Windows MIDI device (**"VLive MIDI Controller"**) that any Digital Audio Workstation (REAPER, Ableton Live, FL Studio, Steinberg Nuendo/Cubase, Bitwig) detects immediately without needing external hardware, COM ports, or loopMIDI apps.

---

## 🚀 Downloads (Latest Release v2.0.0)

Grab the turnkey Windows distribution directly from the [Releases Page](https://github.com/blaze8486/vlive/releases/latest):

| Package | Format | Description | Direct Download |
| :--- | :--- | :--- | :--- |
| **VLive Turnkey Installer** | `.exe` (~3.7 MB) | Automatic installer with driver auto-configuration & firewall registration | [VLive_Setup_x64.exe](https://github.com/blaze8486/vlive/releases/download/v2.0.0/VLive_Setup_x64.exe) |
| **VLive Portable Package** | `.zip` (~4.1 MB) | Zero-install portable edition ready for USB sticks & stage laptops | [VLive_v2.0.0_Portable_x64.zip](https://github.com/blaze8486/vlive/releases/download/v2.0.0/VLive_v2.0.0_Portable_x64.zip) |
| **VLive Complete Distribution** | `.zip` (~11.4 MB) | Full bundle containing installer, portable exe, drivers, and user manual | [VLive_v2.0.0_Final_Distribution_x64.zip](https://github.com/blaze8486/vlive/releases/download/v2.0.0/VLive_v2.0.0_Final_Distribution_x64.zip) |
| **Official User Manual** | `.pdf` (~750 KB) | Comprehensive setup, network tuning & DAW connection manual | [VLive_User_Manual.pdf](https://github.com/blaze8486/vlive/releases/download/v2.0.0/VLive_User_Manual.pdf) |

Verify file authenticity with [`checksums.sha256`](https://github.com/blaze8486/vlive/releases/download/v2.0.0/checksums.sha256).

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PERFORMER CLIENT DEVICES                        │
│                                                                        │
│   Device 1 (iPad Pro)         Device 2 (Phone)       Host PC (Desktop) │
│   Role: MPC Drum Pads (Ch 10) Role: Lead Synth (Ch 1)Role: Custom Rig  │
│   Link: Wi-Fi LAN (~2ms)      Link: Wi-Fi LAN (~2ms) Link: Localhost   │
└───────────────┬───────────────────────┬──────────────────────┬─────────┘
                │                       │                      │
                │ Binary WebSocket      │ Binary WebSocket     │ Embedded WebView2
                │ (3-byte MIDI frame)   │ (3-byte MIDI frame)  │ (Direct memory pipe)
                ▼                       ▼                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        VLIVE C++ CORE ENGINE                           │
│                                                                        │
│  • Embedded HTTP & RFC 6455 WebSocket Server (Winsock2, TCP_NODELAY)   │
│  • In-Process Native Virtual MIDI Driver (teVirtualMIDI engine)        │
│  • Microsecond 24 PPQN Master MIDI Clock & NTP-Style Phase Synchronizer │
│  • Multi-Device Session State Synchronizer (Bi-directional reflection) │
│  • Interactive DAW Setup Assistant Modal & One-Click Test Note         │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   │ Native Windows In-Process MIDI Stream
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 VIRTUAL DEVICE: "VLive MIDI Controller"                │
│                                                                        │
│   Receives Notes, Velocity, Pitch Bend, CC Knobs/Faders, Clock Sync    │
│   Fallback: Direct Windows Multimedia (WinMM) output routing           │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       DIGITAL AUDIO WORKSTATIONS                       │
│      REAPER / Ableton Live / FL Studio / Nuendo / Cubase / Bitwig      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Key Features

1. **Zero-Hardware In-Process Virtual MIDI Port**:
   - Creates the native Windows MIDI device `"VLive MIDI Controller"` on startup.
   - Any DAW detects it immediately as a hardware-like MIDI input.
   - For fresh Windows computers without virtual MIDI installed, VLive bundles and automatically registers the signed driver (`drivers\teVirtualMIDI64.msi`) silently.

2. **DAW Setup Assistant & Instant Testing**:
   - Click the **"⚡ TEST DAW"** button in the top bar to send a Middle C test note directly into your DAW and see channel meters react.
   - Click **"DAW SETUP"** to open an interactive modal with click-by-click instructions for **REAPER**, **Nuendo/Cubase**, **Ableton Live**, and **FL Studio**.

3. **Stage-Ready Multi-Touch Web Controller Interface**:
   - Pure HTML5/CSS3/modern JS PWA (Zero external CDN dependencies, works 100% offline).
   - **MPC Drum Pads**: 16 velocity-sensitive responsive pads, 4 banks (A-D, 64 notes), visual strike ripples.
   - **Melodic Keybed**: Multi-touch polyphonic piano with Scale Lock (Major, Minor, Pentatonic, Blues, Dorian), Octave shifts, Pitch Bend ribbon (with spring-center), and Mod Wheel.
   - **XY Touchpad**: Continuous 2D surface for filter cutoff & resonance with return-to-center physics.
   - **Live Mixer Console**: 8 channel strips with volume faders, rotary pan knobs, Mute, Solo, and Master fader.
   - **16-Step Drum Sequencer**: Pattern grid locked to the master 24 PPQN MIDI clock.

4. **Multi-Device Jamming & Synchronization**:
   - Connect 10+ phones, tablets, and laptops simultaneously via local Wi-Fi.
   - **Microsecond Clock Sync**: NTP ping-pong algorithm calculates Round Trip Time (RTT) and phase offset for every device.
   - **State Sync**: Parameter changes (faders, tempo, mutes) on one device reflect instantly across all other connected screens.

5. **Interactive Custom UI Builder**:
   - Add rotary Knobs, vertical Faders, velocity-sensitive Pads, Momentary Trigger Buttons, Toggle Switches, and 2D XY Pads onto a responsive stage canvas.
   - Assign custom MIDI message types (CC, Note, Pitch Bend), MIDI channels (Ch 1 - 16), and custom numbers (0-127).
   - Instant presets for Synth Decks, 4-Channel DJ Mixers, 4-Track Stems, and Drum Racks, with complete JSON Export and Import.

---

## Quickstart Guide

### 1. Launch VLive Desktop GUI (`VLive.exe`)
Simply double-click **`VLive.exe`** in the project folder.

- The application window opens with dark mode UI.
- The in-process native virtual device **`VLive MIDI Controller`** is automatically initialized and active.
- To test connection to your DAW, press **`⚡ TEST DAW`** in the top bar.

### 2. Enabling VLive in Your DAW

#### REAPER (x64)
1. Open **Options > Preferences** (`Ctrl + P`) and navigate to **Audio > MIDI Devices**.
2. Find **`VLive MIDI Controller`** under *MIDI inputs to make available to tracks...*
3. **Right-click** `VLive MIDI Controller` and select **Enable input** and check **Enable input for control messages**.
4. Create a new track (`Ctrl + T`), set input to `Input: MIDI > VLive MIDI Controller > All Channels`, and arm record.
5. Click **TEST DAW** in VLive — the track meter jumps!

#### Steinberg Nuendo / Cubase
1. Open **Studio > Studio Setup...** from the top menu.
2. Select **MIDI Port Setup** in the left hierarchy list.
3. Locate **`VLive MIDI Controller`** under Input Ports. Ensure the state is **Active** and check the box in **"In 'All MIDI Inputs'"**.
4. Click **OK**. Any track set to *All MIDI Inputs* will now respond.

#### Ableton Live
1. Open **Options > Preferences** (`Ctrl + ,`) and select the **Link / Tempo / MIDI** tab.
2. Under **MIDI Ports**, locate `Input: VLive MIDI Controller`.
3. Toggle both **Track: ON** and **Remote: ON**.

#### FL Studio
1. Press `F10` to open **MIDI Settings**.
2. Under **Input**, click on `VLive MIDI Controller`.
3. Click the **Enable** button below the list (turns orange/green).

---

## Building from Source

Requirements: Windows 10/11, CMake 3.20+, Visual Studio 2022 (MSVC with C++20).

```bat
# Configure and build Release binaries
cmake -B build -S .
cmake --build build --config Release
```

Output binaries:
- **`VLive.exe`**: Native Windows desktop GUI application.
- **`build\Release\vlive_core.exe`**: Headless CLI server with terminal HUD.
- **`build\Release\test_e2e_virtual_midi.exe`**: Automated loopback test verifying Windows MIDI subsystem communication.
- **`build\Release\test_midi.exe`**: MIDI message & lock-free ring buffer unit tests.
- **`build\Release\test_sync.exe`**: Clock & NTP synchronization tests.

---

## Author & Contact

Developed by **Anish Goswami (Goldee)**  
Email: [anishgoswami98@gmail.com](mailto:anishgoswami98@gmail.com)  
GitHub: [@blaze8486](https://github.com/blaze8486)  
Project Repository: [https://github.com/blaze8486/vlive](https://github.com/blaze8486/vlive)

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details. Built with precision for live electronic stage performance and modern studio production.
