#include <iostream>
#include <memory>
#include <string>
#include <vector>
#include <thread>
#include <chrono>
#include <sstream>

#include "src/network/socket_utils.hpp"
#include "src/network/http_server.hpp"
#include "src/network/websocket_server.hpp"
#include "src/midi/midi_engine.hpp"
#include "src/sync/sync_engine.hpp"
#include "src/session/session_manager.hpp"
#include "src/ui/terminal_ui.hpp"

int main(int argc, char* argv[]) {
    // Initialize Winsock
    vlive::net::WinsockScope winsock_scope;

    // Command Line Options
    uint16_t http_port = 8088;
    double initial_bpm = 120.0;
    std::string web_root = "web";
    bool open_browser = false;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--port" && i + 1 < argc) {
            http_port = static_cast<uint16_t>(std::stoi(argv[++i]));
        } else if (arg == "--bpm" && i + 1 < argc) {
            initial_bpm = std::stod(argv[++i]);
        } else if (arg == "--web-root" && i + 1 < argc) {
            web_root = argv[++i];
        } else if (arg == "--open") {
            open_browser = true;
        }
    }

    // 1. Initialize Core Subsystems
    auto midi_engine = std::make_shared<vlive::MidiEngine>();
    auto sync_engine = std::make_shared<vlive::SyncEngine>();
    auto session_mgr = std::make_shared<vlive::SessionManager>();

    sync_engine->setBpm(initial_bpm);
    session_mgr->setBpm(initial_bpm);

    auto local_ips = vlive::net::getLocalIpAddresses();
    std::string primary_url = "http://" + (local_ips.empty() ? "127.0.0.1" : local_ips[0]) + ":" + std::to_string(http_port);

    // 2. Initialize WebSocket & HTTP Servers
    auto ws_server = std::make_shared<vlive::net::WebSocketServer>(session_mgr, midi_engine, sync_engine);

    // Full-Duplex DAW bi-directional sync: Broadcast any MIDI incoming from DAW directly to all web/app clients
    midi_engine->setIncomingRawCallback([ws_server](const uint8_t* data, size_t length) {
        if (ws_server) {
            ws_server->broadcastBinary(data, length);
        }
    });

    auto http_server = std::make_unique<vlive::net::HttpServer>(http_port, web_root);
    http_server->setPrimaryUrl(primary_url);
    
    http_server->setApiInfoProvider([&]() {
        auto adapters = vlive::net::getNetworkAdapters();
        std::ostringstream ss;
        ss << "{\"status\":\"ok\""
           << ",\"version\":\"2.0.0\""
           << ",\"port\":" << http_port
           << ",\"lanIp\":\"" << (adapters.empty() ? "127.0.0.1" : adapters[0].ip) << "\""
           << ",\"bpm\":" << sync_engine->getBpm()
           << ",\"playing\":" << (sync_engine->isPlaying() ? "true" : "false")
           << ",\"virtual_midi_active\":" << (midi_engine->isVirtualPortActive() ? "true" : "false")
           << ",\"virtual_midi_name\":\"" << midi_engine->getVirtualPortName() << "\""
           << ",\"winmm_active\":" << (midi_engine->isWinMidiActive() ? "true" : "false")
           << ",\"winmm_port\":\"" << midi_engine->getActiveWinMidiPortName() << "\""
           << ",\"clients_count\":" << session_mgr->getClientCount()
           << ",\"ips\":[";
        for (size_t k = 0; k < adapters.size(); ++k) {
            ss << "\"" << adapters[k].ip << "\"" << (k + 1 < adapters.size() ? "," : "");
        }
        ss << "],\"adapters\":[";
        for (size_t k = 0; k < adapters.size(); ++k) {
            ss << "{\"ip\":\"" << adapters[k].ip << "\""
               << ",\"name\":\"" << adapters[k].friendly_name << "\""
               << ",\"desc\":\"" << adapters[k].description << "\""
               << ",\"is_wifi\":" << (adapters[k].is_wifi ? "true" : "false")
               << ",\"is_virtual\":" << (adapters[k].is_virtual ? "true" : "false")
               << "}" << (k + 1 < adapters.size() ? "," : "");
        }
        ss << "]}";
        return ss.str();
    });

    http_server->setPortsListProvider([midi_engine]() {
        auto ports = vlive::MidiEngine::enumerateWinMidiPorts();
        std::ostringstream ss;
        ss << "{\"active\":\"" << midi_engine->getActiveWinMidiPortName() << "\""
           << ",\"virtual_active\":" << (midi_engine->isVirtualPortActive() ? "true" : "false")
           << ",\"virtual_name\":\"" << midi_engine->getVirtualPortName() << "\""
           << ",\"ports\":[";
        for (size_t i = 0; i < ports.size(); ++i) {
            ss << "\"" << ports[i] << "\"" << (i + 1 < ports.size() ? "," : "");
        }
        ss << "]}";
        return ss.str();
    });

    http_server->setPortConnectHandler([midi_engine](const std::string& p) {
        bool ok = midi_engine->selectWinMidiPort(p);
        std::ostringstream ss;
        ss << "{\"status\":\"" << (ok ? "ok" : "error") << "\""
           << ",\"port\":\"" << midi_engine->getActiveWinMidiPortName() << "\""
           << ",\"connected\":" << (ok ? "true" : "false") << "}";
        return ss.str();
    });

    http_server->setTestNoteHandler([midi_engine]() {
        bool ok = midi_engine->sendTestNote(60, 110);
        return std::string("{\"status\":\"") + (ok ? "ok" : "error") + "\",\"note\":60}";
    });

    http_server->setWebSocketUpgradeCallback([ws_server](SOCKET sock, const std::string& key, const std::string& ip) {
        ws_server->acceptConnection(sock, key, ip);
    });

    if (!http_server->start()) {
        std::cerr << "Error: Failed to bind HTTP server to port " << http_port << "\n";
        return 1;
    }

    http_port = http_server->getPort();
    primary_url = "http://" + (local_ips.empty() ? "127.0.0.1" : local_ips[0]) + ":" + std::to_string(http_port);
    http_server->setPrimaryUrl(primary_url);

    if (open_browser) {
        std::string open_cmd = "start " + primary_url;
        std::system(open_cmd.c_str());
    }

    // 3. Connect Clock Sync Callback (24 PPQN master tick)
    sync_engine->setClockCallback([midi_engine, ws_server](uint64_t /*tick*/, uint32_t /*beat*/, bool /*is_quarter*/) {
        midi_engine->sendClockTick();
        ws_server->broadcastClockTick();
    });

    std::atomic<bool> app_running{true};

    // 4. Initialize Terminal UI & Display Startup Banner
    auto terminal_ui = std::make_unique<vlive::ui::TerminalUI>(session_mgr, midi_engine, sync_engine);
    terminal_ui->printStartupBanner(local_ips, http_port);

    // 5. Main Interactive Performance Loop
    while (app_running) {
        terminal_ui->renderHud();

        if (!terminal_ui->processInput()) {
            // User pressed 'q' or ESC
            app_running = false;
            break;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }

    std::cout << "\n[VLive] Shutting down clean...\n";
    app_running = false;

    http_server->stop();
    ws_server->stop();

    std::cout << "[VLive] Done. Goodbye!\n";
    return 0;
}
