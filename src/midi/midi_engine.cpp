#include "src/midi/midi_engine.hpp"
#include <iostream>
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <cctype>
#include <thread>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <mmsystem.h>
#endif

namespace vlive {

static bool isSoftwareSynth(const std::string& name) {
    std::string lower = name;
    std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });

    if (lower.find("microsoft gs") != std::string::npos ||
        lower.find("wavetable") != std::string::npos ||
        lower.find("synth") != std::string::npos ||
        lower.find("sw synth") != std::string::npos ||
        lower.find("gm synth") != std::string::npos ||
        lower.find("software") != std::string::npos) {
        return true;
    }
    return false;
}

struct MidiEngine::Impl {
#ifdef _WIN32
    HMIDIOUT hMidiOut{nullptr};
#endif
};

MidiEngine::MidiEngine()
    : impl_(std::make_unique<Impl>()),
      virtual_port_(std::make_unique<VirtualMidiPort>()),
      last_rate_check_(std::chrono::steady_clock::now()) {

    // 1. Automatically create in-process native Windows virtual MIDI port: "VLive MIDI Controller"
    // DAWs (Ableton, FL Studio, Reaper, Cubase, Nuendo) detect this immediately as a native MIDI input.
    if (virtual_port_) {
        virtual_port_->setIncomingCallback([this](const uint8_t* data, size_t length) {
            total_recv_++;
            if (incoming_raw_cb_) {
                incoming_raw_cb_(data, length);
            }
            if (incoming_cb_ && data && length > 0) {
                MidiMessage msg;
                msg.length = static_cast<uint8_t>(std::min(length, size_t(3)));
                for (size_t k = 0; k < msg.length; ++k) msg.data[k] = data[k];
                incoming_cb_(msg);
            }
        });
        virtual_port_->open(L"VLive MIDI Controller");
    }

    // 2. Auto-open existing virtual MIDI loopback cables (as WinMM fallback).
    // NEVER auto-open Microsoft GS Wavetable Synth or PC speaker synthesizers.
    auto ports = enumerateWinMidiPorts();
    for (uint32_t i = 0; i < ports.size(); ++i) {
        if (!isSoftwareSynth(ports[i])) {
            if (initWinMidi(i)) {
                break;
            }
        }
    }
}

MidiEngine::~MidiEngine() {
    if (virtual_port_) {
        virtual_port_->close();
    }
    closeWinMidi();
}

std::vector<std::string> MidiEngine::enumerateWinMidiPorts() {
    std::vector<std::string> ports;
#ifdef _WIN32
    UINT numDevs = midiOutGetNumDevs();
    for (UINT i = 0; i < numDevs; ++i) {
        MIDIOUTCAPSA caps{};
        if (midiOutGetDevCapsA(i, &caps, sizeof(caps)) == MMSYSERR_NOERROR) {
            ports.emplace_back(caps.szPname);
        }
    }
#endif
    return ports;
}

bool MidiEngine::initWinMidi(uint32_t device_index) {
    closeWinMidi();

#ifdef _WIN32
    UINT numDevs = midiOutGetNumDevs();
    if (numDevs == 0 || device_index >= numDevs) {
        return false;
    }

    MIDIOUTCAPSA caps{};
    if (midiOutGetDevCapsA(device_index, &caps, sizeof(caps)) == MMSYSERR_NOERROR) {
        // Reject software synthesizers so the app acts strictly as a MIDI controller,
        // without making audible sounds through laptop speakers.
        if (isSoftwareSynth(caps.szPname)) {
            return false;
        }
        active_port_name_ = caps.szPname;
    }

    MMRESULT res = midiOutOpen(&impl_->hMidiOut, device_index, 0, 0, CALLBACK_NULL);
    if (res == MMSYSERR_NOERROR) {
        win_midi_open_ = true;
        return true;
    }
#endif
    return false;
}

void MidiEngine::closeWinMidi() {
#ifdef _WIN32
    if (impl_->hMidiOut) {
        midiOutReset(impl_->hMidiOut);
        midiOutClose(impl_->hMidiOut);
        impl_->hMidiOut = nullptr;
    }
#endif
    win_midi_open_ = false;
    active_port_name_.clear();
}

