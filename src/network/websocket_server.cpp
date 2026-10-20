#include "src/network/websocket_server.hpp"
#include <iostream>
#include <sstream>
#include <iomanip>
#include <algorithm>

#ifdef _WIN32
#include <windows.h>
#include <avrt.h>
#endif

namespace vlive::net {

WebSocketServer::WebSocketServer(std::shared_ptr<SessionManager> session_mgr,
                                 std::shared_ptr<MidiEngine> midi_engine,
                                 std::shared_ptr<SyncEngine> sync_engine)
    : session_mgr_(std::move(session_mgr)),
      midi_engine_(std::move(midi_engine)),
      sync_engine_(std::move(sync_engine)) {}

WebSocketServer::~WebSocketServer() {
    stop();
}

void WebSocketServer::stop() {
    should_stop_ = true;

    std::vector<std::shared_ptr<ClientState>> clients_to_join;
    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        for (auto& [id, client] : clients_) {
            client->is_alive = false;
            if (client->sock != INVALID_SOCKET) {
                closesocket(client->sock);
                client->sock = INVALID_SOCKET;
            }
            clients_to_join.push_back(client);
        }
        clients_.clear();
    }

    for (auto& client : clients_to_join) {
        if (client->worker.joinable()) {
            client->worker.join();
        }
    }
}

void WebSocketServer::acceptConnection(SOCKET client_sock, const std::string& ws_key, const std::string& client_ip) {
    std::string accept_key = computeWebSocketAcceptKey(ws_key);

    std::ostringstream response;
    response << "HTTP/1.1 101 Switching Protocols\r\n"
             << "Upgrade: websocket\r\n"
             << "Connection: Upgrade\r\n"
             << "Sec-WebSocket-Accept: " << accept_key << "\r\n\r\n";

    std::string resp_str = response.str();
    if (send(client_sock, resp_str.c_str(), static_cast<int>(resp_str.size()), 0) <= 0) {
        closesocket(client_sock);
        return;
    }

    uint32_t id = next_client_id_++;
    auto client = std::make_shared<ClientState>();
    client->sock = client_sock;
    client->id = id;
    client->ip = client_ip;
    client->is_alive = true;

    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        clients_[id] = client;
    }

    if (session_mgr_) {
        session_mgr_->registerClient(id, client_ip);
        // Send initial state dump
        sendTextToClient(id, session_mgr_->getSerializedStateJson());
    }

    client->worker = std::thread(&WebSocketServer::clientWorkerLoop, this, id);
}

void WebSocketServer::clientWorkerLoop(uint32_t client_id) {
#ifdef _WIN32
    DWORD taskIndex = 0;
    HANDLE hAvrt = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);
    if (hAvrt) {
        AvSetMmThreadPriority(hAvrt, AVRT_PRIORITY_CRITICAL);
    }
    struct AvrtGuard {
        HANDLE h;
        ~AvrtGuard() { if (h) AvRevertMmThreadCharacteristics(h); }
    } avrtGuard{hAvrt};
#endif

    std::shared_ptr<ClientState> client;
    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        auto it = clients_.find(client_id);
        if (it != clients_.end()) client = it->second;
    }

    if (!client) return;

    uint8_t header[2];
    while (!should_stop_ && client->is_alive) {
        int r = recv(client->sock, reinterpret_cast<char*>(header), 2, MSG_WAITALL);
        if (r <= 0) break;

        uint8_t opcode = header[0] & 0x0F;
        bool masked = (header[1] & 0x80) != 0;
        uint64_t payload_len = header[1] & 0x7F;

        if (payload_len == 126) {
            uint8_t ext[2];
            if (recv(client->sock, reinterpret_cast<char*>(ext), 2, MSG_WAITALL) <= 0) break;
            payload_len = (static_cast<uint64_t>(ext[0]) << 8) | ext[1];
        } else if (payload_len == 127) {
            uint8_t ext[8];
            if (recv(client->sock, reinterpret_cast<char*>(ext), 8, MSG_WAITALL) <= 0) break;
            payload_len = 0;
            for (int i = 0; i < 8; ++i) {
                payload_len = (payload_len << 8) | ext[i];
            }
        }

        uint8_t mask_key[4]{0};
        if (masked) {
            if (recv(client->sock, reinterpret_cast<char*>(mask_key), 4, MSG_WAITALL) <= 0) break;
        }

        // Limit frame size to 1MB to prevent memory exhaustion
        if (payload_len > 1024 * 1024) break;

        std::vector<uint8_t> payload(static_cast<size_t>(payload_len));
        if (payload_len > 0) {
            size_t bytes_read = 0;
            while (bytes_read < payload_len) {
                int n = recv(client->sock, reinterpret_cast<char*>(payload.data() + bytes_read),
                             static_cast<int>(payload_len - bytes_read), 0);
                if (n <= 0) break;
                bytes_read += n;
            }
            if (bytes_read < payload_len) break;

            if (masked) {
                for (size_t i = 0; i < payload_len; ++i) {
                    payload[i] ^= mask_key[i % 4];
                }
            }
        }

        // Handle Opcodes
        if (opcode == 0x8) {
            // Close frame
            break;
        } else if (opcode == 0x9) {
            // Ping -> Send Pong
            auto pong_frame = createWsFrame(payload.data(), payload.size(), 0xA);
            send(client->sock, reinterpret_cast<const char*>(pong_frame.data()), static_cast<int>(pong_frame.size()), 0);
        } else if (opcode == 0x2) {
            // Fast-path Binary MIDI message
            handleBinaryMessage(client_id, payload.data(), payload.size());
        } else if (opcode == 0x1) {
            // Text JSON message
            std::string text(reinterpret_cast<char*>(payload.data()), payload.size());
            handleTextMessage(client_id, text);
        }
    }

    // Connection teardown
    client->is_alive = false;
    if (session_mgr_) {
        session_mgr_->unregisterClient(client_id);
    }

    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        if (client->sock != INVALID_SOCKET) {
            closesocket(client->sock);
            client->sock = INVALID_SOCKET;
        }
    }
}

