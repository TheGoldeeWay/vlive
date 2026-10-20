#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <mutex>
#include <memory>
#include "src/common/types.hpp"

namespace vlive {

struct GlobalState {
    double bpm{120.0};
    bool is_playing{false};
    uint8_t xy_x{64};
    uint8_t xy_y{64};
    uint8_t mixer_volumes[8]{100, 100, 100, 100, 100, 100, 100, 100};
    uint8_t mixer_pans[8]{64, 64, 64, 64, 64, 64, 64, 64};
    bool mixer_mutes[8]{false};
    bool mixer_solos[8]{false};
};

class SessionManager {
public:
    SessionManager();
    ~SessionManager() = default;

    // Client registration & lifecycle
    void registerClient(uint32_t socket_id, const std::string& ip_address);
    void unregisterClient(uint32_t socket_id);
    void updateClientInfo(uint32_t socket_id, const std::string& device_id, const std::string& device_name, PerformerRole role);
    void updateClientPing(uint32_t socket_id, double rtt_ms, double offset_ms);

    // Queries
    [[nodiscard]] size_t getClientCount() const;
    [[nodiscard]] std::vector<ClientSession> getAllSessions() const;
    [[nodiscard]] std::vector<uint32_t> getAllSocketIds(uint32_t exclude_socket_id = 0) const;

    // State Synchronization
    void setBpm(double bpm);
    void setPlaying(bool playing);
    void updateXY(uint8_t x, uint8_t y);
    void updateMixerFader(uint8_t channel, uint8_t volume);
    void updateMixerPan(uint8_t channel, uint8_t pan);
    void updateMixerMute(uint8_t channel, bool muted);
    void updateMixerSolo(uint8_t channel, bool solo);

    void setLayoutJson(const std::string& layout_json);
    [[nodiscard]] std::string getLayoutJson() const;

    [[nodiscard]] std::string getSerializedStateJson() const;

private:
    mutable std::mutex mutex_;
    std::unordered_map<uint32_t, ClientSession> sessions_;
    GlobalState state_;
    std::string layout_json_;
};

} // namespace vlive
