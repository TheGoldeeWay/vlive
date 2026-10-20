#include <iostream>
#include <cassert>
#include <vector>
#include "src/common/types.hpp"
#include "src/common/ring_buffer.hpp"

using namespace vlive;

void test_midi_messages() {
    std::cout << "[Test] Testing MIDI message construction...\n";

    // Note On Ch 10, Note 36 (Kick), Vel 100
    auto note_on = MidiMessage::noteOn(9, 36, 100);
    assert(note_on.length == 3);
    assert(note_on.data[0] == 0x99); // 0x90 | 9
    assert(note_on.data[1] == 36);
    assert(note_on.data[2] == 100);

    // Note Off Ch 10, Note 36
    auto note_off = MidiMessage::noteOff(9, 36);
    assert(note_off.length == 3);
    assert(note_off.data[0] == 0x89); // 0x80 | 9
    assert(note_off.data[1] == 36);
    assert(note_off.data[2] == 0);

    // Control Change Ch 16 (15), CC 74, Val 127
    auto cc = MidiMessage::controlChange(15, 74, 127);
    assert(cc.length == 3);
    assert(cc.data[0] == 0xBF); // 0xB0 | 15
    assert(cc.data[1] == 74);
    assert(cc.data[2] == 127);

    // Pitch Bend Center (8192 = 0x2000)
    auto pb = MidiMessage::pitchBend(0, 8192);
    assert(pb.length == 3);
    assert(pb.data[0] == 0xE0);
    assert(pb.data[1] == 0x00); // LSB
    assert(pb.data[2] == 0x40); // MSB

    // Timing Clock Tick (0xF8)
    auto clock = MidiMessage::clockTick();
    assert(clock.length == 1);
    assert(clock.data[0] == 0xF8);

    std::cout << "  [✓] MIDI Message tests passed!\n";
}

void test_ring_buffer() {
    std::cout << "[Test] Testing Lock-Free Ring Buffer...\n";

    RingBuffer<MidiMessage, 64> buffer;
    assert(buffer.empty());
    assert(buffer.size() == 0);

    // Push 30 messages
    for (int i = 0; i < 30; ++i) {
        bool ok = buffer.push(MidiMessage::noteOn(0, static_cast<uint8_t>(60 + i), 100));
        assert(ok);
        (void)ok;
    }
    assert(buffer.size() == 30);

    // Pop and verify order
    for (int i = 0; i < 30; ++i) {
        MidiMessage msg;
        bool ok = buffer.pop(msg);
        assert(ok);
        (void)ok;
        assert(msg.data[1] == static_cast<uint8_t>(60 + i));
    }
    assert(buffer.empty());
    assert(buffer.size() == 0);

    std::cout << "  [✓] Ring Buffer tests passed!\n";
}

int main() {
    std::cout << "========================================\n";
    std::cout << "  RUNNING VLIVE MIDI & CORE UNIT TESTS  \n";
    std::cout << "========================================\n";

    test_midi_messages();
    test_ring_buffer();

    std::cout << "\nALL MIDI TESTS COMPLETED SUCCESSFULLY!\n";
    return 0;
}