bool MidiEngine::dispatchMessage(const MidiMessage& msg) {
    if (msg.length == 0) return false;

    // 1. In-Process Native Virtual MIDI Port ("VLive MIDI Controller")
    // Transmits directly into the DAW via Windows MIDI subsystem
    if (virtual_port_ && virtual_port_->isOpen()) {
        virtual_port_->sendData(msg.data, msg.length);
    }

    // 2. Windows Multimedia Direct MIDI Out (legacy / loopback fallback)
#ifdef _WIN32
    if (win_midi_open_ && impl_->hMidiOut) {
        DWORD dwMsg = 0;
        if (msg.length == 1) {
            dwMsg = msg.data[0];
        } else if (msg.length == 2) {
            dwMsg = (static_cast<DWORD>(msg.data[1]) << 8) | msg.data[0];
        } else if (msg.length == 3) {
            dwMsg = (static_cast<DWORD>(msg.data[2]) << 16) |
                    (static_cast<DWORD>(msg.data[1]) << 8) |
                    msg.data[0];
        }
        midiOutShortMsg(impl_->hMidiOut, dwMsg);
    }
#endif

    total_sent_++;

    // Format human-readable display string for non-clock messages
    if (msg.data[0] != midi_status::TIMING_CLOCK) {
        last_event_str_ = formatMidiMessage(msg);
    }

    return true;
}

bool MidiEngine::dispatchRawBytes(const uint8_t* data, size_t length) {
    if (!data || length == 0) return false;

    // 1. Direct pass-through to virtual MIDI driver for maximum fidelity & sysex support
    if (virtual_port_ && virtual_port_->isOpen()) {
        virtual_port_->sendData(data, length);
    } else if (virtual_port_) {
        // Attempt quick auto-recovery if port was temporarily offline
        if (virtual_port_->ensureOpen(L"VLive MIDI Controller")) {
            virtual_port_->sendData(data, length);
        }
    }

    // 2. Parse individual MIDI events for WinMM fallback and UI status display
    size_t i = 0;
    while (i < length) {
        uint8_t status = data[i];
        if (status == midi_status::TIMING_CLOCK ||
            status == midi_status::START ||
            status == midi_status::STOP ||
            status == midi_status::CONTINUE) {
            MidiMessage m;
            m.data[0] = status;
            m.length = 1;
#ifdef _WIN32
            if (win_midi_open_ && impl_->hMidiOut) {
                midiOutShortMsg(impl_->hMidiOut, status);
            }
#endif
            total_sent_++;
            i += 1;
        } else if ((status & 0xF0) == 0xC0 || (status & 0xF0) == 0xD0) {
            if (i + 1 < length) {
                MidiMessage m;
                m.data[0] = status;
                m.data[1] = data[i + 1];
                m.length = 2;
#ifdef _WIN32
                if (win_midi_open_ && impl_->hMidiOut) {
                    DWORD dwMsg = (static_cast<DWORD>(data[i + 1]) << 8) | status;
                    midiOutShortMsg(impl_->hMidiOut, dwMsg);
                }
#endif
                total_sent_++;
                last_event_str_ = formatMidiMessage(m);
                i += 2;
            } else break;
        } else if ((status & 0x80) != 0 && (status < 0xF0)) {
            if (i + 2 < length) {
                MidiMessage m;
                m.data[0] = status;
                m.data[1] = data[i + 1];
                m.data[2] = data[i + 2];
                m.length = 3;
#ifdef _WIN32
                if (win_midi_open_ && impl_->hMidiOut) {
                    DWORD dwMsg = (static_cast<DWORD>(data[i + 2]) << 16) |
                                  (static_cast<DWORD>(data[i + 1]) << 8) |
                                  status;
                    midiOutShortMsg(impl_->hMidiOut, dwMsg);
                }
#endif
                total_sent_++;
                last_event_str_ = formatMidiMessage(m);
                i += 3;
            } else break;
        } else {
            i++;
        }
    }
    return true;
}

bool MidiEngine::sendNoteOn(uint8_t channel, uint8_t note, uint8_t velocity) {
    return dispatchMessage(MidiMessage::noteOn(channel, note, velocity));
}

bool MidiEngine::sendNoteOff(uint8_t channel, uint8_t note, uint8_t velocity) {
    return dispatchMessage(MidiMessage::noteOff(channel, note, velocity));
}

bool MidiEngine::sendControlChange(uint8_t channel, uint8_t cc_num, uint8_t value) {
    return dispatchMessage(MidiMessage::controlChange(channel, cc_num, value));
}

bool MidiEngine::sendPitchBend(uint8_t channel, uint16_t value14bit) {
    return dispatchMessage(MidiMessage::pitchBend(channel, value14bit));
}

bool MidiEngine::sendClockTick() {
    return dispatchMessage(MidiMessage::clockTick());
}

