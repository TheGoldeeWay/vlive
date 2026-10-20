#pragma once

#include <string>
#include <vector>
#include <memory>
#include <atomic>
#include <mutex>
#include <unordered_map>
#include <thread>
#include <functional>
#include "src/network/socket_utils.hpp"
#include "src/common/types.hpp"
#include "src/session/session_manager.hpp"
#include "src/midi/midi_engine.hpp"
#include "src/sync/sync_engine.hpp"

namespace vlive::net {

class WebSocketServer {
public:
    WebSocketServer(std::shared_ptr<SessionManager> session_mgr,
                    std::shared_ptr<MidiEngine> midi_engine,
                    std::shared_ptr<SyncEngine> sync_engine);
    ~WebSocketServer();

    // Accept an upgraded client connection from HttpServer
    void acceptConnection(SOCKET client_sock, const std::string& ws_key, const std::string& client_ip);

    // Multicast methods
    void broadcastBinary(const uint8_t* data, size_t length, uint32_t exclude_socket_id = 0);
    void broadcastText(const std::string& text, uint32_t exclude_socket_id = 0);
    void sendTextToClient(uint32_t socket_id, const std::string& text);
    void sendBinaryToClient(uint32_t socket_id, const uint8_t* data, size_t length);

    // Send 1-byte MIDI clock tick to all clients
    void broadcastClockTick();

    void stop();

private:
    struct ClientState {
        SOCKET sock{INVALID_SOCKET};
        uint32_t id{0};
        std::string ip;
        std::thread worker;
        std::atomic<bool> is_alive{true};
        std::mutex send_mutex;
    };

    void clientWorkerLoop(uint32_t client_id);
    void handleTextMessage(uint32_t client_id, const std::string& text);
    void handleBinaryMessage(uint32_t client_id, const uint8_t* data, size_t length);
    bool sendRawToClient(const std::shared_ptr<ClientState>& client, const uint8_t* data, size_t length);

    static std::vector<uint8_t> createWsFrame(const uint8_t* payload, size_t length, uint8_t opcode);

    std::shared_ptr<SessionManager> session_mgr_;
    std::shared_ptr<MidiEngine> midi_engine_;
    std::shared_ptr<SyncEngine> sync_engine_;

    std::mutex clients_mutex_;
    std::unordered_map<uint32_t, std::shared_ptr<ClientState>> clients_;
    std::atomic<uint32_t> next_client_id_{1};
    std::atomic<bool> should_stop_{false};
};

} // namespace vlive::net
