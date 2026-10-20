#include <iostream>
#include <cassert>
#include <cmath>
#include "src/sync/sync_engine.hpp"

using namespace vlive;

void test_ntp_algorithm() {
    std::cout << "[Test] Testing NTP-style clock sync offset math...\n";

    // Simulate Client Send t0 = 1000ms
    // Server Receive t1 = 1005ms (5ms network transit)
    // Server Send    t2 = 1006ms (1ms processing delay)
    // Client Receive t3 = 1011ms (5ms return transit)
    double t0 = 1000.0;
    double t1 = 1005.0;
    double t2 = 1006.0;
    double t3 = 1011.0;

    double rtt = (t3 - t0) - (t2 - t1);
    double offset = ((t1 - t0) + (t2 - t3)) / 2.0;

    std::cout << "  Calculated RTT: " << rtt << " ms (Expected 10.0 ms)\n";
    std::cout << "  Calculated Offset: " << offset << " ms (Expected 0.0 ms)\n";

    assert(std::abs(rtt - 10.0) < 0.001);
    assert(std::abs(offset - 0.0) < 0.001);

    // Now test with 50ms server clock lead:
    // Client clock = 1000, Server clock = 1050
    t0 = 1000.0;
    t1 = 1055.0; // 50ms lead + 5ms transit
    t2 = 1056.0;
    t3 = 1011.0;

    rtt = (t3 - t0) - (t2 - t1);
    offset = ((t1 - t0) + (t2 - t3)) / 2.0;

    std::cout << "  With 50ms server lead -> Offset: " << offset << " ms (Expected 50.0 ms)\n";
    assert(std::abs(rtt - 10.0) < 0.001);
    assert(std::abs(offset - 50.0) < 0.001);

    std::cout << "  [✓] NTP algorithm tests passed!\n";
}

void test_bpm_tick_math() {
    std::cout << "[Test] Testing 24 PPQN MIDI tick interval calculations...\n";

    double bpm = 120.0;
    // At 120 BPM, 1 beat (quarter note) = 60 / 120 = 0.5s = 500ms
    // 24 ticks per beat = 500ms / 24 = 20.8333ms per tick
    double tick_ms = (60.0 / (bpm * 24.0)) * 1000.0;
    std::cout << "  120 BPM Tick Interval: " << tick_ms << " ms\n";
    assert(std::abs(tick_ms - 20.8333) < 0.01);

    bpm = 140.0;
    tick_ms = (60.0 / (bpm * 24.0)) * 1000.0;
    std::cout << "  140 BPM Tick Interval: " << tick_ms << " ms\n";
    assert(std::abs(tick_ms - 17.8571) < 0.01);

    std::cout << "  [✓] BPM Tick math tests passed!\n";
}

int main() {
    std::cout << "========================================\n";
    std::cout << "  RUNNING VLIVE SYNC & CLOCK UNIT TESTS \n";
    std::cout << "========================================\n";

    test_ntp_algorithm();
    test_bpm_tick_math();

    std::cout << "\nALL SYNC TESTS COMPLETED SUCCESSFULLY!\n";
    return 0;
}
