#include "src/sync/sync_engine.hpp"
#include <algorithm>
#include <numeric>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <timeapi.h>
#endif

namespace vlive {

SyncEngine::SyncEngine() {
#ifdef _WIN32
    timeBeginPeriod(1);
#endif
    clock_thread_ = std::thread(&SyncEngine::clockThreadLoop, this);
}

SyncEngine::~SyncEngine() {
    should_stop_ = true;
    if (clock_thread_.joinable()) {
        clock_thread_.join();
    }
#ifdef _WIN32
    timeEndPeriod(1);
#endif
}

void SyncEngine::start() {
    is_playing_ = true;
    if (transport_cb_) {
        transport_cb_(true, bpm_.load());
    }
}

void SyncEngine::stop() {
    is_playing_ = false;
    total_ticks_ = 0;
    current_beat_ = 0;
    if (transport_cb_) {
        transport_cb_(false, bpm_.load());
    }
}

void SyncEngine::pause() {
    is_playing_ = false;
    if (transport_cb_) {
        transport_cb_(false, bpm_.load());
    }
}

void SyncEngine::togglePlay() {
    if (is_playing_.load()) {
        pause();
    } else {
        start();
    }
}

void SyncEngine::setBpm(double bpm) {
    bpm_.store(std::clamp(bpm, 20.0, 300.0));
    if (transport_cb_) {
        transport_cb_(is_playing_.load(), bpm_.load());
    }
}

double SyncEngine::getBpm() const noexcept {
    return bpm_.load();
}

void SyncEngine::adjustBpm(double delta) {
    setBpm(bpm_.load() + delta);
}

void SyncEngine::registerTapTempo() {
    auto now = std::chrono::steady_clock::now();
    tap_history_.push_back(now);
    if (tap_history_.size() > 5) {
        tap_history_.erase(tap_history_.begin());
    }

    if (tap_history_.size() >= 2) {
        std::vector<double> intervals;
        for (size_t i = 1; i < tap_history_.size(); ++i) {
            double ms = std::chrono::duration<double, std::milli>(tap_history_[i] - tap_history_[i - 1]).count();
            intervals.push_back(ms);
        }

        double avg_ms = std::accumulate(intervals.begin(), intervals.end(), 0.0) / intervals.size();
        if (avg_ms >= 200.0 && avg_ms <= 3000.0) {
            double calculated_bpm = 60000.0 / avg_ms;
            setBpm(calculated_bpm);
        }
    }
}

bool SyncEngine::isPlaying() const noexcept {
    return is_playing_.load();
}

uint64_t SyncEngine::getTotalTicks() const noexcept {
    return total_ticks_.load();
}

uint32_t SyncEngine::getCurrentBeat() const noexcept {
    return current_beat_.load();
}

void SyncEngine::setClockCallback(ClockTickCallback cb) {
    clock_cb_ = std::move(cb);
}

void SyncEngine::setTransportCallback(TransportCallback cb) {
    transport_cb_ = std::move(cb);
}

uint64_t SyncEngine::getMicrosecondsNow() {
    auto now = std::chrono::steady_clock::now().time_since_epoch();
    return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::microseconds>(now).count());
}

void SyncEngine::clockThreadLoop() {
    using namespace std::chrono;
    auto next_tick_tp = steady_clock::now();

    while (!should_stop_) {
        if (!is_playing_) {
            std::this_thread::sleep_for(milliseconds(5));
            next_tick_tp = steady_clock::now();
            continue;
        }

        // Calculate tick interval: 60.0 / (BPM * 24) in nanoseconds
        double current_bpm = bpm_.load();
        double tick_seconds = 60.0 / (current_bpm * 24.0);
        auto tick_duration = duration_cast<nanoseconds>(duration<double>(tick_seconds));

        next_tick_tp += tick_duration;

        // Sleep until shortly before deadline, then spin-wait for microsecond precision
        auto now = steady_clock::now();
        if (next_tick_tp > now) {
            auto diff = next_tick_tp - now;
            if (diff > milliseconds(2)) {
                std::this_thread::sleep_for(diff - milliseconds(1));
            }
            while (steady_clock::now() < next_tick_tp) {
#if defined(_MSC_VER) && (defined(_M_IX86) || defined(_M_X64))
                _mm_pause();
#endif
            }
        } else {
            // Clock slipped behind (e.g. system hiccup), reset reference to prevent burst
            next_tick_tp = steady_clock::now();
        }

        uint64_t tick = ++total_ticks_;
        bool is_quarter = (tick % 24 == 0);
        if (is_quarter) {
            current_beat_++;
        }

        if (clock_cb_) {
            clock_cb_(tick, current_beat_.load(), is_quarter);
        }
    }
}

} // namespace vlive
