/**
 * VLive — Universal User Manual & Technical Reference Generator
 * Compiles a publication-grade, universal PDF manual for any user downloading VLive.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 1. Encode Branding Assets
let logoBase64 = '';
const iconPath = path.join(rootDir, 'my assets', 'Vliveicon.png');
if (fs.existsSync(iconPath)) {
  logoBase64 = `data:image/png;base64,${fs.readFileSync(iconPath).toString('base64')}`;
}

let fontBase64 = '';
const fontPath = path.join(rootDir, 'my assets', 'Gotham-Book.otf');
if (fs.existsSync(fontPath)) {
  fontBase64 = `data:font/otf;base64,${fs.readFileSync(fontPath).toString('base64')}`;
}

// 2. Generate Universal HTML Content
const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>VLive Official User Manual & Technical Reference Guide</title>
<style>
  @font-face {
    font-family: 'Gotham';
    src: url('${fontBase64}') format('opentype');
    font-weight: normal;
    font-style: normal;
  }

  @page {
    size: A4 portrait;
    margin: 18mm 16mm 20mm 16mm;
    @bottom-right {
      content: counter(page);
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 8.5pt;
      color: #71717a;
    }
    @bottom-left {
      content: "VLive v2.0.0 — Universal User Manual (Made by Goldee)";
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 8.5pt;
      color: #71717a;
    }
  }

  @page:first {
    margin: 0;
    @bottom-right { content: none; }
    @bottom-left { content: none; }
  }

  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  body {
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
    color: #18181b;
    background: #ffffff;
    line-height: 1.55;
    font-size: 9.8pt;
    margin: 0;
    padding: 0;
  }

  h1, h2, h3, h4, h5 {
    color: #09090b;
    font-family: 'Gotham', 'Segoe UI', sans-serif;
    letter-spacing: -0.02em;
    margin-top: 1.3em;
    margin-bottom: 0.45em;
    page-break-after: avoid;
  }

  h1 { font-size: 19pt; border-bottom: 2px solid #09090b; padding-bottom: 6px; margin-top: 0; }
  h2 { font-size: 13.5pt; border-bottom: 1px solid #e4e4e7; padding-bottom: 4px; color: #18181b; }
  h3 { font-size: 11pt; color: #27272a; }
  h4 { font-size: 10pt; color: #3f3f46; }

  p { margin: 0.4em 0 0.7em; }
  ul, ol { margin: 0.4em 0 0.7em; padding-left: 1.5em; }
  li { margin-bottom: 0.25em; }

  .page-break {
    page-break-before: always;
  }

  /* Cover Page */
  .cover-page {
    width: 100vw;
    height: 100vh;
    background: #09090c;
    color: #f4f4f5;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 26mm 22mm 22mm 22mm;
    page-break-after: always;
  }

  .cover-logo-wrap {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .cover-logo {
    width: 72px;
    height: 72px;
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(255,255,255,0.12);
  }

  .cover-badge {
    display: inline-block;
    background: #27272a;
    color: #e4e4e7;
    font-size: 8.5pt;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: 20px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border: 1px solid #3f3f46;
  }

  .cover-title {
    font-size: 32pt;
    font-weight: 800;
    color: #ffffff;
    line-height: 1.05;
    margin: 16px 0 6px;
    border: none;
    padding: 0;
    letter-spacing: -0.03em;
  }

  .cover-subtitle {
    font-size: 12.5pt;
    color: #a1a1aa;
    line-height: 1.45;
    margin-bottom: 20px;
    max-width: 580px;
  }

  .cover-features-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-top: 16px;
  }

  .cover-feature-card {
    background: #121216;
    border: 1px solid #27272a;
    border-radius: 10px;
    padding: 12px 14px;
  }

  .cover-feature-card h4 {
    margin: 0 0 4px;
    color: #f4f4f5;
    font-size: 9.5pt;
  }

  .cover-feature-card p {
    margin: 0;
    font-size: 8.3pt;
    color: #a1a1aa;
    line-height: 1.35;
  }

  .cover-footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-top: 1px solid #27272a;
    padding-top: 14px;
    font-size: 8.5pt;
    color: #71717a;
  }

  .cover-footer strong {
    color: #d4d4d8;
  }

  /* Table of Contents */
  .toc-list {
    list-style: none;
    padding: 0;
    margin: 10px 0;
  }

  .toc-item {
    display: flex;
    justify-content: space-between;
    border-bottom: 1px dotted #d4d4d8;
    padding: 6px 0;
    font-size: 9.5pt;
  }

  .toc-item a {
    color: #18181b;
    text-decoration: none;
    font-weight: 600;
  }

  .toc-page {
    color: #71717a;
    font-weight: 500;
  }

  /* Callouts & Tables */
  .callout {
    padding: 9px 13px;
    border-radius: 7px;
    margin: 10px 0;
    font-size: 8.8pt;
    line-height: 1.4;
    page-break-inside: avoid;
  }

  .callout-tip {
    background: #f0fdf4;
    border-left: 4px solid #16a34a;
    color: #166534;
  }

  .callout-note {
    background: #f4f4f5;
    border-left: 4px solid #52525b;
    color: #27272a;
  }

  .callout-warn {
    background: #fffbeb;
    border-left: 4px solid #f59e0b;
    color: #92400e;
  }

  .callout strong {
    display: block;
    margin-bottom: 2px;
    font-size: 9.2pt;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0 14px;
    font-size: 8.8pt;
    page-break-inside: avoid;
  }

  th {
    background: #18181b;
    color: #ffffff;
    text-align: left;
    padding: 7px 9px;
    font-weight: 600;
    border: 1px solid #18181b;
  }

  td {
    padding: 6px 9px;
    border: 1px solid #e4e4e7;
    vertical-align: top;
  }

  tr:nth-child(even) td {
    background: #fafafa;
  }

  code {
    font-family: 'Consolas', 'Courier New', monospace;
    background: #f4f4f5;
    color: #09090b;
    padding: 1px 4px;
    border-radius: 4px;
    font-size: 8.2pt;
    border: 1px solid #e4e4e7;
  }

  pre {
    background: #09090c;
    color: #e4e4e7;
    padding: 10px 12px;
    border-radius: 7px;
    font-family: 'Consolas', monospace;
    font-size: 8.2pt;
    line-height: 1.4;
    overflow-x: auto;
    page-break-inside: avoid;
    border: 1px solid #27272a;
  }

  pre code {
    background: transparent;
    color: inherit;
    border: none;
    padding: 0;
  }

  .widget-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin: 10px 0;
    page-break-inside: avoid;
  }

  .widget-box {
    border: 1px solid #e4e4e7;
    border-radius: 7px;
    padding: 9px 11px;
    background: #ffffff;
  }

  .widget-box h4 {
    margin: 0 0 3px;
    color: #09090b;
    font-size: 9.5pt;
  }

  .widget-box p {
    font-size: 8.3pt;
    color: #52525b;
    margin: 0;
    line-height: 1.35;
  }

  .step-num {
    display: inline-block;
    background: #09090b;
    color: #ffffff;
    width: 19px;
    height: 19px;
    border-radius: 50%;
    text-align: center;
    line-height: 19px;
    font-size: 7.8pt;
    font-weight: 700;
    margin-right: 5px;
  }
