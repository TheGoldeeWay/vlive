#pragma once

#include <string>
#include <vector>
#include <memory>
#include <atomic>
#include <functional>
#include <chrono>
#include "src/common/types.hpp"
#include "src/midi/virtual_midi_port.hpp"

namespace vlive {

class MidiEngine {
public:
    using MidiBroadcastCallback = std::function<void(const MidiMessage& msg)>;

    MidiEngine();
    ~MidiEngine();

    // Initialize Windows Multimedia (winmm) MIDI Out ports
    bool initWinMidi(uint32_t device_index = 0);
    void closeWinMidi();

    // Dispatch MIDI message to in-process virtual MIDI and WinMM
    bool dispatchMessage(const MidiMessage& msg);
    bool dispatchRawBytes(const uint8_t* data, size_t length);

    // Helpers
    bool sendNoteOn(uint8_t channel, uint8_t note, uint8_t velocity);
    bool sendNoteOff(uint8_t channel, uint8_t note, uint8_t velocity = 0);
    bool sendControlChange(uint8_t channel, uint8_t cc_num, uint8_t value);
    bool sendPitchBend(uint8_t channel, uint16_t value14bit);
    bool sendClockTick();
    bool sendTransportStart();
    bool sendTransportStop();
    bool sendTestNote(uint8_t note = 60, uint8_t velocity = 100);

    // Register callback when MIDI is received from DAW / external input
    using IncomingRawCallback = std::function<void(const uint8_t* data, size_t length)>;
    void setIncomingMidiCallback(MidiBroadcastCallback cb);
    void setIncomingRawCallback(IncomingRawCallback cb);

    // Virtual MIDI port query & watchdog activation
    [[nodiscard]] bool isVirtualPortActive() const noexcept;
    [[nodiscard]] std::string getVirtualPortName() const;
    bool ensureVirtualPortActive();
    VirtualMidiPort* getVirtualPort() const noexcept { return virtual_port_.get(); }
    void closeVirtualPort() noexcept { if (virtual_port_) virtual_port_->close(); }

    // Statistics
    [[nodiscard]] uint64_t getTotalMessagesSent() const noexcept;
    [[nodiscard]] double getMessagesPerSecond() const noexcept;
    [[nodiscard]] std::string getLastEventDescription() const;
    [[nodiscard]] bool isWinMidiActive() const noexcept;
    [[nodiscard]] std::string getActiveWinMidiPortName() const;
    bool selectWinMidiPort(const std::string& name);

    // Enumerate available Windows MIDI Out ports
    static std::vector<std::string> enumerateWinMidiPorts();

private:
    static std::string formatMidiMessage(const MidiMessage& msg);

    MidiBroadcastCallback incoming_cb_;
    IncomingRawCallback incoming_raw_cb_;

    struct Impl;
    std::unique_ptr<Impl> impl_;
    std::unique_ptr<VirtualMidiPort> virtual_port_;

    std::atomic<uint64_t> total_sent_{0};
    std::atomic<uint64_t> total_recv_{0};
    std::atomic<bool> win_midi_open_{false};
    std::string active_port_name_;

    mutable std::string last_event_str_{"Idle"};
    std::chrono::steady_clock::time_point last_rate_check_;
    uint64_t last_rate_count_{0};
    double current_rate_{0.0};
};

} // namespace vlive
