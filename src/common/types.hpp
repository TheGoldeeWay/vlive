#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <chrono>

namespace vlive {

// Standard MIDI 1.0 Status Bytes
namespace midi_status {
    constexpr uint8_t NOTE_OFF         = 0x80;
    constexpr uint8_t NOTE_ON          = 0x90;
    constexpr uint8_t POLY_KEY_PRESS   = 0xA0;
    constexpr uint8_t CONTROL_CHANGE   = 0xB0;
    constexpr uint8_t PROGRAM_CHANGE   = 0xC0;
    constexpr uint8_t CHANNEL_PRESSURE = 0xD0;
    constexpr uint8_t PITCH_BEND       = 0xE0;
    
    // System Real-Time (1-byte)
    constexpr uint8_t TIMING_CLOCK     = 0xF8; // 24 PPQN
    constexpr uint8_t START            = 0xFA;
    constexpr uint8_t CONTINUE         = 0xFB;
    constexpr uint8_t STOP             = 0xFC;
    constexpr uint8_t ACTIVE_SENSING   = 0xFE;
    constexpr uint8_t SYSTEM_RESET     = 0xFF;
}

// Compact MIDI Message Struct
struct MidiMessage {
    uint8_t data[3]{0, 0, 0};
    uint8_t length{0};
    uint64_t timestamp_us{0};

    MidiMessage() = default;

    static MidiMessage noteOn(uint8_t channel, uint8_t note, uint8_t velocity) {
        MidiMessage m;
        m.data[0] = static_cast<uint8_t>(midi_status::NOTE_ON | (channel & 0x0F));
        m.data[1] = note & 0x7F;
        m.data[2] = velocity & 0x7F;
        m.length = 3;
        return m;
    }

    static MidiMessage noteOff(uint8_t channel, uint8_t note, uint8_t velocity = 0) {
        MidiMessage m;
        m.data[0] = static_cast<uint8_t>(midi_status::NOTE_OFF | (channel & 0x0F));
        m.data[1] = note & 0x7F;
        m.data[2] = velocity & 0x7F;
        m.length = 3;
        return m;
    }

    static MidiMessage controlChange(uint8_t channel, uint8_t controller, uint8_t value) {
        MidiMessage m;
        m.data[0] = static_cast<uint8_t>(midi_status::CONTROL_CHANGE | (channel & 0x0F));
        m.data[1] = controller & 0x7F;
        m.data[2] = value & 0x7F;
        m.length = 3;
        return m;
    }

    static MidiMessage pitchBend(uint8_t channel, uint16_t value14bit) {
        MidiMessage m;
        m.data[0] = static_cast<uint8_t>(midi_status::PITCH_BEND | (channel & 0x0F));
        m.data[1] = value14bit & 0x7F;
        m.data[2] = (value14bit >> 7) & 0x7F;
        m.length = 3;
        return m;
    }

    static MidiMessage clockTick() {
        MidiMessage m;
        m.data[0] = midi_status::TIMING_CLOCK;
        m.length = 1;
        return m;
    }

    static MidiMessage transportStart() {
        MidiMessage m;
        m.data[0] = midi_status::START;
        m.length = 1;
        return m;
    }

    static MidiMessage transportStop() {
        MidiMessage m;
        m.data[0] = midi_status::STOP;
        m.length = 1;
        return m;
    }
};

// Performer Roles
enum class PerformerRole {
    Drums,
    LeadSynth,
    BassSynth,
    Mixer,
    XYPad,
    Sequencer,
    FullStage,
    Unknown
};

inline std::string roleToString(PerformerRole role) {
    switch (role) {
        case PerformerRole::Drums:      return "Drums (Ch 10)";
        case PerformerRole::LeadSynth:  return "Lead Synth (Ch 1)";
        case PerformerRole::BassSynth:  return "Bass Synth (Ch 2)";
        case PerformerRole::Mixer:      return "Mixer (Ch 16)";
        case PerformerRole::XYPad:      return "XY Touchpad";
        case PerformerRole::Sequencer:  return "Sequencer";
        case PerformerRole::FullStage:  return "Full Stage";
        default:                        return "Custom";
    }
}

inline PerformerRole stringToRole(const std::string& str) {
    if (str == "drums") return PerformerRole::Drums;
    if (str == "keys")  return PerformerRole::LeadSynth;
    if (str == "bass")  return PerformerRole::BassSynth;
    if (str == "mixer") return PerformerRole::Mixer;
    if (str == "xy")    return PerformerRole::XYPad;
    if (str == "seq")   return PerformerRole::Sequencer;
    if (str == "all")   return PerformerRole::FullStage;
    return PerformerRole::Unknown;
}

// Client Device Session Information
struct ClientSession {
    uint32_t socket_id{0};
    std::string device_id;
    std::string device_name;
    std::string ip_address;
    PerformerRole role{PerformerRole::Drums};
    double rtt_ms{0.0};
    double clock_offset_ms{0.0};
    std::chrono::steady_clock::time_point last_ping_time;
    bool is_cable_mode{false};
};

} // namespace vlive