</style>
</head>
<body>

<!-- COVER PAGE -->
<div class="cover-page">
  <div>
    <div class="cover-logo-wrap">
      ${logoBase64 ? `<img src="${logoBase64}" class="cover-logo" alt="VLive Logo">` : ''}
      <div>
        <span class="cover-badge">Universal Distribution Edition &bull; v2.0.0</span>
      </div>
    </div>

    <h1 class="cover-title">VLive User Manual</h1>
    <div class="cover-subtitle">
      The Complete Guide to Installing, Connecting, Operating, and Customizing VLive — The Ultra-Low-Latency Live Stage MIDI Controller Ecosystem for Windows & Mobile Web.
    </div>

    <div class="cover-features-grid">
      <div class="cover-feature-card">
        <h4>Universal Plug-and-Play</h4>
        <p>In-process virtual MIDI driver instantly recognized by Ableton Live, FL Studio, REAPER, Cubase, Studio One, and Bitwig Studio.</p>
      </div>
      <div class="cover-feature-card">
        <h4>Microsecond Jitter Defense</h4>
        <p>Hardware-grade master clock synchronization over binary WebSockets with MMCSS Pro Audio real-time scheduling.</p>
      </div>
      <div class="cover-feature-card">
        <h4>Zero Runtime Dependencies</h4>
        <p>Statically linked C++20 engine with embedded PWA assets in RAM. Runs on any Windows 10 or 11 system out-of-the-box.</p>
      </div>
      <div class="cover-feature-card">
        <h4>Cross-Device Stage Dock</h4>
        <p>Instant QR code pairing for iPhone, iPad, Android tablets, phones, and secondary laptops without drivers or cables.</p>
      </div>
    </div>
  </div>

  <div class="cover-footer">
    <div>
      <div><strong>Author & Lead Architect:</strong> Goldee</div>
      <div><strong>Audience:</strong> Musicians, Live PA Artists, Audio Engineers & Producers</div>
      <div><strong>Official Repository:</strong> https://github.com/goldee/vlive</div>
    </div>
    <div style="text-align: right;">
      <div><strong>Document ID:</strong> VLIVE-DOC-2026-V2</div>
      <div><strong>Target Platforms:</strong> Windows 10/11 x64 & iOS/Android/Web</div>
      <div><strong>Distribution:</strong> Universal End-User Release</div>
    </div>
  </div>
</div>

<!-- 5-MINUTE UNIVERSAL QUICK START -->
<div class="page-break"></div>
<h1>Universal 5-Minute Quick Start Guide</h1>

<div class="callout callout-tip">
  <strong>Got 5 Minutes? Start Here!</strong>
  Follow these 4 simple steps to get VLive running with your DAW and mobile device immediately:
</div>

<div class="widget-grid">
  <div class="widget-box">
    <h4><span class="step-num">1</span> Install or Run VLive</h4>
    <p>Double-click <code>VLive_Setup_x64.exe</code> (Turnkey Installer) or launch <code>VLive.exe</code> (Portable). When prompted by Windows User Account Control (UAC), click <strong>Yes</strong> to enable the virtual MIDI driver.</p>
  </div>
  <div class="widget-box">
    <h4><span class="step-num">2</span> Open Your DAW & Enable MIDI</h4>
    <p>Launch Ableton Live, FL Studio, or REAPER. Open <strong>MIDI Preferences</strong>. Locate <code>VLive MIDI Controller</code> in the MIDI input list and set it to <strong>Track: ON</strong> and <strong>Remote: ON</strong>.</p>
  </div>
  <div class="widget-box">
    <h4><span class="step-num">3</span> Scan the QR Code</h4>
    <p>Ensure your smartphone or tablet is connected to the same Wi-Fi network (or laptop hotspot). Click the <strong>QR Code icon</strong> in VLive's top bar and scan it with your phone/tablet camera.</p>
  </div>
  <div class="widget-box">
    <h4><span class="step-num">4</span> Perform Live!</h4>
    <p>Touch any knob, fader, pad, or switch on your mobile screen. Your DAW receives the MIDI signal instantly with under 1ms latency. You're ready for the stage!</p>
  </div>
</div>

<h2>Table of Contents</h2>
<ul class="toc-list">
  <li class="toc-item"><span><strong>1. Introduction & Core Architecture</strong></span><span class="toc-page">Page 3</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;1.1 What is VLive?</span><span class="toc-page">Page 3</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;1.2 Core System Architecture</span><span class="toc-page">Page 3</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;1.3 Universal Compatibility & System Requirements</span><span class="toc-page">Page 4</span></li>

  <li class="toc-item"><span><strong>2. Installation & Setup Guide</strong></span><span class="toc-page">Page 5</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;2.1 Turnkey Windows Installer (VLive_Setup_x64.exe)</span><span class="toc-page">Page 5</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;2.2 Zero-Install Standalone Portable Package</span><span class="toc-page">Page 5</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;2.3 Windows Defender Firewall Auto-Registration</span><span class="toc-page">Page 6</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;2.4 Command-Line Flags & Studio Automation</span><span class="toc-page">Page 6</span></li>

  <li class="toc-item"><span><strong>3. Network Configuration & Multi-Device Pairing</strong></span><span class="toc-page">Page 7</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;3.1 Subnet Radar & Multi-NIC Interface Binding</span><span class="toc-page">Page 7</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;3.2 Mobile Pairing via QR Code & Direct IP</span><span class="toc-page">Page 7</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;3.3 Installing as an Offline Mobile PWA (iOS / Android)</span><span class="toc-page">Page 8</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;3.4 Universal Stage Topologies (Router, Hotspot, USB Tether)</span><span class="toc-page">Page 8</span></li>

  <li class="toc-item"><span><strong>4. DAW Integration & Virtual MIDI Configuration</strong></span><span class="toc-page">Page 9</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;4.1 In-Process Virtual MIDI vs WinMM Fallback</span><span class="toc-page">Page 9</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;4.2 Ableton Live Setup (All Versions)</span><span class="toc-page">Page 9</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;4.3 FL Studio Setup</span><span class="toc-page">Page 10</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;4.4 REAPER Setup</span><span class="toc-page">Page 10</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;4.5 Cubase, Nuendo, Studio One & Bitwig Studio</span><span class="toc-page">Page 11</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;4.6 Full-Duplex DAW Bi-Directional Synchronization</span><span class="toc-page">Page 11</span></li>

  <li class="toc-item"><span><strong>5. Runtime Operation & Live Performance</strong></span><span class="toc-page">Page 12</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;5.1 Desktop Interface & Monochromatic Dark Theme</span><span class="toc-page">Page 12</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;5.2 Master Clock & 24 PPQN BPM Engine</span><span class="toc-page">Page 12</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;5.3 Continuous Background Operation & System Tray</span><span class="toc-page">Page 13</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;5.4 Real-Time OS Hardening (MMCSS & 1ms Kernel Timer)</span><span class="toc-page">Page 13</span></li>

  <li class="toc-item"><span><strong>6. Edit & Design Manual (Canvas & Custom Widgets)</strong></span><span class="toc-page">Page 14</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;6.1 Play Mode vs Design Mode ("Go to Edit" / "Go to Play")</span><span class="toc-page">Page 14</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;6.2 Complete Widget Library Reference</span><span class="toc-page">Page 14</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;6.3 Inspector & MIDI Parameter Configuration</span><span class="toc-page">Page 15</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;6.4 Multi-Page Management (Add, Rename, Duplicate, Delete)</span><span class="toc-page">Page 16</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;6.5 Session Profiles, Export & Import (.vlive)</span><span class="toc-page">Page 16</span></li>

  <li class="toc-item"><span><strong>7. Diagnostics, Troubleshooting & Technical Reference</strong></span><span class="toc-page">Page 17</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;7.1 Rotating Diagnostics Log & Minidumps</span><span class="toc-page">Page 17</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;7.2 Virtual MIDI Driver Self-Recovery</span><span class="toc-page">Page 17</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;7.3 Comprehensive Universal Troubleshooting Matrix</span><span class="toc-page">Page 18</span></li>
  <li class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;7.4 Technical Specifications & Performance Benchmarks</span><span class="toc-page">Page 19</span></li>
