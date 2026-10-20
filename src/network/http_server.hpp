#pragma once

#include <string>
#include <memory>
#include <atomic>
#include <thread>
#include <functional>
#include "src/network/socket_utils.hpp"

namespace vlive::net {

class HttpServer {
public:
    using WebSocketUpgradeCallback = std::function<void(SOCKET client_sock, const std::string& ws_key, const std::string& client_ip)>;

    explicit HttpServer(uint16_t port, std::string web_root);
    ~HttpServer();

    bool start();
    void stop();

    void setWebSocketUpgradeCallback(WebSocketUpgradeCallback cb);
    void setPrimaryUrl(const std::string& url);
    void setApiInfoProvider(std::function<std::string()> provider);
    void setPortsListProvider(std::function<std::string()> provider);
    void setPortConnectHandler(std::function<std::string(const std::string&)> handler);
    void setTestNoteHandler(std::function<std::string()> handler);
    void setStartDriverHandler(std::function<std::string()> handler);
    [[nodiscard]] uint16_t getPort() const noexcept;
    [[nodiscard]] bool isRunning() const noexcept;

private:
    void serverLoop();
    void handleClient(SOCKET client_sock, const std::string& client_ip);
    bool serveStaticFile(SOCKET client_sock, const std::string& path);

    uint16_t port_{8080};
    std::string web_root_;
    std::atomic<bool> is_running_{false};
    std::atomic<bool> should_stop_{false};

    SOCKET listen_sock_{INVALID_SOCKET};
    std::thread server_thread_;
    WebSocketUpgradeCallback ws_upgrade_cb_;
    std::string primary_url_;
    std::function<std::string()> api_info_provider_;
    std::function<std::string()> ports_list_provider_;
    std::function<std::string(const std::string&)> port_connect_handler_;
    std::function<std::string()> test_note_handler_;
    std::function<std::string()> start_driver_handler_;
};

} // namespace vlive::net
