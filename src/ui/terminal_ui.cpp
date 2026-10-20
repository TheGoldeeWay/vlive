#include "src/ui/terminal_ui.hpp"
#include <iostream>
#include <iomanip>
#include <sstream>
#include <array>
#include <algorithm>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <conio.h>
#else
#include <termios.h>
#include <unistd.h>
#include <sys/ioctl.h>
#endif

namespace vlive::ui {

// Compact self-contained QR Code Generator
namespace qr {
    // Generates a QR Code matrix (vector of rows of booleans, true = black module)
    // Uses standard QR Code Version 2 (25x25) or Version 3 (29x29) with byte encoding
    
    // Standard Reed-Solomon Galois Field GF(256) tables with poly 0x11D
    static const auto [gf_exp, gf_log] = []() {
        std::array<uint8_t, 512> exp{};
        std::array<uint8_t, 256> log{};
        uint16_t x = 1;
        for (size_t i = 0; i < 255; ++i) {
            exp[i] = static_cast<uint8_t>(x);
            exp[i + 255] = static_cast<uint8_t>(x);
            log[static_cast<uint8_t>(x)] = static_cast<uint8_t>(i);
            x = (x << 1) ^ ((x & 0x80) ? 0x11D : 0);
        }
        return std::pair{exp, log};
    }();

    inline uint8_t gf_mul(uint8_t a, uint8_t b) {
        if (a == 0 || b == 0) return 0;
        return gf_exp[(gf_log[a] + gf_log[b]) % 255];
    }

    inline std::vector<uint8_t> get_generator_poly_desc(size_t ec_len) {
        std::vector<uint8_t> gen = {1};
        for (size_t i = 0; i < ec_len; ++i) {
            std::vector<uint8_t> next_gen(gen.size() + 1, 0);
            uint8_t factor = gf_exp[i];
            for (size_t j = 0; j < gen.size(); ++j) {
                next_gen[j] ^= gf_mul(gen[j], factor);
                next_gen[j + 1] ^= gen[j];
            }
            gen = next_gen;
        }
        std::reverse(gen.begin(), gen.end());
        return gen;
    }

    inline std::vector<uint8_t> rs_encode(const std::vector<uint8_t>& data, size_t ec_len) {
        auto gen = get_generator_poly_desc(ec_len);
        std::vector<uint8_t> rem(ec_len, 0);
        for (uint8_t b : data) {
            uint8_t factor = b ^ rem[0];
            for (size_t i = 0; i < ec_len - 1; ++i) {
                rem[i] = rem[i + 1] ^ gf_mul(gen[i + 1], factor);
            }
            rem[ec_len - 1] = gf_mul(gen[ec_len], factor);
        }
        return rem;
    }