</ul>

<!-- CHAPTER 1 -->
<div class="page-break"></div>
<h1>1. Introduction & Core Architecture</h1>

<h2>1.1 What is VLive?</h2>
<p>
<strong>VLive</strong> is an ultra-low-latency live stage MIDI controller and studio synchronization ecosystem engineered specifically for Windows workstations (x64) and professional Digital Audio Workstations (DAWs) including Ableton Live, FL Studio, REAPER, Cubase, Studio One, and Bitwig Studio.
</p>
<p>
By bridging a high-performance C++20 native engine with an embedded, touch-optimized Progressive Web Application (PWA), VLive transforms any smartphone, iPad, tablet, or secondary laptop into a modular, responsive hardware-grade control surface. Whether you need rotary knobs, motorized-feel slider faders, velocity drum pads, dual-action XY modulation matrices, or latching stage switches, VLive delivers instantaneous tactile command without proprietary external hardware.
</p>

<h2>1.2 Core System Architecture</h2>
<p>
Unlike conventional web-to-MIDI utilities that suffer from browser garbage collection pauses, USB driver desync, or high-jitter network polling, VLive executes on an unmanaged, real-time native architecture:
</p>

<pre><code>+---------------------------------------------------------------------------------+
|                       VLive Native Windows Workstation                          |
|                                                                                 |
|   +-----------------------+     Binary WebSocket    +-----------------------+   |
|   |   Embedded Web/PWA    | &lt;=====================&gt; |  Asynchronous Server  |   |
|   |  (Single-Binary RAM)  |       Frame Codec       |  (Non-blocking I/O)   |   |
|   +-----------------------+                         +-----------+-----------+   |
|                                                                 |               |
|                                              +------------------+---------------+
|                                              | Lock-Free Dispatch Ring Buffer   |
|                                              +------------------+---------------+
|                                                                 |               |
|            +----------------------------------------------------+               |
|            | MMCSS "Pro Audio" Worker Thread (1ms Kernel Timer Period)          |
|            +------------------------+-----------------------------------+       |
|                                     |                                           |
|                     +---------------+---------------+                           |
|                     |                               |                           |
|         +-----------v------------+      +-----------v------------+              |
|         | in-process teVirtualMIDI |     | WinMM Direct MIDI Out  |              |
|         | Kernel Virtual Port    |      | (Legacy Fallback)      |              |
|         +-----------+------------+      +-----------+------------+              |
|                     |                               |                           |
+---------------------|-------------------------------|---------------------------+
                      |                               |
                      v                               v
         +---------------------------------------------------------+
         |     Target DAW (Ableton Live, FL Studio, REAPER)        |
         +---------------------------------------------------------+</code></pre>

<ul>
  <li><strong>Static C++20 Zero-Dependency Core:</strong> Built strictly with <code>/MT</code> static runtime linking. Runs out-of-the-box on bare Windows 10/11 installations without requiring Visual C++ Redistributable packages.</li>
  <li><strong>In-Process Kernel Virtual MIDI Device:</strong> Communicates directly with the Windows Multimedia subsystem via <code>teVirtualMIDI64.dll</code>, instantiating the virtual MIDI port <code>"VLive MIDI Controller"</code> in-process.</li>
  <li><strong>Microsecond NTP-Style Clock Synchronization:</strong> Employs a round-trip time (RTT) time-stamped synchronization loop over raw binary WebSockets, broadcasting 24 PPQN MIDI Clock ticks with sub-millisecond precision.</li>
  <li><strong>In-Memory PWA RAM Serving:</strong> All 11 client-tier PWA assets (HTML, CSS, JavaScript, fonts, icons, manifest) are compiled into C++ byte arrays directly within <code>VLive.exe</code>. The app can be moved anywhere on disk without breaking file paths.</li>
</ul>

<h2>1.3 Universal Compatibility & System Requirements</h2>
<table>
  <tr>
    <th>System Component</th>
    <th>Minimum Requirement</th>
    <th>Recommended Stage Specification</th>
  </tr>
  <tr>
    <td><strong>Operating System</strong></td>
    <td>Windows 10 x64 (Version 1809+)</td>
    <td>Windows 10 / 11 x64 (Latest Build)</td>
  </tr>
  <tr>
    <td><strong>Host CPU</strong></td>
    <td>Intel Core i3 / AMD Ryzen 3 (Dual-Core)</td>
    <td>Intel Core i5/i7 / AMD Ryzen 5/7 (Quad-Core+)</td>
  </tr>
  <tr>
    <td><strong>System RAM</strong></td>
    <td>4 GB RAM</td>
    <td>8 GB+ RAM</td>
  </tr>
  <tr>
    <td><strong>Network Adapter</strong></td>
    <td>Standard Wi-Fi 802.11n (2.4 GHz)</td>
    <td>Dedicated 5 GHz 802.11ac/ax Wi-Fi Router or Laptop Hotspot</td>
  </tr>
  <tr>
    <td><strong>Performer Devices</strong></td>
    <td>Any smartphone, iPad, tablet, or laptop</td>
    <td>Apple iPad (iOS 15+) or Android Tablet (Chrome 100+)</td>
  </tr>
  <tr>
    <td><strong>Supported DAWs</strong></td>
    <td>Any Windows software supporting standard MIDI</td>
    <td>Ableton Live 10/11/12, FL Studio 20/21/24, REAPER 6/7, Cubase 12/13/14</td>
  </tr>