void WebSocketServer::handleBinaryMessage(uint32_t client_id, const uint8_t* data, size_t length) {
    if (!data || length == 0) return;
    if (midi_engine_) {
        midi_engine_->dispatchRawBytes(data, length);
    }
    // Broadcast binary MIDI to all other connected performers/devices
    broadcastBinary(data, length, client_id);
}

static std::string extractJsonField(const std::string& json, const std::string& key) {
    std::string needle = "\"" + key + "\":";
    size_t pos = json.find(needle);
    if (pos == std::string::npos) return "";
    pos += needle.size();

    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
    if (pos >= json.size()) return "";

    if (json[pos] == '"') {
        size_t end = json.find('"', pos + 1);
        if (end != std::string::npos) {
            return json.substr(pos + 1, end - pos - 1);
        }
    } else {
        size_t end = json.find_first_of(",}\n\r", pos);
        if (end != std::string::npos) {
            return json.substr(pos, end - pos);
        }
    }
    return "";
}

void WebSocketServer::handleTextMessage(uint32_t client_id, const std::string& text) {
    std::string type = extractJsonField(text, "type");

    if (type == "ping") {
        // High-precision NTP Clock Sync response
        std::string t0_str = extractJsonField(text, "t0");
        uint64_t t1 = SyncEngine::getMicrosecondsNow() / 1000; // ms
        uint64_t t2 = t1;

        std::ostringstream ss;
        ss << "{\"type\":\"pong\",\"t0\":" << (t0_str.empty() ? "0" : t0_str)
           << ",\"t1\":" << t1 << ",\"t2\":" << t2 << "}";
        sendTextToClient(client_id, ss.str());

    } else if (type == "hello") {
        std::string dev_id = extractJsonField(text, "deviceId");
        std::string dev_name = extractJsonField(text, "deviceName");
        std::string role_str = extractJsonField(text, "role");

        if (session_mgr_) {
            session_mgr_->updateClientInfo(client_id, dev_id, dev_name, stringToRole(role_str));
        }

    } else if (type == "bpm_change") {
        std::string bpm_str = extractJsonField(text, "bpm");
        if (!bpm_str.empty()) {
            double bpm = std::stod(bpm_str);
            if (sync_engine_) sync_engine_->setBpm(bpm);
            if (session_mgr_) session_mgr_->setBpm(bpm);
            // Broadcast to other devices
            broadcastText("{\"type\":\"bpm_update\",\"bpm\":" + std::to_string(bpm) + "}", client_id);
        }

    } else if (type == "transport_change") {
        std::string playing_str = extractJsonField(text, "playing");
        bool playing = (playing_str == "true" || playing_str == "1");
        if (sync_engine_) {
            if (playing) sync_engine_->start();
            else sync_engine_->stop();
        }
        if (session_mgr_) session_mgr_->setPlaying(playing);
        broadcastText("{\"type\":\"transport_update\",\"playing\":" + std::string(playing ? "true" : "false") + "}", client_id);

    } else if (type == "widget_update" || type == "param_update") {
        // Broadcast custom widget value changes to all other connected performers & host
        broadcastText(text, client_id);

    } else if (type == "sync_layout") {
        // Cache layout object/array in session manager so any new device connecting receives it
        size_t lpos = text.find("\"layout\":");
        if (lpos != std::string::npos) {
            size_t start = text.find_first_of("[{", lpos);
            if (start != std::string::npos) {
                char open_ch = text[start];
                char close_ch = (open_ch == '[') ? ']' : '}';
                int depth = 0;
                size_t end = std::string::npos;
                bool in_str = false;
                for (size_t i = start; i < text.size(); ++i) {
                    if (text[i] == '"' && (i == 0 || text[i - 1] != '\\')) {
                        in_str = !in_str;
                    } else if (!in_str) {
                        if (text[i] == open_ch) depth++;
                        else if (text[i] == close_ch) {
                            depth--;
                            if (depth == 0) { end = i; break; }
                        }
                    }
                }
                if (end != std::string::npos && session_mgr_) {
                    std::string layout_data = text.substr(start, end - start + 1);
                    session_mgr_->setLayoutJson(layout_data);
                }
            }
        }
        broadcastText(text, client_id);

    } else if (type == "page_switch") {
        // Broadcast page flip to all connected devices so they stay on the same active deck
        size_t ppos = text.find("\"pageIndex\":");
        if (ppos != std::string::npos && session_mgr_) {
            try {
                int pidx = std::stoi(text.substr(ppos + 12));
                std::string cur_layout = session_mgr_->getLayoutJson();
                size_t apos = cur_layout.find("\"activePageIndex\":");
                if (apos != std::string::npos) {
                    size_t comma = cur_layout.find_first_of(",}", apos);
                    if (comma != std::string::npos) {
                        cur_layout.replace(apos + 18, comma - (apos + 18), std::to_string(pidx));
                        session_mgr_->setLayoutJson(cur_layout);
                    }
                }
            } catch (...) {}
        }
        broadcastText(text, client_id);

    } else if (type == "role_select") {
        std::string role_str = extractJsonField(text, "role");
        if (session_mgr_) {
            session_mgr_->updateClientInfo(client_id, "", "", stringToRole(role_str));
        }
    }
}

