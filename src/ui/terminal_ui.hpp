#pragma once

#include <string>
#include <vector>
#include <memory>
#include <chrono>
#include "src/common/types.hpp"
#include "src/session/session_manager.hpp"
#include "src/midi/midi_engine.hpp"
#include "src/sync/sync_engine.hpp"

namespace vlive::ui {

class TerminalUI {
public:
    TerminalUI(std::shared_ptr<SessionManager> session_mgr,
               std::shared_ptr<MidiEngine> midi_engine,
               std::shared_ptr<SyncEngine> sync_engine);
    ~TerminalUI();

    // Prints the launch banner, local server URLs, and ASCII QR Code
    void printStartupBanner(const std::vector<std::string>& local_ips, uint16_t port);

    // Prints the ASCII QR code for the given URL directly to stdout
    static void printAsciiQr(const std::string& url);

    // Generates an SVG string of the QR Code
    static std::string generateQrSvg(const std::string& url);

    // Refreshes the live HUD display in the console
    void renderHud();

    // Check non-blocking keyboard input (e.g. Space to play/pause, T for tap tempo)
    // Returns false if user requested exit ('q' or ESC)
    bool processInput();

private:
    std::shared_ptr<SessionManager> session_mgr_;
    std::shared_ptr<MidiEngine> midi_engine_;
    std::shared_ptr<SyncEngine> sync_engine_;

    std::chrono::steady_clock::time_point last_render_tp_;
    std::string primary_url_;
};

} // namespace vlive::ui