</table>

<!-- CHAPTER 2 -->
<div class="page-break"></div>
<h1>2. Installation & Setup Guide</h1>

<h2>2.1 Turnkey Windows Installer (VLive_Setup_x64.exe)</h2>
<p>
The turnkey installer is the recommended installation method for studio workstations and touring laptops. It automatically handles administrative permissions, driver installation, and firewall registration.
</p>

<ol>
  <li>Locate <code>VLive_Setup_x64.exe</code> inside your downloaded package.</li>
  <li>Double-click the installer. When prompted by Windows User Account Control (UAC), click <strong>Yes</strong>.</li>
  <li>Select your destination folder (default: <code>C:\Program Files\VLive</code>).</li>
  <li>
    <strong>Automated Silent Tasks:</strong> During installation, the setup wizard automatically:
    <ul>
      <li>Installs and registers the signed <strong>teVirtualMIDI64</strong> kernel driver.</li>
      <li>Configures the <code>teVirtualMIDI64</code> Windows system service to <strong>Auto-Start on Boot</strong>.</li>
      <li>Inspects the OS for Microsoft Edge WebView2 Evergreen Runtime, silently installing it if absent.</li>
      <li>Registers Windows Defender Firewall rules for inbound/outbound TCP and UDP traffic across both Private and Public network profiles.</li>
      <li>Creates Start Menu and Desktop shortcuts with the official monochromatic VLive icon.</li>
    </ul>
  </li>
  <li>Click <strong>Finish</strong> with <em>"Launch VLive MIDI Controller"</em> selected.</li>
</ol>

<div class="callout callout-tip">
  <strong>Pro Tip: Zero-Reboot Guarantee</strong>
  VLive's installer configures and starts the teVirtualMIDI driver service on-the-fly. You do NOT need to restart your computer before launching your DAW.
</div>

<h2>2.2 Zero-Install Standalone Portable Package</h2>
<p>
For touring musicians on restricted studio rigs or USB thumb-drive setups, VLive provides a 100% portable, zero-install distribution:
</p>
<ol>
  <li>Extract <code>VLive_v2.0.0_Portable_x64.zip</code> to any folder or USB drive.</li>
  <li>
    <strong>Driver Check:</strong> If launching VLive on a brand-new Windows PC for the first time, run the bundled driver installer located in <code>drivers\teVirtualMIDI64.msi</code> once with administrator privileges.
  </li>
  <li>Launch <code>VLive.exe</code> directly. All web assets, fonts, icons, and server endpoints are served directly from RAM.</li>
</ol>

<h2>2.3 Windows Defender Firewall Auto-Registration</h2>
<p>
Stage and venue Wi-Fi networks are almost universally classified as <strong>Public Networks</strong> by Windows. By default, Windows Defender blocks unsolicited inbound local connections on Public networks.
</p>
<p>
VLive ensures smooth connectivity through two automated mechanisms:
</p>
<ul>
  <li><strong>Installer Automation:</strong> The setup wizard automatically adds firewall rules for <code>VLive.exe</code> with <code>profile=any</code>.</li>
  <li><strong>One-Click CLI Elevation:</strong> If running portably, you can register firewall rules at any time by executing:
    <pre><code>VLive.exe --register-firewall</code></pre>
  </li>
</ul>

<h2>2.4 Command-Line Flags & Studio Automation</h2>
<p>
VLive accepts optional command-line arguments for specialized studio setups:
</p>
<table>
  <tr>
    <th>Flag</th>
    <th>Default</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>--port &lt;number&gt;</code></td>
    <td><code>8088</code></td>
    <td>Overrides the default HTTP and WebSocket listening port. Example: <code>VLive.exe --port 9000</code></td>
  </tr>
  <tr>
    <td><code>--bpm &lt;number&gt;</code></td>
    <td><code>120.0</code></td>
    <td>Specifies the initial master clock tempo upon launch. Example: <code>VLive.exe --bpm 132.5</code></td>
  </tr>
  <tr>
    <td><code>--register-firewall</code></td>
    <td>N/A</td>
    <td>Requests UAC elevation, registers TCP and UDP Defender Firewall rules for all profiles, and exits cleanly.</td>
  </tr>
</table>

<!-- CHAPTER 3 -->
<div class="page-break"></div>
<h1>3. Network Configuration & Multi-Device Pairing</h1>

<h2>3.1 Subnet Radar & Multi-NIC Interface Binding</h2>
<p>
Modern studio computers frequently have multiple network interfaces: Wi-Fi, Ethernet, WSL2 virtual switches, Hyper-V virtual bridges, VPN adapters (NordLynx, WireGuard), and VirtualBox host-only adapters.
</p>
<p>
VLive features an intelligent <strong>Multi-NIC Subnet Radar</strong> that:
</p>
<ul>
  <li>Enumerates all active adapters via Windows <code>GetAdaptersAddresses</code> API.</li>
  <li>Automatically filters out virtual adapters containing terms such as <code>WSL</code>, <code>vEthernet</code>, <code>VirtualBox</code>, <code>VMware</code>, <code>TAP-</code>, or <code>VPN</code>.</li>
  <li>Prioritizes physical 802.11 Wi-Fi adapters and active LAN Ethernet connections.</li>
  <li>Selects the primary routable IP address and exposes all detected physical adapters in the UI.</li>
</ul>

<h2>3.2 Mobile Pairing via QR Code & Direct IP</h2>
<p>
Connecting performer phones and tablets requires zero manual IP typing:
</p>

<div class="widget-grid">
  <div class="widget-box">
    <h4><span class="step-num">1</span> Connect to Same Wi-Fi</h4>
    <p>Ensure your smartphone or tablet is connected to the same Wi-Fi network or mobile hotspot as your Windows laptop.</p>
  </div>
  <div class="widget-box">
    <h4><span class="step-num">2</span> Open QR Dock in VLive</h4>
    <p>Click the <strong>QR Code icon</strong> in the top header bar of the VLive desktop window to reveal the pairing modal.</p>
  </div>
  <div class="widget-box">
    <h4><span class="step-num">3</span> Scan with Camera</h4>
    <p>Open your mobile device's default Camera app (iOS Camera or Android Google Lens) and point it at the QR code.</p>
  </div>
  <div class="widget-box">
    <h4><span class="step-num">4</span> Instant Stage Controller</h4>
    <p>Tap the banner to instantly launch the VLive touch controller in Safari, Chrome, or Edge with microsecond sync.</p>
  </div>