bool WebSocketServer::sendRawToClient(const std::shared_ptr<ClientState>& client, const uint8_t* data, size_t length) {
    if (!client || !client->is_alive || client->sock == INVALID_SOCKET || !data || length == 0) {
        return false;
    }
    std::lock_guard<std::mutex> lock(client->send_mutex);
    if (!client->is_alive || client->sock == INVALID_SOCKET) {
        return false;
    }
    int res = send(client->sock, reinterpret_cast<const char*>(data), static_cast<int>(length), 0);
    if (res <= 0) {
        client->is_alive = false;
        return false;
    }
    return true;
}

std::vector<uint8_t> WebSocketServer::createWsFrame(const uint8_t* payload, size_t length, uint8_t opcode) {
    std::vector<uint8_t> frame;
    frame.push_back(static_cast<uint8_t>(0x80 | (opcode & 0x0F))); // FIN + opcode

    // Server-to-client frames MUST NOT be masked
    if (length <= 125) {
        frame.push_back(static_cast<uint8_t>(length));
    } else if (length <= 65535) {
        frame.push_back(126);
        frame.push_back(static_cast<uint8_t>((length >> 8) & 0xFF));
        frame.push_back(static_cast<uint8_t>(length & 0xFF));
    } else {
        frame.push_back(127);
        for (int i = 7; i >= 0; --i) {
            frame.push_back(static_cast<uint8_t>((length >> (i * 8)) & 0xFF));
        }
    }

    if (payload && length > 0) {
        frame.insert(frame.end(), payload, payload + length);
    }
    return frame;
}

void WebSocketServer::sendTextToClient(uint32_t socket_id, const std::string& text) {
    std::shared_ptr<ClientState> client;
    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        auto it = clients_.find(socket_id);
        if (it != clients_.end()) client = it->second;
    }
    if (client) {
        auto frame = createWsFrame(reinterpret_cast<const uint8_t*>(text.data()), text.size(), 0x1);
        sendRawToClient(client, frame.data(), frame.size());
    }
}

void WebSocketServer::sendBinaryToClient(uint32_t socket_id, const uint8_t* data, size_t length) {
    std::shared_ptr<ClientState> client;
    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        auto it = clients_.find(socket_id);
        if (it != clients_.end()) client = it->second;
    }
    if (client) {
        auto frame = createWsFrame(data, length, 0x2);
        sendRawToClient(client, frame.data(), frame.size());
    }
}

void WebSocketServer::broadcastText(const std::string& text, uint32_t exclude_socket_id) {
    auto frame = createWsFrame(reinterpret_cast<const uint8_t*>(text.data()), text.size(), 0x1);

    std::vector<std::shared_ptr<ClientState>> targets;
    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        for (const auto& [id, client] : clients_) {
            if (id != exclude_socket_id && client->is_alive && client->sock != INVALID_SOCKET) {
                targets.push_back(client);
            }
        }
    }

    for (const auto& client : targets) {
        sendRawToClient(client, frame.data(), frame.size());
    }
}

void WebSocketServer::broadcastBinary(const uint8_t* data, size_t length, uint32_t exclude_socket_id) {
    auto frame = createWsFrame(data, length, 0x2);

    std::vector<std::shared_ptr<ClientState>> targets;
    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        for (const auto& [id, client] : clients_) {
            if (id != exclude_socket_id && client->is_alive && client->sock != INVALID_SOCKET) {
                targets.push_back(client);
            }
        }
    }

    for (const auto& client : targets) {
        sendRawToClient(client, frame.data(), frame.size());
    }
}

void WebSocketServer::broadcastClockTick() {
    uint8_t tick_byte = midi_status::TIMING_CLOCK;
    broadcastBinary(&tick_byte, 1);
}

} // namespace vlive::net
