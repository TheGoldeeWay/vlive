#pragma once

#include <atomic>
#include <thread>
#include <functional>
#include <chrono>
#include <vector>
#include "src/common/types.hpp"

namespace vlive {

class SyncEngine {
public:
    using ClockTickCallback = std::function<void(uint64_t tick_count, uint32_t beat_num, bool is_quarter_note)>;
    using TransportCallback = std::function<void(bool is_playing, double bpm)>;

    SyncEngine();
    ~SyncEngine();

    // Transport controls
    void start();
    void stop();
    void pause();
    void togglePlay();

    // BPM controls (20.0 to 300.0)
    void setBpm(double bpm);
    [[nodiscard]] double getBpm() const noexcept;
    void adjustBpm(double delta);
    void registerTapTempo();

    // Status queries
    [[nodiscard]] bool isPlaying() const noexcept;
    [[nodiscard]] uint64_t getTotalTicks() const noexcept;
    [[nodiscard]] uint32_t getCurrentBeat() const noexcept;

    // Callbacks
    void setClockCallback(ClockTickCallback cb);
    void setTransportCallback(TransportCallback cb);

    // Microsecond timestamp for NTP clock sync
    static uint64_t getMicrosecondsNow();

private:
    void clockThreadLoop();

    std::atomic<double> bpm_{120.0};
    std::atomic<bool> is_playing_{false};
    std::atomic<bool> should_stop_{false};

    std::atomic<uint64_t> total_ticks_{0};
    std::atomic<uint32_t> current_beat_{0};

    std::vector<std::chrono::steady_clock::time_point> tap_history_;
    ClockTickCallback clock_cb_;
    TransportCallback transport_cb_;

    std::thread clock_thread_;
};

} // namespace vlive