</div>

<div class="callout callout-note">
  <strong>Manual IP Fallback</strong>
  If your mobile device camera is unavailable, type the URL displayed beneath the QR code (for example: <code>http://192.168.1.105:8088</code>) into your mobile browser address bar.
</div>

<h2>3.3 Installing as an Offline Mobile PWA (iOS / Android)</h2>
<p>
For the ultimate stage experience without address bars or browser navigation chrome, install VLive as a standalone Progressive Web App:
</p>
<ul>
  <li><strong>Apple iOS & iPadOS (Safari):</strong> Tap the <strong>Share</strong> button (box with upward arrow) at the bottom of the screen, scroll down, and select <strong>"Add to Home Screen"</strong>. Tap <em>Add</em>. Launch VLive from your home screen icon for full-screen immersive display.</li>
  <li><strong>Android (Google Chrome):</strong> Tap the three-dot menu icon in the upper-right corner and select <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>. Confirm the prompt.</li>
</ul>

<h2>3.4 Universal Stage Topologies (Router, Hotspot, USB Tether)</h2>
<table>
  <tr>
    <th>Environment</th>
    <th>Recommended Setup</th>
    <th>Latency Expectation</th>
  </tr>
  <tr>
    <td><strong>Dedicated 5GHz Router (Stage)</strong></td>
    <td>Dual-band 802.11ac/ax router with hidden SSID. Connect only your DAW PC and performance tablets.</td>
    <td><strong>0.5 ms – 1.2 ms</strong> (Virtually imperceptible)</td>
  </tr>
  <tr>
    <td><strong>Windows Mobile Hotspot (Touring)</strong></td>
    <td>Enable "Mobile Hotspot" in Windows Settings (select 5 GHz band). Connect phones/iPads directly to your laptop.</td>
    <td><strong>0.8 ms – 1.8 ms</strong> (Hardware-grade response)</td>
  </tr>
  <tr>
    <td><strong>Home Studio Wi-Fi</strong></td>
    <td>Standard home router on 5 GHz band. Avoid heavy background downloads during recording sessions.</td>
    <td><strong>1.0 ms – 2.5 ms</strong> (Excellent responsiveness)</td>
  </tr>
  <tr>
    <td><strong>USB Reverse Tethering (Zero-RF)</strong></td>
    <td>Connect tablet via USB cable with USB tethering enabled. Immune to venue RF interference.</td>
    <td><strong>0.2 ms – 0.5 ms</strong> (Absolute minimum latency)</td>
  </tr>
</table>

<!-- CHAPTER 4 -->
<div class="page-break"></div>
<h1>4. DAW Integration & Virtual MIDI Configuration</h1>

<h2>4.1 In-Process Virtual MIDI vs WinMM Fallback</h2>
<p>
VLive features a dual-tier MIDI output architecture:
</p>
<ul>
  <li><strong>Tier 1: Native Kernel Virtual MIDI (teVirtualMIDI):</strong> Instantiates an in-process driver named <code>"VLive MIDI Controller"</code>. This port supports full-duplex bi-directional communication, raw SysEx streaming, and immediate DAW discovery without loopback cables.</li>
  <li><strong>Tier 2: WinMM Direct Fallback:</strong> If the kernel driver is offline, VLive enumerates existing Windows Multimedia MIDI Out devices (such as physical USB-MIDI interfaces, hardware DIN cables, or loopMIDI ports). <em>Software synthesizers (like Microsoft GS Wavetable Synth) are automatically excluded to prevent audible speaker distortion.</em></li>
</ul>

<h2>4.2 Ableton Live Setup (All Versions)</h2>
<ol>
  <li>Launch <strong>Ableton Live</strong> (versions 10, 11, or 12).</li>
  <li>Open <strong>Preferences</strong> (<code>Ctrl + ,</code>) and navigate to the <strong>Link / Tempo / MIDI</strong> tab.</li>
  <li>Under the <strong>MIDI Ports</strong> list, locate <code>Input: VLive MIDI Controller</code>:
    <ul>
      <li>Set <strong>Track</strong> to <code>ON</code> (allows playing virtual instruments, synths, and drum racks).</li>
      <li>Set <strong>Sync</strong> to <code>ON</code> (allows Ableton Live to slave its tempo clock to VLive's master clock).</li>
      <li>Set <strong>Remote</strong> to <code>ON</code> (allows MIDI Map mode <code>Ctrl + M</code> for knobs, faders, and buttons).</li>
    </ul>
  </li>
  <li>
    Under <code>Output: VLive MIDI Controller</code>:
    <ul>
      <li>Set <strong>Track</strong> to <code>ON</code> and <strong>Remote</strong> to <code>ON</code>. <em>This enables full-duplex motorized DAW feedback back to VLive.</em></li>
    </ul>
  </li>
</ol>

<h2>4.3 FL Studio Setup</h2>
<ol>
  <li>Launch <strong>FL Studio</strong> (versions 20, 21, or 24).</li>
  <li>Open <strong>MIDI Settings</strong> by pressing <code>F10</code>.</li>
  <li>Under the <strong>Input</strong> section, select <code>VLive MIDI Controller</code>.</li>
  <li>Click the <strong>Enable</strong> button (green indicator illuminates).</li>
  <li>Assign a unique <strong>Port</strong> number (e.g., <code>Port 10</code>) if you wish to route specific plugin channels.</li>
  <li>Under the <strong>Output</strong> section, select <code>VLive MIDI Controller</code>, assign the matching Port number, and enable <strong>Send master sync</strong> if slaving transport.</li>
</ol>

<h2>4.4 REAPER Setup</h2>
<ol>
  <li>Launch <strong>REAPER</strong>.</li>
  <li>Press <code>Ctrl + P</code> to open <strong>Preferences</strong> and scroll down to <strong>Audio &gt; MIDI Devices</strong>.</li>
  <li>Under <strong>MIDI inputs</strong>, right-click <code>VLive MIDI Controller</code> and select:
    <ul>
      <li><strong>Enable input</strong></li>
      <li><strong>Enable input for control messages</strong></li>
    </ul>
  </li>
  <li>Under <strong>MIDI outputs</strong>, right-click <code>VLive MIDI Controller</code> and select <strong>Enable output</strong>.</li>
</ol>

<h2>4.5 Cubase, Nuendo, Studio One & Bitwig Studio</h2>
<ul>
  <li><strong>Steinberg Cubase / Nuendo:</strong> Go to <code>Studio &gt; Studio Setup &gt; MIDI Port Setup</code>. Ensure <code>VLive MIDI Controller</code> is marked <strong>Active</strong> in the <em>"In 'All MIDI Inputs'"</em> column.</li>
  <li><strong>PreSonus Studio One:</strong> Go to <code>Options &gt; External Devices &gt; Add...</code>. Choose <em>New Keyboard</em> or <em>New Control Surface</em> and set <strong>Receive From</strong> and <strong>Send To</strong> to <code>VLive MIDI Controller</code>.</li>
  <li><strong>Bitwig Studio:</strong> Go to <code>Settings &gt; Controllers &gt; Add Controller</code>. Add a generic MIDI controller and bind its input and output to <code>VLive MIDI Controller</code>.</li>
</ul>

<h2>4.6 Full-Duplex DAW Bi-Directional Synchronization</h2>
<p>
VLive implements true <strong>Full-Duplex DAW synchronization</strong>:
</p>
<pre><code>Mobile Controller  ---[WebSocket]--->  VLive Server  ---[teVirtualMIDI]--->  DAW (Ableton)
Mobile Controller  <---[WebSocket]---  VLive Server  <---[teVirtualMIDI]---  DAW (Ableton)</code></pre>
<p>
When an automated parameter moves inside Ableton Live, FL Studio, or REAPER, the DAW transmits MIDI CC data back into the virtual port. VLive immediately intercepts this event and broadcasts binary update packets to all connected phones, tablets, and desktop instances. Your on-screen faders and knobs follow DAW automation in real time with zero desynchronization.
</p>

<!-- CHAPTER 5 -->
<div class="page-break"></div>
<h1>5. Runtime Operation & Live Performance</h1>

<h2>5.1 Desktop Interface & Monochromatic Dark Theme</h2>
<p>
The VLive native desktop window is designed with a dark, distraction-free monochromatic theme (<code>#08080c</code>) optimized for low-light live stages and studio environments:
</p>
<ul>
  <li><strong>Header Bar:</strong> Displays the official VLive logo, master BPM control, Play/Stop transport button, Edit/Play mode toggle, active port selector, and the QR docking button.</li>
  <li><strong>Pages Tab Bar:</strong> Allows creating, switching, renaming, and deleting performance pages.</li>
  <li><strong>Control Canvas:</strong> The interactive performance area where knobs, faders, pads, buttons, and switches live.</li>
  <li><strong>Bottom Telemetry Bar:</strong> Displays live stage metrics including transmitted messages/sec, connected mobile client tally, primary Wi-Fi LAN IP, active virtual driver name, and last MIDI event log.</li>
</ul>

<h2>5.2 Master Clock & 24 PPQN BPM Engine</h2>
<p>
VLive houses a high-precision hardware-grade tempo clock:
</p>
<ul>
  <li><strong>Tempo Adjustment:</strong> Adjust the tempo by clicking the <code>+</code> / <code>-</code> buttons or typing directly into the BPM readout field (supports tempo ranges from <code>20.0 BPM</code> to <code>300.0 BPM</code> with decimal precision).</li>
  <li><strong>Transport Synchronization:</strong> Clicking the <strong>Play</strong> button broadcasts standard MIDI Start (<code>0xFA</code>) commands and initiates 24 PPQN (Pulses Per Quarter Note) MIDI Timing Clock (<code>0xF8</code>) bytes. Clicking <strong>Stop</strong> dispatches MIDI Stop (<code>0xFC</code>).</li>
  <li><strong>Hardware Jitter Defense:</strong> The internal timer loop locks the Windows kernel timer to 1ms via <code>timeBeginPeriod(1)</code>, ensuring tempo stability even under heavy CPU loads.</li>
</ul>

<h2>5.3 Continuous Background Operation & System Tray</h2>
<p>
Accidentally closing an application window on stage can ruin a live performance. VLive prevents this through bulletproof background lifecycle management:
</p>
<ul>
  <li><strong>Close Button Behavior (Minimizing to Tray):</strong> Clicking the standard Windows close button (<code>X</code>) or pressing <code>Alt + F4</code> does <strong>NOT</strong> terminate VLive. Instead, VLive cleanly hides its window and continues running uninterrupted in the Windows System Tray.</li>
  <li><strong>Unbroken Audio/MIDI Stream:</strong> All WebSocket clients remain connected, MIDI messages continue streaming into your DAW, and the master clock continues ticking without dropouts.</li>
  <li><strong>System Tray Controls:</strong> Right-clicking the VLive tray icon reveals options to:
    <ul>
      <li><strong>Open VLive Studio:</strong> Restores and brings the desktop window to the foreground.</li>
      <li><strong>Status:</strong> Shows current active HTTP/WebSocket port.</li>
      <li><strong>Exit VLive:</strong> Cleanly shuts down the server, releases virtual ports, and exits.</li>
    </ul>
  </li>
  <li><strong>Single-Instance Guard:</strong> If you attempt to launch VLive a second time, the new instance detects the running global mutex (<code>Global\VLive_SingleInstance_Mutex_9823</code>), restores the existing window to the foreground, and exits immediately with zero port collisions.</li>
</ul>

<h2>5.4 Real-Time OS Hardening (MMCSS & 1ms Kernel Timer)</h2>
<p>
To guarantee stage-grade reliability without audio dropouts, VLive automatically configures three critical Windows operating system parameters on launch:
</p>
<ol>
  <li><strong>Multimedia Class Scheduler Service (MMCSS):</strong> VLive registers its core dispatch and WebSocket worker threads with Windows MMCSS under the <code>"Pro Audio"</code> task group, assigning thread priority <code>AVRT_PRIORITY_CRITICAL</code>.</li>
  <li><strong>Windows 11 EcoQoS / Power Throttling Bypass:</strong> VLive explicitly disables Windows 11 background power throttling via <code>SetProcessInformation(ProcessPowerThrottling)</code>, preventing Windows from down-clocking CPU cores assigned to VLive worker threads.</li>
  <li><strong>1ms Kernel Resolution:</strong> Locks the OS timer interrupt to 1ms using <code>timeBeginPeriod(1)</code> (safely reverted with <code>timeEndPeriod(1)</code> upon clean exit).</li>
</ol>

<!-- CHAPTER 6 -->
<div class="page-break"></div>
<h1>6. Edit & Design Manual (Canvas & Custom Widgets)</h1>

<h2>6.1 Play Mode vs Design Mode</h2>
<p>
VLive operates in two primary operational modes toggled via the header button:
</p>
<ul>
  <li><strong>Play Mode ("Go to Edit"):</strong> The default stage performance mode. Dragging knobs rotates values, clicking buttons triggers MIDI notes, sliding faders sends CCs, and switches latch. Controls cannot be accidentally moved or deleted during live play.</li>
  <li><strong>Design Mode ("Go to Play"):</strong> The visual layout editor. Clicking any control reveals its green bounding box, opens the <strong>Widget Inspector</strong>, and allows positioning, resizing, renaming, re-mapping MIDI channels, and adding new widgets from the toolbar.</li>
</ul>

<h2>6.2 Complete Widget Library Reference</h2>

<div class="widget-grid">
  <div class="widget-box">
    <h4>Rotary Knob</h4>
    <p>270° smooth travel dial. Features a centered horizontal value label that <strong>always stays upright</strong>. Supports MIDI CC and Pitch Bend. Clamps strictly between configured Min and Max limits.</p>
  </div>
  <div class="widget-box">
    <h4>Slider Fader</h4>
    <p>Professional vertical studio fader equipped with a tactile white grip notch. Ideal for track volumes, expression, master filter sweeps, or motorized DAW automation feedback.</p>
  </div>
  <div class="widget-box">
    <h4>Drum Pad</h4>
    <p>High-contrast, velocity-sensitive trigger pad. Transmits Note On on touch press and Note Off on release. Features responsive accent color glow on live stage taps.</p>
  </div>
  <div class="widget-box">
    <h4>Trigger Button</h4>
    <p>Dual-action stage button. Configurable for <strong>Momentary</strong> (press to trigger, release to clear) or <strong>Toggle</strong> (latching). Inverts to white fill (<code>#ffffff</code>) when active for instant visibility.</p>
  </div>
  <div class="widget-box">
    <h4>Toggle Switch</h4>
    <p>Studio hardware capsule (58×30px) with 28px slide travel. Features an integrated <code>ON</code> / <code>OFF</code> state readout. Perfect for mute/solo toggles, loop enable, or FX bypass.</p>
  </div>
  <div class="widget-box">
    <h4>2D XY Pad</h4>
    <p>Continuous dual-axis surface. Modulates two independent MIDI CC parameters simultaneously (X-axis for cutoff, Y-axis for resonance). Ideal for expressive stage solos.</p>
  </div>
</div>

<h2>6.3 Inspector & MIDI Parameter Configuration</h2>
<p>
Selecting any widget while in <strong>Design Mode</strong> opens the sidebar <strong>Widget Inspector</strong>, allowing fine-grained customization of its electrical behavior:
</p>
<table>
  <tr>
    <th>Property</th>
    <th>Options</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><strong>Label</strong></td>
    <td>Text string</td>
    <td>Name displayed on the widget card (e.g., <em>"Filter Cutoff"</em>, <em>"Lead Vol"</em>).</td>
  </tr>
  <tr>
    <td><strong>MIDI Channel</strong></td>
    <td><code>1</code> to <code>16</code></td>
    <td>Selects the destination MIDI channel for multi-timbral synth routing.</td>
  </tr>
  <tr>
    <td><strong>Message Type</strong></td>
    <td><code>CC</code>, <code>Note</code>, <code>PitchBend</code></td>
    <td>Determines whether the control outputs Control Change, Note On/Off, or Pitch Bend.</td>
  </tr>
  <tr>
    <td><strong>CC / Note Number</strong></td>
    <td><code>0</code> to <code>127</code></td>
    <td>The specific MIDI CC index (e.g., CC 74 for brightness) or Note pitch (e.g., Note 60 = Middle C).</td>
  </tr>
  <tr>
    <td><strong>Min / Max Value</strong></td>
    <td><code>0</code> to <code>127</code></td>
    <td>Clamps the range. Allows restricting parameters (e.g., Min 20, Max 100) or reversing travel (Min 127, Max 0).</td>
  </tr>
  <tr>
    <td><strong>Button Mode</strong></td>
    <td><code>Momentary</code> / <code>Toggle</code></td>
    <td>Available on Buttons. Momentary releases on finger lift; Toggle latches until clicked again.</td>
  </tr>
  <tr>
    <td><strong>Accent Color</strong></td>
    <td>Monochrome, Cyan, Magenta, Amber, Lime, Violet, Red</td>
    <td>Customizes the LED glow, indicator ring, and highlight accents for rapid visual recognition on dark stages.</td>
  </tr>
</table>

<h2>6.4 Multi-Page Management (Add, Rename, Duplicate, Delete)</h2>
<p>
Complex stage performances often require multiple control banks (e.g., Page 1: Synths, Page 2: Drum Rack, Page 3: Master FX):
</p>
<ul>
  <li><strong>Adding a Page:</strong> Click the <code>+</code> button on the right edge of the page tab bar.</li>
  <li><strong>Right-Click Context Menu:</strong> Right-clicking any page tab reveals:
    <ul>
      <li><strong>Rename Page:</strong> Enter a custom title (e.g., <em>"Drop FX"</em>).</li>
      <li><strong>Duplicate Page:</strong> Clones the entire layout, widgets, and MIDI mappings into a new page.</li>
      <li><strong>Delete Page:</strong> Removes the selected page (prompts confirmation to prevent accidental loss).</li>
    </ul>
  </li>
  <li><strong>Live Page Switching:</strong> Clicking any page tab instantaneously swaps the layout on your desktop and across all connected mobile tablets simultaneously.</li>
</ul>

<h2>6.5 Session Profiles, Export & Import (.vlive)</h2>
<ul>
  <li><strong>Auto-Persistence:</strong> Every layout change, widget move, and MIDI mapping is automatically saved to local storage instantaneously. Refreshing the browser or restarting VLive restores your exact layout.</li>
  <li><strong>Export Profile:</strong> Click <strong>Export Session</strong> in the settings menu to save your configuration as a standalone <code>.vlive</code> JSON file. Use this to back up sets or share templates with band members.</li>
  <li><strong>Import Profile:</strong> Click <strong>Import Session</strong> and select any previously saved <code>.vlive</code> profile to instantaneously load complete song or album setups.</li>
</ul>

<!-- CHAPTER 7 -->
<div class="page-break"></div>
<h1>7. Diagnostics, Troubleshooting & Technical Reference</h1>

<h2>7.1 Rotating Diagnostics Log & Minidumps</h2>
<p>
For diagnosing unexpected studio behavior or field issues on tour, VLive maintains black-box telemetry:
</p>
<ul>
  <li><strong>Rotating Text Log:</strong> Stored at <code>%LOCALAPPDATA%\\VLive\\logs\\vlive.log</code>. Automatically rotates to <code>vlive.log.1</code> whenever file size exceeds 5 MB, preventing disk bloating. Logs contain millisecond timestamps, process IDs, client connection events, and driver status.</li>
  <li><strong>Crash Minidump Generation:</strong> If an unhandled exception occurs, VLive's top-level crash filter immediately executes <code>MiniDumpWriteDump</code>, writing an analysis dump to:
    <pre><code>%LOCALAPPDATA%\\VLive\\logs\\vlive_crash_YYYYMMDD_HHMMSS.dmp</code></pre>
    Simultaneously, VLive safely terminates all virtual MIDI ports, ensuring Ableton or FL Studio never freeze due to locked kernel driver handles.
  </li>
</ul>

<h2>7.2 Virtual MIDI Driver Self-Recovery</h2>
<p>
If the virtual driver service was stopped by a Windows update or security tool:
</p>
<ol>
  <li>Look at the header in VLive. If the driver is stopped, the indicator displays <em>"Driver Offline"</em>.</li>
  <li>Click the <strong>"Start Driver"</strong> button in the VLive header.</li>
  <li>VLive attempts an in-process service start via the Windows Service Control Manager. If administrator elevation is required, it prompts for UAC authorization and configures the service to auto-start.</li>
  <li>Once started, the virtual port <code>"VLive MIDI Controller"</code> instantly re-appears in your DAW.</li>
</ol>

<h2>7.3 Comprehensive Universal Troubleshooting Matrix</h2>
<table>
  <tr>
    <th>Symptom</th>
    <th>Probable Cause</th>
    <th>Remedy / Action Plan</th>
  </tr>
  <tr>
    <td><strong>"VLive MIDI Controller" missing in DAW</strong></td>
    <td>teVirtualMIDI64 driver service stopped or uninstalled.</td>
    <td>Click <strong>"Start Driver"</strong> in VLive GUI, or run <code>drivers\\teVirtualMIDI64.msi</code>. Ensure service <code>teVirtualMIDI64</code> is running in <code>services.msc</code>.</td>
  </tr>
  <tr>
    <td><strong>Mobile device cannot load page (timeout)</strong></td>
    <td>Windows Defender Firewall blocking port or devices on different subnets.</td>
    <td>Run <code>VLive.exe --register-firewall</code>. Verify phone and laptop are on the exact same Wi-Fi SSID / frequency.</td>
  </tr>
  <tr>
    <td><strong>High jitter or erratic fader movements</strong></td>
    <td>2.4 GHz Wi-Fi congestion or laptop power throttling.</td>
    <td>Switch to a dedicated 5 GHz Wi-Fi network. Ensure laptop is plugged into AC power with Windows Power Plan set to <em>High Performance</em>.</td>
  </tr>
  <tr>
    <td><strong>WebView2 window does not appear on launch</strong></td>
    <td>Stripped Windows 10 OS lacking Edge WebView2 runtime.</td>
    <td>VLive automatically falls back to opening your default browser. Run <code>drivers\\MicrosoftEdgeWebview2Setup.exe</code> to enable embedded desktop view.</td>
  </tr>
  <tr>
    <td><strong>Duplicate instance error on launch</strong></td>
    <td>An instance is already running minimized in the background.</td>
    <td>Check your Windows System Tray (near clock). Click the VLive tray icon to bring the active window to the front.</td>
  </tr>
</table>

<h2>7.4 Technical Specifications & Performance Benchmarks</h2>
<table>
  <tr>
    <th>Metric</th>
    <th>Specification / Tested Performance</th>
  </tr>
  <tr>
    <td><strong>Binary Architecture</strong></td>
    <td>x64 Native PE Executable (MSVC C++20 /MT Static CRT)</td>
  </tr>
  <tr>
    <td><strong>Binary Dependencies</strong></td>
    <td>Standard Windows OS system DLLs only (Zero VC++ Redistributable requirements)</td>
  </tr>
  <tr>
    <td><strong>Standalone Binary Footprint</strong></td>
    <td>~1.85 MB (Includes all compiled PWA HTML, CSS, JS, fonts, and icons in RAM)</td>
  </tr>
  <tr>
    <td><strong>Turnkey Installer Footprint</strong></td>
    <td>~4.69 MB (Includes full teVirtualMIDI driver and Evergreen WebView2 setup)</td>
  </tr>
  <tr>
    <td><strong>Network Dispatch Latency</strong></td>
    <td>&lt; 0.8 ms (Local 5 GHz 802.11ac Wi-Fi / LAN)</td>
  </tr>
  <tr>
    <td><strong>Internal MIDI Jitter</strong></td>
    <td>&plusmn; 0.15 ms (Calibrated via 1ms kernel timer locking and MMCSS Pro Audio scheduling)</td>
  </tr>
  <tr>
    <td><strong>Max Concurrent Client Sync</strong></td>
    <td>Tested up to 32 simultaneous mobile/tablet controllers with zero packet drop</td>
  </tr>
  <tr>
    <td><strong>Supported Operating Systems</strong></td>
    <td>Windows 10 (all versions x64), Windows 11 (all versions x64)</td>
  </tr>
</table>

<div class="callout callout-tip" style="margin-top: 24px;">
  <strong>Official Support & Contributions</strong>
  VLive is an open, high-performance ecosystem designed by Goldee. For questions, bug reports, feature requests, or DAW mapping templates, visit the official repository at:
  <br><strong>https://github.com/goldee/vlive</strong>
</div>

</body>
</html>
`;

// 3. Write HTML file
const htmlPath = path.join(distDir, 'VLive_User_Manual.html');
fs.writeFileSync(htmlPath, htmlContent, 'utf8');
console.log('[OK] Generated Universal HTML Manual:', htmlPath);

// 4. Locate Headless Browser (Chrome or Edge)
const browserCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

let browserPath = null;
for (const b of browserCandidates) {
  if (fs.existsSync(b)) {
    browserPath = b;
    break;
  }
}

if (!browserPath) {
  console.error('[ERROR] Could not locate Google Chrome or Microsoft Edge for PDF rendering.');
  process.exit(1);
}

console.log(`[INFO] Using browser engine: ${browserPath}`);

// 5. Render PDF
const pdfDistPath = path.join(distDir, 'VLive_User_Manual.pdf');
const pdfRootPath = path.join(rootDir, 'VLive_User_Manual.pdf');
const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');

console.log('[INFO] Rendering universal publication-grade PDF...');
const cmd = `"${browserPath}" --headless --disable-gpu --run-all-compositor-stages-before-draw --print-to-pdf="${pdfDistPath}" --no-pdf-header-footer "${fileUrl}"`;
execSync(cmd);

if (fs.existsSync(pdfDistPath)) {
  fs.copyFileSync(pdfDistPath, pdfRootPath);
  const sizeKb = Math.round(fs.statSync(pdfDistPath).size / 1024);
  console.log('============================================================');
  console.log(`[SUCCESS] Universal VLive User Manual PDF Generated Successfully!`);
  console.log(`  Path in dist/ : ${pdfDistPath} (${sizeKb} KB)`);
  console.log(`  Path in root/ : ${pdfRootPath} (${sizeKb} KB)`);
  console.log('============================================================');
} else {
  console.error('[ERROR] PDF generation failed.');
  process.exit(1);
}
