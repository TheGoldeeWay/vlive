#include "src/network/http_server.hpp"
#include "src/network/embedded_assets.hpp"
#include <iostream>
#include <fstream>
#include <sstream>
#include <vector>
#include "src/ui/terminal_ui.hpp"

namespace vlive::net {

static std::string getMimeType(const std::string& path) {
    if (path.ends_with(".html") || path.ends_with(".htm")) return "text/html; charset=utf-8";
    if (path.ends_with(".css")) return "text/css; charset=utf-8";
    if (path.ends_with(".js")) return "application/javascript; charset=utf-8";
    if (path.ends_with(".json") || path.ends_with(".manifest")) return "application/json";
    if (path.ends_with(".svg")) return "image/svg+xml";
    if (path.ends_with(".png")) return "image/png";
    if (path.ends_with(".ico")) return "image/x-icon";
    return "application/octet-stream";
}

HttpServer::HttpServer(uint16_t port, std::string web_root)
    : port_(port), web_root_(std::move(web_root)) {}

HttpServer::~HttpServer() {
    stop();
}

bool HttpServer::start() {
    stop();

    uint16_t try_port = port_;
    const int max_retries = 25;
    bool bound = false;

    for (int retry = 0; retry < max_retries; ++retry) {
        listen_sock_ = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (listen_sock_ == INVALID_SOCKET) {
            return false;
        }

        int opt = 1;
        setsockopt(listen_sock_, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&opt), sizeof(opt));

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = INADDR_ANY;
        addr.sin_port = htons(try_port);

        if (bind(listen_sock_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != SOCKET_ERROR) {
            if (listen(listen_sock_, SOMAXCONN) != SOCKET_ERROR) {
                bound = true;
                port_ = try_port;
                break;
            }
        }

        closesocket(listen_sock_);
        listen_sock_ = INVALID_SOCKET;
        try_port++;
    }

    if (!bound) {
        return false;
    }

    is_running_ = true;
    should_stop_ = false;
    server_thread_ = std::thread(&HttpServer::serverLoop, this);
    return true;
}

void HttpServer::stop() {
    should_stop_ = true;
    is_running_ = false;

    if (listen_sock_ != INVALID_SOCKET) {
        closesocket(listen_sock_);
        listen_sock_ = INVALID_SOCKET;
    }

    if (server_thread_.joinable()) {
        server_thread_.join();
    }
}

void HttpServer::setWebSocketUpgradeCallback(WebSocketUpgradeCallback cb) {
    ws_upgrade_cb_ = std::move(cb);
}

void HttpServer::setPrimaryUrl(const std::string& url) {
    primary_url_ = url;
}

void HttpServer::setApiInfoProvider(std::function<std::string()> provider) {
    api_info_provider_ = std::move(provider);
}

void HttpServer::setPortsListProvider(std::function<std::string()> provider) {
    ports_list_provider_ = std::move(provider);
}

void HttpServer::setPortConnectHandler(std::function<std::string(const std::string&)> handler) {
    port_connect_handler_ = std::move(handler);
}

void HttpServer::setTestNoteHandler(std::function<std::string()> handler) {
    test_note_handler_ = std::move(handler);
}

void HttpServer::setStartDriverHandler(std::function<std::string()> handler) {
    start_driver_handler_ = std::move(handler);
}

uint16_t HttpServer::getPort() const noexcept {
    return port_;
}

bool HttpServer::isRunning() const noexcept {
    return is_running_.load();
}

void HttpServer::serverLoop() {
    while (!should_stop_) {
        sockaddr_in client_addr{};
        int client_len = sizeof(client_addr);
        SOCKET client_sock = accept(listen_sock_, reinterpret_cast<sockaddr*>(&client_addr), &client_len);

        if (client_sock == INVALID_SOCKET) {
            if (should_stop_) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            continue;
        }

        // Enable TCP_NODELAY immediately for low latency
        setTcpNoDelay(client_sock);

        char ip_str[INET_ADDRSTRLEN];
        inet_ntop(AF_INET, &client_addr.sin_addr, ip_str, INET_ADDRSTRLEN);
        std::string client_ip(ip_str);

        // Detach handling to keep accepting connections
        std::thread([this, client_sock, client_ip]() {
            handleClient(client_sock, client_ip);
        }).detach();
    }
}

void HttpServer::handleClient(SOCKET client_sock, const std::string& client_ip) {
    char buffer[4096];
    int bytes = recv(client_sock, buffer, sizeof(buffer) - 1, 0);
    if (bytes <= 0) {
        closesocket(client_sock);
        return;
    }
    buffer[bytes] = '\0';
    std::string request(buffer, bytes);

    std::istringstream stream(request);
    std::string method, path, version;
    stream >> method >> path >> version;

    // Check for WebSocket Upgrade
    std::string line;
    bool is_ws_upgrade = false;
    std::string ws_key;

    while (std::getline(stream, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.rfind("Upgrade:", 0) == 0 || line.rfind("upgrade:", 0) == 0) {
            if (line.find("websocket") != std::string::npos || line.find("Websocket") != std::string::npos) {
                is_ws_upgrade = true;
            }
        }
        if (line.rfind("Sec-WebSocket-Key:", 0) == 0 || line.rfind("sec-websocket-key:", 0) == 0) {
            size_t colon = line.find(':');
            if (colon != std::string::npos) {
                ws_key = line.substr(colon + 1);
                // Trim leading whitespace
                size_t first = ws_key.find_first_not_of(" \t");
                if (first != std::string::npos) ws_key = ws_key.substr(first);
            }
        }
    }

    if (is_ws_upgrade && !ws_key.empty() && ws_upgrade_cb_) {
        // Delegate socket ownership to WebSocket server
        ws_upgrade_cb_(client_sock, ws_key, client_ip);
        return;
    }

    // Regular HTTP API & static file serving
    if (method == "GET") {
        std::string clean_path = path;
        size_t qpos = clean_path.find('?');
        if (qpos != std::string::npos) {
            clean_path = clean_path.substr(0, qpos);
        }

        if (clean_path == "/api/qr") {
            std::string target = primary_url_.empty() ? ("http://127.0.0.1:" + std::to_string(port_)) : primary_url_;
            size_t u_pos = path.find("url=");
            if (u_pos != std::string::npos) {
                std::string custom_url = path.substr(u_pos + 4);
                size_t amp = custom_url.find('&');
                if (amp != std::string::npos) custom_url = custom_url.substr(0, amp);
                
                // Decode URL percent-encoding (e.g. %3A -> :, %2F -> /)
                std::string decoded;
                decoded.reserve(custom_url.size());
                for (size_t i = 0; i < custom_url.size(); ++i) {
                    if (custom_url[i] == '%' && i + 2 < custom_url.size()) {
                        auto hexVal = [](char c) -> int {
                            if (c >= '0' && c <= '9') return c - '0';
                            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
                            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
                            return -1;
                        };
                        int v1 = hexVal(custom_url[i + 1]);
                        int v2 = hexVal(custom_url[i + 2]);
                        if (v1 >= 0 && v2 >= 0) {
                            decoded.push_back(static_cast<char>((v1 << 4) | v2));
                            i += 2;
                            continue;
                        }
                    } else if (custom_url[i] == '+') {
                        decoded.push_back(' ');
                        continue;
                    }
                    decoded.push_back(custom_url[i]);
                }

                if (!decoded.empty()) target = decoded;
            }

            std::string svg = vlive::ui::TerminalUI::generateQrSvg(target);
            std::ostringstream header;
            header << "HTTP/1.1 200 OK\r\n"
                   << "Content-Type: image/svg+xml\r\n"
                   << "Content-Length: " << svg.size() << "\r\n"
                   << "Access-Control-Allow-Origin: *\r\n"
                   << "Cache-Control: no-cache, no-store, must-revalidate\r\n"
                   << "Connection: close\r\n\r\n";
            std::string h = header.str();
            send(client_sock, h.c_str(), static_cast<int>(h.size()), 0);
            send(client_sock, svg.c_str(), static_cast<int>(svg.size()), 0);
            shutdown(client_sock, SD_SEND);
            closesocket(client_sock);
            return;
        } else if (clean_path == "/api/info") {
            std::string info = api_info_provider_ ? api_info_provider_() : "{}";
            std::ostringstream header;
            header << "HTTP/1.1 200 OK\r\n"
                   << "Content-Type: application/json\r\n"
                   << "Content-Length: " << info.size() << "\r\n"
                   << "Access-Control-Allow-Origin: *\r\n"
                   << "Connection: close\r\n\r\n";
            std::string h = header.str();
            send(client_sock, h.c_str(), static_cast<int>(h.size()), 0);
            send(client_sock, info.c_str(), static_cast<int>(info.size()), 0);
            shutdown(client_sock, SD_SEND);
            closesocket(client_sock);
            return;
        } else if (clean_path == "/api/ports") {
            std::string ports = ports_list_provider_ ? ports_list_provider_() : "{\"ports\":[]}";
            std::ostringstream header;
            header << "HTTP/1.1 200 OK\r\n"
                   << "Content-Type: application/json\r\n"
                   << "Content-Length: " << ports.size() << "\r\n"
                   << "Access-Control-Allow-Origin: *\r\n"
                   << "Connection: close\r\n\r\n";
            std::string h = header.str();
            send(client_sock, h.c_str(), static_cast<int>(h.size()), 0);
            send(client_sock, ports.c_str(), static_cast<int>(ports.size()), 0);
            shutdown(client_sock, SD_SEND);
            closesocket(client_sock);
            return;
        } else if (clean_path == "/api/test_note") {
            std::string res = test_note_handler_ ? test_note_handler_() : "{\"status\":\"ok\"}";
            std::ostringstream header;
            header << "HTTP/1.1 200 OK\r\n"
                   << "Content-Type: application/json\r\n"
                   << "Content-Length: " << res.size() << "\r\n"
                   << "Access-Control-Allow-Origin: *\r\n"
                   << "Connection: close\r\n\r\n";
            std::string h = header.str();
            send(client_sock, h.c_str(), static_cast<int>(h.size()), 0);
            send(client_sock, res.c_str(), static_cast<int>(res.size()), 0);
            shutdown(client_sock, SD_SEND);
            closesocket(client_sock);
            return;
        } else if (clean_path.rfind("/api/connect_port", 0) == 0) {
            std::string target_port = "";
            size_t q = path.find("port=");
            if (q != std::string::npos) {
                target_port = path.substr(q + 5);
                size_t amp = target_port.find('&');
                if (amp != std::string::npos) target_port = target_port.substr(0, amp);
            }
            std::string result = port_connect_handler_ ? port_connect_handler_(target_port) : "{\"status\":\"error\"}";
            std::ostringstream header;
            header << "HTTP/1.1 200 OK\r\n"
                   << "Content-Type: application/json\r\n"
                   << "Content-Length: " << result.size() << "\r\n"
                   << "Access-Control-Allow-Origin: *\r\n"
                   << "Connection: close\r\n\r\n";
            std::string h = header.str();
            send(client_sock, h.c_str(), static_cast<int>(h.size()), 0);
            send(client_sock, result.c_str(), static_cast<int>(result.size()), 0);
            shutdown(client_sock, SD_SEND);
            closesocket(client_sock);
            return;
        } else if (clean_path == "/api/start_driver" || clean_path == "/api/midi/start-driver") {
            std::string result = start_driver_handler_ ? start_driver_handler_() : "{\"status\":\"error\"}";
            std::ostringstream header;
            header << "HTTP/1.1 200 OK\r\n"
                   << "Content-Type: application/json\r\n"
                   << "Content-Length: " << result.size() << "\r\n"
                   << "Access-Control-Allow-Origin: *\r\n"
                   << "Connection: close\r\n\r\n";
            std::string h = header.str();
            send(client_sock, h.c_str(), static_cast<int>(h.size()), 0);
            send(client_sock, result.c_str(), static_cast<int>(result.size()), 0);
            shutdown(client_sock, SD_SEND);
            closesocket(client_sock);
            return;
        }

        if (clean_path == "/" || clean_path.empty()) {
            clean_path = "/index.html";
        }
        serveStaticFile(client_sock, clean_path);
    } else if (method == "OPTIONS") {
        std::ostringstream header;
        header << "HTTP/1.1 204 No Content\r\n"
               << "Access-Control-Allow-Origin: *\r\n"
               << "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
               << "Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With\r\n"
               << "Access-Control-Max-Age: 86400\r\n"
               << "Content-Length: 0\r\n"
               << "Connection: close\r\n\r\n";
        std::string h = header.str();
        send(client_sock, h.c_str(), static_cast<int>(h.size()), 0);
        shutdown(client_sock, SD_SEND);
        closesocket(client_sock);
    } else {
        std::string resp = "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n";
        send(client_sock, resp.c_str(), static_cast<int>(resp.size()), 0);
        closesocket(client_sock);
    }
}

#include "src/network/embedded_assets.hpp"

bool HttpServer::serveStaticFile(SOCKET client_sock, const std::string& path) {
    std::string safe_path = path;
    // Strip query parameters
    size_t qmark = safe_path.find('?');
    if (qmark != std::string::npos) {
        safe_path = safe_path.substr(0, qmark);
    }
    if (safe_path == "/" || safe_path.empty()) {
        safe_path = "/index.html";
    }

    // Prevent directory traversal
    if (safe_path.find("..") != std::string::npos) {
        std::string err = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n";
        send(client_sock, err.c_str(), static_cast<int>(err.size()), 0);
        closesocket(client_sock);
        return false;
    }

    // 1. Try disk candidate paths (enables live development editing when files exist on disk)
    std::string exe_web_path;
#ifdef _WIN32
    wchar_t exePath[MAX_PATH];
    if (GetModuleFileNameW(NULL, exePath, MAX_PATH) > 0) {
        std::filesystem::path p(exePath);
        std::string exe_dir = p.parent_path().string();
        exe_web_path = exe_dir + "/web" + safe_path;
    }
#endif

    std::string candidates[] = {
        web_root_ + safe_path,
        exe_web_path,
        "web" + safe_path,
        "../web" + safe_path,
        "../../web" + safe_path
    };

    std::ifstream file;
    for (const auto& c : candidates) {
        if (!c.empty()) {
            file.open(c, std::ios::binary | std::ios::ate);
            if (file.is_open()) break;
        }
    }

    if (file.is_open()) {
        std::streamsize size = file.tellg();
        file.seekg(0, std::ios::beg);

        std::vector<char> content(static_cast<size_t>(size));
        if (file.read(content.data(), size)) {
            std::string mime = getMimeType(safe_path);
            std::ostringstream header;
            header << "HTTP/1.1 200 OK\r\n"
                   << "Content-Type: " << mime << "\r\n"
                   << "Content-Length: " << size << "\r\n"
                   << "Connection: close\r\n"
                   << "Access-Control-Allow-Origin: *\r\n";
            if (safe_path.ends_with(".otf") || safe_path.ends_with(".png") || safe_path.ends_with(".ico") || safe_path.ends_with(".svg")) {
                header << "Cache-Control: public, max-age=86400\r\n";
            } else {
                header << "Cache-Control: no-cache, must-revalidate\r\n";
            }
            header << "\r\n";

            std::string h = header.str();
            std::vector<char> response;
            response.reserve(h.size() + content.size());
            response.insert(response.end(), h.begin(), h.end());
            response.insert(response.end(), content.begin(), content.end());

            size_t total_sent = 0;
            while (total_sent < response.size()) {
                int s = send(client_sock, response.data() + total_sent, static_cast<int>(response.size() - total_sent), 0);
                if (s <= 0) break;
                total_sent += s;
            }

            shutdown(client_sock, SD_SEND);
            closesocket(client_sock);
            return true;
        }
    }

    // 2. In-Memory Embedded Asset Serving (Self-Contained Executable Guarantee)
    const auto* embedded = findEmbeddedAsset(safe_path);
    if (embedded && embedded->data && embedded->size > 0) {
        std::ostringstream header;
        header << "HTTP/1.1 200 OK\r\n"
               << "Content-Type: " << embedded->mime_type << "\r\n"
               << "Content-Length: " << embedded->size << "\r\n"
               << "Connection: close\r\n"
               << "Access-Control-Allow-Origin: *\r\n";
        if (safe_path.ends_with(".otf") || safe_path.ends_with(".png") || safe_path.ends_with(".ico") || safe_path.ends_with(".svg")) {
            header << "Cache-Control: public, max-age=86400\r\n";
        } else {
            header << "Cache-Control: no-cache, must-revalidate\r\n";
        }
        header << "\r\n";

        std::string h = header.str();
        ::send(client_sock, h.c_str(), static_cast<int>(h.size()), 0);

        size_t total_sent = 0;
        while (total_sent < embedded->size) {
            int to_send = static_cast<int>(std::min<size_t>(embedded->size - total_sent, 65536));
            int s = ::send(client_sock, reinterpret_cast<const char*>(embedded->data + total_sent), to_send, 0);
            if (s <= 0) break;
            total_sent += s;
        }

        shutdown(client_sock, SD_SEND);
        closesocket(client_sock);
        return true;
    }

    // 3. Fallback: Not found
    std::string not_found = "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 13\r\nConnection: close\r\n\r\n404 Not Found";
    send(client_sock, not_found.c_str(), static_cast<int>(not_found.size()), 0);
    shutdown(client_sock, SD_SEND);
    closesocket(client_sock);
    return false;
}

} // namespace vlive::net