    inline std::vector<std::vector<bool>> generateQrMatrix(const std::string& text) {
        // Determine version based on text length:
        // Version 2 (25x25): up to 32 bytes (EC-L)
        // Version 3 (29x29): up to 53 bytes (EC-L)
        // Version 4 (33x33): up to 78 bytes (EC-L)
        int version = 2;
        if (text.size() > 53) version = 4;
        else if (text.size() > 32) version = 3;

        int size = 17 + 4 * version; // 25 for V2, 29 for V3, 33 for V4
        int total_codewords = (version == 2) ? 44 : ((version == 3) ? 70 : 100);
        int ec_codewords = (version == 2) ? 10 : ((version == 3) ? 15 : 20); // Level L
        int data_codewords = total_codewords - ec_codewords; // 34 for V2, 55 for V3, 80 for V4

        std::vector<std::vector<int>> grid(size, std::vector<int>(size, -1));

        // 1. Finder patterns (7x7) at (0,0), (size-7, 0), (0, size-7)
        auto add_finder = [&](int r, int c) {
            for (int dr = 0; dr < 7; ++dr) {
                for (int dc = 0; dc < 7; ++dc) {
                    bool black = (dr == 0 || dr == 6 || dc == 0 || dc == 6 ||
                                 (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
                    grid[r + dr][c + dc] = black ? 1 : 0;
                }
            }
            // Separator ring
            for (int dr = -1; dr <= 7; ++dr) {
                for (int dc = -1; dc <= 7; ++dc) {
                    int nr = r + dr;
                    int nc = c + dc;
                    if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
                        if (grid[nr][nc] == -1) grid[nr][nc] = 0;
                    }
                }
            }
        };

        add_finder(0, 0);
        add_finder(size - 7, 0);
        add_finder(0, size - 7);

        // 2. Alignment pattern for Version 2 (18), Version 3 (22), Version 4 (26)
        int align_pos = (version == 2) ? 18 : ((version == 3) ? 22 : 26);
        for (int dr = -2; dr <= 2; ++dr) {
            for (int dc = -2; dc <= 2; ++dc) {
                bool black = (dr == -2 || dr == 2 || dc == -2 || dc == 2 || (dr == 0 && dc == 0));
                grid[align_pos + dr][align_pos + dc] = black ? 1 : 0;
            }
        }

        // 3. Timing patterns (row 6 and col 6)
        for (int i = 8; i < size - 8; ++i) {
            if (grid[6][i] == -1) grid[6][i] = (i % 2 == 0) ? 1 : 0;
            if (grid[i][6] == -1) grid[i][6] = (i % 2 == 0) ? 1 : 0;
        }

        // Dark module
        grid[4 * version + 9][8] = 1;

        // 4. Encode Payload data: Byte mode (0100) + length (8 bits) + chars + terminator + padding
        std::vector<uint8_t> bit_buf;
        auto append_bits = [&](uint32_t val, int count) {
            for (int i = count - 1; i >= 0; --i) {
                bit_buf.push_back((val >> i) & 1);
            }
        };

        append_bits(0b0100, 4); // Byte mode
        append_bits(static_cast<uint32_t>(text.size()), 8);
        for (char c : text) {
            append_bits(static_cast<uint8_t>(c), 8);
        }
        // Terminator (up to 4 zeros)
        int pad_bits = (std::min)(4, static_cast<int>(data_codewords * 8 - bit_buf.size()));
        if (pad_bits > 0) append_bits(0, pad_bits);
        // Byte align
        while (bit_buf.size() % 8 != 0) bit_buf.push_back(0);

        // Convert bit stream to codewords
        std::vector<uint8_t> data_words;
        for (size_t i = 0; i < bit_buf.size(); i += 8) {
            uint8_t w = 0;
            for (size_t j = 0; j < 8; ++j) {
                w = (w << 1) | bit_buf[i + j];
            }
            data_words.push_back(w);
        }

        // Pad with alternating 0xEC and 0x11
        uint8_t pad_val = 0xEC;
        while (data_words.size() < static_cast<size_t>(data_codewords)) {
            data_words.push_back(pad_val);
            pad_val = (pad_val == 0xEC) ? 0x11 : 0xEC;
        }

        // Compute Reed-Solomon EC bytes
        size_t ec_bytes = static_cast<size_t>(ec_codewords); // Exactly matches ec_codewords
        auto ec_words = rs_encode(data_words, ec_bytes);

        std::vector<uint8_t> all_codewords = data_words;
        all_codewords.insert(all_codewords.end(), ec_words.begin(), ec_words.end());

        // Convert all codewords back to bit stream for layout
        std::vector<uint8_t> final_bits;
        for (uint8_t b : all_codewords) {
            for (int i = 7; i >= 0; --i) {
                final_bits.push_back((b >> i) & 1);
            }
        }

        // 5. Place codewords into grid avoiding function patterns
        size_t bit_idx = 0;
        int dir = -1; // Going up
        int c = size - 1;

        while (c > 0) {
            if (c == 6) c--; // Skip vertical timing pattern
            int r = (dir == -1) ? (size - 1) : 0;
            while (r >= 0 && r < size) {
                for (int dc = 0; dc < 2; ++dc) {
                    int curr_c = c - dc;
                    if (grid[r][curr_c] == -1) {
                        bool bit = (bit_idx < final_bits.size()) ? (final_bits[bit_idx++] != 0) : false;
                        // Apply Mask 0: (row + column) % 2 == 0
                        if ((r + curr_c) % 2 == 0) bit = !bit;
                        grid[r][curr_c] = bit ? 1 : 0;
                    }
                }
                r += dir;
            }
            dir = -dir;
            c -= 2;
        }

        // 6. Format Information (Mask 0 + EC Level L = 01)
        // Format bits for EC L (01) + Mask 0 (000) = 0x77C4 (0b111011111000100)
        static const uint16_t format_bits = 0x77C4;
        for (int i = 0; i < 15; ++i) {
            bool b = ((format_bits >> i) & 1) != 0;
            int fmt_bit_idx = 14 - i;

            // Around top-left finder (bit 14 at [8][0] down to bit 0 at [0][8]):
            int fr = 0, fc = 0;
            if (i < 6) { fr = 8; fc = i; }
            else if (i == 6) { fr = 8; fc = 7; }
            else if (i == 7) { fr = 8; fc = 8; }
            else if (i == 8) { fr = 7; fc = 8; }
            else { fr = 14 - i; fc = 8; }
            grid[fr][fc] = ((format_bits >> fmt_bit_idx) & 1) ? 1 : 0;

            // Around bottom-left / top-right:
            if (i < 7) {
                grid[size - 1 - i][8] = b ? 1 : 0;
            } else {
                grid[8][size - 15 + i] = b ? 1 : 0;
            }
        }

        std::vector<std::vector<bool>> result(size, std::vector<bool>(size, false));
        for (int r = 0; r < size; ++r) {
            for (int col = 0; col < size; ++col) {
                result[r][col] = (grid[r][col] == 1);
            }
        }
        return result;
    }
} // namespace qr

TerminalUI::TerminalUI(std::shared_ptr<SessionManager> session_mgr,
                       std::shared_ptr<MidiEngine> midi_engine,
                       std::shared_ptr<SyncEngine> sync_engine)
    : session_mgr_(std::move(session_mgr)),
      midi_engine_(std::move(midi_engine)),
      sync_engine_(std::move(sync_engine)),
      last_render_tp_(std::chrono::steady_clock::now()) {

#ifdef _WIN32
    // Enable ANSI escape sequences and UTF-8 console output
    HANDLE hOut = GetStdHandle(STD_OUTPUT_HANDLE);
    if (hOut != INVALID_HANDLE_VALUE) {
        DWORD dwMode = 0;
        if (GetConsoleMode(hOut, &dwMode)) {
            dwMode |= ENABLE_VIRTUAL_TERMINAL_PROCESSING;
            SetConsoleMode(hOut, dwMode);
        }
    }
    SetConsoleOutputCP(CP_UTF8);
#endif
}

TerminalUI::~TerminalUI() = default;

void TerminalUI::printAsciiQr(const std::string& url) {
    auto matrix = qr::generateQrMatrix(url);
    int size = static_cast<int>(matrix.size());
    int border = 2;

    // Render using Unicode half-block '▀' (U+2580):
    // Top pixel foreground, bottom pixel background.
    // If top is white (false) and bottom is black (true), etc.
    // In terminals, black modules are dark, white modules are light.
    for (int r = -border; r < size + border; r += 2) {
        std::cout << "    ";
        for (int c = -border; c < size + border; ++c) {
            bool top_black = (r >= 0 && r < size && c >= 0 && c < size) ? matrix[r][c] : false;
            bool bot_black = (r + 1 >= 0 && r + 1 < size && c >= 0 && c < size) ? matrix[r + 1][c] : false;

            // Invert colors so quiet zone and background are white (or standard terminal QR format)
            // ANSI escape: 47 = White BG, 40 = Black BG, 30 = Black FG, 37 = White FG
            if (!top_black && !bot_black) {
                // Both white
                std::cout << "\033[47;37m \033[0m";
            } else if (top_black && bot_black) {
                // Both black
                std::cout << "\033[40;30m \033[0m";
            } else if (top_black && !bot_black) {
                // Top black, bottom white
                std::cout << "\033[47;30m▀\033[0m";
            } else {
                // Top white, bottom black
                std::cout << "\033[40;37m▀\033[0m";
            }
        }
        std::cout << "\n";
    }
    std::cout << std::flush;
}

std::string TerminalUI::generateQrSvg(const std::string& url) {
    auto matrix = qr::generateQrMatrix(url);
    int size = static_cast<int>(matrix.size());
    int border = 4; // Standard 4-module quiet zone (ISO/IEC 18004)
    int total_dim = size + 2 * border;

    std::ostringstream ss;
    ss << "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " << total_dim << " " << total_dim
       << "\" width=\"100%\" height=\"100%\" shape-rendering=\"crispEdges\">\n"
       << "<rect width=\"100%\" height=\"100%\" fill=\"#ffffff\" />\n";

    for (int r = 0; r < size; ++r) {
        for (int c = 0; c < size; ++c) {
            if (matrix[r][c]) {
                ss << "<rect x=\"" << (c + border) << "\" y=\"" << (r + border)
                   << "\" width=\"1\" height=\"1\" fill=\"#000000\" />\n";
            }
        }
    }
    ss << "</svg>\n";
    return ss.str();
}

void TerminalUI::printStartupBanner(const std::vector<std::string>& local_ips, uint16_t port) {
    std::cout << "\033[2J\033[H"; // Clear screen
    std::cout << "\033[1;36m";
    std::cout << "====================================================================\n";
    std::cout << "  __      __  _      _               \n";
    std::cout << "  \\ \\    / / | |    (_)              \n";
    std::cout << "   \\ \\  / /  | |     _  __   __ ___  \n";
    std::cout << "    \\ \\/ /   | |    | | \\ \\ / // _ \\ \n";
    std::cout << "     \\  /    | |____| |  \\ V /|  __/ \n";
    std::cout << "      \\/     |______|_|   \\_/  \\___|   STAGE MIDI CONTROLLER CORE\n";
    std::cout << "====================================================================\n";
    std::cout << "\033[0m\n";

    primary_url_ = "http://" + local_ips[0] + ":" + std::to_string(port);

    std::cout << "\033[1;32m [✓] VLive Server Active!\033[0m\n\n";
    std::cout << "  Connect your performer devices (phones, tablets, laptops):\n";
    for (const auto& ip : local_ips) {
        std::cout << "    • \033[1;33mhttp://" << ip << ":" << port << "\033[0m\n";
    }
    std::cout << "\n  \033[1;35mScan with iPhone / Android Camera for instant connection:\033[0m\n\n";

    printAsciiQr(primary_url_);

    std::cout << "\n\033[1;36m--------------------------------------------------------------------\033[0m\n";
    std::cout << "  Live Controls: [SPACE] Play/Stop  [T] Tap Tempo  [+] BPM+  [-] BPM-  [Q] Quit\n";
    std::cout << "\033[1;36m--------------------------------------------------------------------\033[0m\n\n";
}

#ifdef _WIN32
#include <io.h>
#endif

void TerminalUI::renderHud() {
    auto now = std::chrono::steady_clock::now();
#ifdef _WIN32
    bool is_console = (_isatty(_fileno(stdout)) != 0);
#else
    bool is_console = (isatty(fileno(stdout)) != 0);
#endif

    int interval_ms = is_console ? 100 : 3000;
    if (std::chrono::duration_cast<std::chrono::milliseconds>(now - last_render_tp_).count() < interval_ms) {
        return;
    }
    last_render_tp_ = now;

    std::ostringstream ss;
    if (is_console) {
        std::cout << "\033[s"; // Save cursor position
    }

    // Line 1: Transport & Clock
    bool playing = sync_engine_->isPlaying();
    double bpm = sync_engine_->getBpm();
    uint32_t beat = sync_engine_->getCurrentBeat();

    ss << "\r\033[K" // Clear line
       << "  \033[1mTRANSPORT:\033[0m "
       << (playing ? "\033[1;42;30m PLAYING \033[0m" : "\033[1;41;37m STOPPED \033[0m")
       << "  |  \033[1mBPM:\033[0m \033[1;33m" << std::fixed << std::setprecision(1) << bpm << "\033[0m"
       << "  |  \033[1mBEAT:\033[0m " << (beat % 4 + 1)
       << "  |  \033[1mMIDI OUT:\033[0m " << (midi_engine_->isWinMidiActive() ? "\033[1;32mWinMM Active\033[0m" : "\033[1;31mNone\033[0m")
       << "\n";

    // Line 2: Virtual MIDI Status & Throughput
    ss << "\033[K"
       << "  \033[1mVIRTUAL MIDI:\033[0m ";
    if (midi_engine_->isVirtualPortActive()) {
        ss << "\033[1;32mACTIVE (" << midi_engine_->getVirtualPortName() << ")\033[0m";
    } else if (midi_engine_->isWinMidiActive()) {
        ss << "\033[1;33mFALLBACK (" << midi_engine_->getActiveWinMidiPortName() << ")\033[0m";
    } else {
        ss << "\033[1;31mINACTIVE\033[0m";
    }
    ss << "  |  \033[1mMSGS/SEC:\033[0m " << static_cast<int>(midi_engine_->getMessagesPerSecond())
       << "  |  \033[1mLAST EVENT:\033[0m \033[1;36m" << midi_engine_->getLastEventDescription() << "\033[0m\n";

    // Line 3: Connected Performer Devices Summary
    auto sessions = session_mgr_->getAllSessions();
    ss << "\033[K"
       << "  \033[1mPERFORMER CLIENTS (" << sessions.size() << " Connected):\033[0m\n";

    if (sessions.empty()) {
        ss << "\033[K    \033[90m(Waiting for devices to open " << primary_url_ << "...)\033[0m\n";
    } else {
        for (const auto& s : sessions) {
            ss << "\033[K    • \033[1;37m" << (s.device_name.empty() ? s.device_id : s.device_name) << "\033[0m"
               << " [" << roleToString(s.role) << "]"
               << " | IP: " << s.ip_address
               << " | Latency RTT: \033[1;32m" << std::fixed << std::setprecision(1) << s.rtt_ms << " ms\033[0m"
               << " | Offset: " << s.clock_offset_ms << " ms\n";
        }
    }

    if (is_console) {
        std::cout << ss.str() << "\033[u" << std::flush; // Restore cursor position
    } else {
        std::cout << ss.str() << std::flush;
    }
}

bool TerminalUI::processInput() {
#ifdef _WIN32
    while (_kbhit()) {
        int ch = _getch();
        if (ch == 'q' || ch == 'Q' || ch == 27) { // 'q' or ESC
            return false;
        } else if (ch == ' ') {
            sync_engine_->togglePlay();
        } else if (ch == 't' || ch == 'T') {
            sync_engine_->registerTapTempo();
        } else if (ch == '+' || ch == '=') {
            sync_engine_->adjustBpm(1.0);
        } else if (ch == '-' || ch == '_') {
            sync_engine_->adjustBpm(-1.0);
        }
    }
#endif
    return true;
}

} // namespace vlive::ui