bool MidiEngine::sendTransportStart() {
    return dispatchMessage(MidiMessage::transportStart());
}

bool MidiEngine::sendTransportStop() {
    return dispatchMessage(MidiMessage::transportStop());
}

void MidiEngine::setIncomingMidiCallback(MidiBroadcastCallback cb) {
    incoming_cb_ = std::move(cb);
}

void MidiEngine::setIncomingRawCallback(IncomingRawCallback cb) {
    incoming_raw_cb_ = std::move(cb);
}

uint64_t MidiEngine::getTotalMessagesSent() const noexcept {
    return total_sent_.load();
}

double MidiEngine::getMessagesPerSecond() const noexcept {
    auto now = std::chrono::steady_clock::now();
    auto elapsed = std::chrono::duration<double>(now - last_rate_check_).count();
    if (elapsed >= 1.0) {
        uint64_t current_count = total_sent_.load();
        const_cast<MidiEngine*>(this)->current_rate_ = static_cast<double>(current_count - last_rate_count_) / elapsed;
        const_cast<MidiEngine*>(this)->last_rate_count_ = current_count;
        const_cast<MidiEngine*>(this)->last_rate_check_ = now;
    }
    return current_rate_;
}

std::string MidiEngine::getLastEventDescription() const {
    return last_event_str_;
}

bool MidiEngine::isWinMidiActive() const noexcept {
    return win_midi_open_.load();
}

std::string MidiEngine::getActiveWinMidiPortName() const {
    return active_port_name_;
}

bool MidiEngine::isVirtualPortActive() const noexcept {
    return virtual_port_ && virtual_port_->isOpen();
}

std::string MidiEngine::getVirtualPortName() const {
    if (virtual_port_ && virtual_port_->isOpen()) {
        return virtual_port_->getPortNameUtf8();
    }
    return "";
}

bool MidiEngine::ensureVirtualPortActive() {
    if (virtual_port_ && virtual_port_->isOpen()) return true;
    if (virtual_port_) {
        return virtual_port_->ensureOpen(L"VLive MIDI Controller");
    }
    return false;
}

bool MidiEngine::sendTestNote(uint8_t note, uint8_t velocity) {
    ensureVirtualPortActive();
    sendNoteOn(0, note, velocity);
    std::thread([this, note]() {
        try {
            std::this_thread::sleep_for(std::chrono::milliseconds(180));
            sendNoteOff(0, note, 0);
        } catch (...) {}
    }).detach();
    return true;
}

bool MidiEngine::selectWinMidiPort(const std::string& name) {
    auto ports = enumerateWinMidiPorts();
    for (uint32_t i = 0; i < ports.size(); ++i) {
        if (ports[i] == name) {
            return initWinMidi(i);
        }
    }
    return false;
}

std::string MidiEngine::formatMidiMessage(const MidiMessage& msg) {
    if (msg.length == 0) return "Empty";

    uint8_t status = msg.data[0] & 0xF0;
    uint8_t channel = (msg.data[0] & 0x0F) + 1;

    std::ostringstream ss;
    switch (status) {
        case midi_status::NOTE_ON:
            if (msg.data[2] > 0) {
                ss << "Ch " << static_cast<int>(channel) << " Note ON: " 
                   << static_cast<int>(msg.data[1]) << " Vel: " << static_cast<int>(msg.data[2]);
            } else {
                ss << "Ch " << static_cast<int>(channel) << " Note OFF: " << static_cast<int>(msg.data[1]);
            }
            break;
        case midi_status::NOTE_OFF:
            ss << "Ch " << static_cast<int>(channel) << " Note OFF: " << static_cast<int>(msg.data[1]);
            break;
        case midi_status::CONTROL_CHANGE:
            ss << "Ch " << static_cast<int>(channel) << " CC #" 
               << static_cast<int>(msg.data[1]) << " Val: " << static_cast<int>(msg.data[2]);
            break;
        case midi_status::PITCH_BEND: {
            uint16_t val = (static_cast<uint16_t>(msg.data[2]) << 7) | msg.data[1];
            ss << "Ch " << static_cast<int>(channel) << " Pitch Bend: " << val;
            break;
        }
        default:
            if (msg.data[0] == midi_status::START) ss << "Transport: START";
            else if (msg.data[0] == midi_status::STOP) ss << "Transport: STOP";
            else ss << "Status 0x" << std::hex << static_cast<int>(msg.data[0]);
            break;
    }
    return ss.str();
}

} // namespace vlive
