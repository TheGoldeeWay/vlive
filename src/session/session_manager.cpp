#include "src/session/session_manager.hpp"
#include <sstream>
#include <iomanip>

namespace vlive {

SessionManager::SessionManager() = default;

void SessionManager::registerClient(uint32_t socket_id, const std::string& ip_address) {
    std::lock_guard<std::mutex> lock(mutex_);
    ClientSession s;
    s.socket_id = socket_id;
    s.ip_address = ip_address;
    s.last_ping_time = std::chrono::steady_clock::now();
    sessions_[socket_id] = s;
}

void SessionManager::unregisterClient(uint32_t socket_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    sessions_.erase(socket_id);
}

void SessionManager::updateClientInfo(uint32_t socket_id, const std::string& device_id, const std::string& device_name, PerformerRole role) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = sessions_.find(socket_id);
    if (it != sessions_.end()) {
        it->second.device_id = device_id;
        it->second.device_name = device_name;
        it->second.role = role;
    }
}

void SessionManager::updateClientPing(uint32_t socket_id, double rtt_ms, double offset_ms) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = sessions_.find(socket_id);
    if (it != sessions_.end()) {
        it->second.rtt_ms = rtt_ms;
        it->second.clock_offset_ms = offset_ms;
        it->second.last_ping_time = std::chrono::steady_clock::now();
    }
}

size_t SessionManager::getClientCount() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return sessions_.size();
}

std::vector<ClientSession> SessionManager::getAllSessions() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<ClientSession> result;
    result.reserve(sessions_.size());
    for (const auto& [_, sess] : sessions_) {
        result.push_back(sess);
    }
    return result;
}

std::vector<uint32_t> SessionManager::getAllSocketIds(uint32_t exclude_socket_id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<uint32_t> ids;
    ids.reserve(sessions_.size());
    for (const auto& [id, _] : sessions_) {
        if (id != exclude_socket_id) {
            ids.push_back(id);
        }
    }
    return ids;
}

void SessionManager::setBpm(double bpm) {
    std::lock_guard<std::mutex> lock(mutex_);
    state_.bpm = bpm;
}

void SessionManager::setPlaying(bool playing) {
    std::lock_guard<std::mutex> lock(mutex_);
    state_.is_playing = playing;
}

void SessionManager::updateXY(uint8_t x, uint8_t y) {
    std::lock_guard<std::mutex> lock(mutex_);
    state_.xy_x = x;
    state_.xy_y = y;
}

void SessionManager::updateMixerFader(uint8_t channel, uint8_t volume) {
    if (channel >= 8) return;
    std::lock_guard<std::mutex> lock(mutex_);
    state_.mixer_volumes[channel] = volume;
}

void SessionManager::updateMixerPan(uint8_t channel, uint8_t pan) {
    if (channel >= 8) return;
    std::lock_guard<std::mutex> lock(mutex_);
    state_.mixer_pans[channel] = pan;
}

void SessionManager::updateMixerMute(uint8_t channel, bool muted) {
    if (channel >= 8) return;
    std::lock_guard<std::mutex> lock(mutex_);
    state_.mixer_mutes[channel] = muted;
}

void SessionManager::updateMixerSolo(uint8_t channel, bool solo) {
    if (channel >= 8) return;
    std::lock_guard<std::mutex> lock(mutex_);
    state_.mixer_solos[channel] = solo;
}

void SessionManager::setLayoutJson(const std::string& layout_json) {
    std::lock_guard<std::mutex> lock(mutex_);
    layout_json_ = layout_json;
}

std::string SessionManager::getLayoutJson() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return layout_json_;
}

std::string SessionManager::getSerializedStateJson() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::ostringstream ss;
    ss << "{\"type\":\"state_sync\",\"bpm\":" << state_.bpm
       << ",\"playing\":" << (state_.is_playing ? "true" : "false")
       << ",\"xy\":{\"x\":" << static_cast<int>(state_.xy_x) << ",\"y\":" << static_cast<int>(state_.xy_y) << "}"
       << ",\"volumes\":[";
    for (int i = 0; i < 8; ++i) {
        ss << static_cast<int>(state_.mixer_volumes[i]) << (i < 7 ? "," : "");
    }
    ss << "]";
    if (!layout_json_.empty()) {
        ss << ",\"layout\":" << layout_json_;
    }
    ss << "}";
    return ss.str();
}

} // namespace vlive
