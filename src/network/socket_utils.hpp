#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <cstring>
#include <sstream>
#include <algorithm>
#include <cctype>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "iphlpapi.lib")
#else
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <unistd.h>
#include <fcntl.h>
#define SOCKET int
#define INVALID_SOCKET (-1)
#define SOCKET_ERROR (-1)
#define closesocket close
#endif

namespace vlive::net {

class WinsockScope {
public:
    WinsockScope() {
#ifdef _WIN32
        WSADATA wsaData;
        WSAStartup(MAKEWORD(2, 2), &wsaData);
#endif
    }
    ~WinsockScope() {
#ifdef _WIN32
        WSACleanup();
#endif
    }
};

inline bool setNonBlocking(SOCKET sock) {
#ifdef _WIN32
    u_long mode = 1;
    return ioctlsocket(sock, FIONBIO, &mode) == 0;
#else
    int flags = fcntl(sock, F_GETFL, 0);
    if (flags < 0) return false;
    return fcntl(sock, F_SETFL, flags | O_NONBLOCK) == 0;
#endif
}

inline bool setTcpNoDelay(SOCKET sock) {
    int flag = 1;
    return setsockopt(sock, IPPROTO_TCP, TCP_NODELAY, reinterpret_cast<const char*>(&flag), sizeof(flag)) == 0;
}

struct NetworkAdapterInfo {
    std::string ip;
    std::string friendly_name;
    std::string description;
    bool is_wifi = false;
    bool is_virtual = false;
    bool has_gateway = false;
    int priority = 0;
};

inline std::vector<NetworkAdapterInfo> getNetworkAdapters() {
    std::vector<NetworkAdapterInfo> adapters;
#ifdef _WIN32
    ULONG bufLen = 15000;
    std::vector<uint8_t> buffer(bufLen);
    PIP_ADAPTER_ADDRESSES addresses = reinterpret_cast<PIP_ADAPTER_ADDRESSES>(buffer.data());

    ULONG flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER | GAA_FLAG_INCLUDE_GATEWAYS;
    if (GetAdaptersAddresses(AF_INET, flags, nullptr, addresses, &bufLen) == ERROR_BUFFER_OVERFLOW) {
        buffer.resize(bufLen);
        addresses = reinterpret_cast<PIP_ADAPTER_ADDRESSES>(buffer.data());
    }

    auto toLower = [](const std::wstring& w) -> std::string {
        std::string s;
        s.reserve(w.size());
        for (wchar_t c : w) {
            s.push_back(static_cast<char>(std::tolower(c)));
        }
        return s;
    };

    auto toUtf8 = [](const std::wstring& w) -> std::string {
        if (w.empty()) return "";
        int len = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, nullptr, 0, nullptr, nullptr);
        if (len <= 0) return "";
        std::string res(len - 1, 0);
        WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, &res[0], len, nullptr, nullptr);
        return res;
    };

    if (GetAdaptersAddresses(AF_INET, flags, nullptr, addresses, &bufLen) == NO_ERROR) {
        for (PIP_ADAPTER_ADDRESSES curr = addresses; curr != nullptr; curr = curr->Next) {
            if (curr->OperStatus != IfOperStatusUp) continue;

            std::wstring wDesc = curr->Description ? curr->Description : L"";
            std::wstring wName = curr->FriendlyName ? curr->FriendlyName : L"";
            std::string descLower = toLower(wDesc);
            std::string nameLower = toLower(wName);

            bool is_virtual = (descLower.find("virtual") != std::string::npos ||
                               descLower.find("host-only") != std::string::npos ||
                               descLower.find("vmware") != std::string::npos ||
                               descLower.find("vethernet") != std::string::npos ||
                               descLower.find("wsl") != std::string::npos ||
                               descLower.find("tap-") != std::string::npos ||
                               descLower.find("tunnel") != std::string::npos ||
                               descLower.find("loopback") != std::string::npos ||
                               nameLower.find("virtualbox") != std::string::npos ||
                               nameLower.find("nordlynx") != std::string::npos ||
                               nameLower.find("vpn") != std::string::npos);

            bool is_wifi = (curr->IfType == 71 /* IF_TYPE_IEEE80211 */ ||
                            descLower.find("wi-fi") != std::string::npos ||
                            descLower.find("wifi") != std::string::npos ||
                            descLower.find("wireless") != std::string::npos ||
                            descLower.find("802.11") != std::string::npos ||
                            nameLower.find("wi-fi") != std::string::npos ||
                            nameLower.find("wifi") != std::string::npos ||
                            nameLower.find("hotspot") != std::string::npos);

            bool has_gw = (curr->FirstGatewayAddress != nullptr);

            for (PIP_ADAPTER_UNICAST_ADDRESS uni = curr->FirstUnicastAddress; uni != nullptr; uni = uni->Next) {
                if (uni->Address.lpSockaddr->sa_family == AF_INET) {
                    char ipStr[INET_ADDRSTRLEN];
                    sockaddr_in* sa_in = reinterpret_cast<sockaddr_in*>(uni->Address.lpSockaddr);
                    inet_ntop(AF_INET, &(sa_in->sin_addr), ipStr, INET_ADDRSTRLEN);
                    std::string ip(ipStr);

                    // Skip loopback and APIPA autoconfig (169.254.x.x)
                    if (ip == "127.0.0.1" || ip.rfind("169.254.", 0) == 0) continue;

                    NetworkAdapterInfo info;
                    info.ip = ip;
                    info.friendly_name = toUtf8(wName);
                    info.description = toUtf8(wDesc);
                    info.is_wifi = is_wifi;
                    info.is_virtual = is_virtual;
                    info.has_gateway = has_gw;

                    // Scoring priority:
                    int score = 0;
                    if (is_virtual) {
                        score -= 500; // Deprioritize virtual adapters (VirtualBox, etc.)
                    } else {
                        if (is_wifi) score += 200; // Prefer Wi-Fi / Hotspot
                        if (has_gw) score += 100; // Prefer active internet / router route
                        if (ip.rfind("192.168.137.", 0) == 0) score += 250; // Windows Mobile Hotspot IP
                        if (ip.rfind("10.", 0) == 0 || ip.rfind("192.168.", 0) == 0 || ip.rfind("172.", 0) == 0) score += 20;
                    }

                    info.priority = score;
                    adapters.push_back(info);
                }
            }
        }
    }

    // Sort descending by priority
    std::sort(adapters.begin(), adapters.end(), [](const NetworkAdapterInfo& a, const NetworkAdapterInfo& b) {
        return a.priority > b.priority;
    });
#endif
    return adapters;
}

inline std::vector<std::string> getLocalIpAddresses() {
    auto adapters = getNetworkAdapters();
    std::vector<std::string> ips;
    for (const auto& a : adapters) {
        ips.push_back(a.ip);
    }
    if (ips.empty()) {
        ips.push_back("127.0.0.1");
    }
    return ips;
}

// Compact Self-Contained SHA-1 Implementation for WebSocket RFC 6455 Handshake
namespace sha1 {
    struct Context {
        uint32_t state[5];
        uint32_t count[2];
        uint8_t buffer[64];
    };

    inline uint32_t rol(uint32_t value, size_t bits) {
        return (value << bits) | (value >> (32 - bits));
    }

    inline void transform(uint32_t state[5], const uint8_t buffer[64]) {
        uint32_t a = state[0], b = state[1], c = state[2], d = state[3], e = state[4];
        uint32_t w[80];

        for (int i = 0; i < 16; i++) {
            w[i] = (static_cast<uint32_t>(buffer[i * 4]) << 24) |
                   (static_cast<uint32_t>(buffer[i * 4 + 1]) << 16) |
                   (static_cast<uint32_t>(buffer[i * 4 + 2]) << 8) |
                   (static_cast<uint32_t>(buffer[i * 4 + 3]));
        }
        for (int i = 16; i < 80; i++) {
            w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        }

        for (int i = 0; i < 80; i++) {
            uint32_t f, k;
            if (i < 20) {
                f = (b & c) | ((~b) & d);
                k = 0x5A827999;
            } else if (i < 40) {
                f = b ^ c ^ d;
                k = 0x6ED9EBA1;
            } else if (i < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8F1BBCDC;
            } else {
                f = b ^ c ^ d;
                k = 0xCA62C1D6;
            }
            uint32_t temp = rol(a, 5) + f + e + k + w[i];
            e = d;
            d = c;
            c = rol(b, 30);
            b = a;
            a = temp;
        }

        state[0] += a;
        state[1] += b;
        state[2] += c;
        state[3] += d;
        state[4] += e;
    }

    inline void init(Context& ctx) {
        ctx.state[0] = 0x67452301;
        ctx.state[1] = 0xEFCDAB89;
        ctx.state[2] = 0x98BADCFE;
        ctx.state[3] = 0x10325476;
        ctx.state[4] = 0xC3D2E1F0;
        ctx.count[0] = ctx.count[1] = 0;
    }

    inline void update(Context& ctx, const uint8_t* data, size_t len) {
        size_t i = 0, j = (ctx.count[0] >> 3) & 63;
        if ((ctx.count[0] += static_cast<uint32_t>(len << 3)) < static_cast<uint32_t>(len << 3)) {
            ctx.count[1]++;
        }
        ctx.count[1] += static_cast<uint32_t>(len >> 29);

        if ((j + len) > 63) {
            std::memcpy(&ctx.buffer[j], data, (i = 64 - j));
            transform(ctx.state, ctx.buffer);
            for (; i + 63 < len; i += 64) {
                transform(ctx.state, &data[i]);
            }
            j = 0;
        }
        std::memcpy(&ctx.buffer[j], &data[i], len - i);
    }

    inline void final(uint8_t digest[20], Context& ctx) {
        uint8_t finalcount[8];
        for (int i = 0; i < 8; i++) {
            finalcount[i] = static_cast<uint8_t>((ctx.count[(i >= 4 ? 0 : 1)] >> ((3 - (i & 3)) * 8)) & 255);
        }
        uint8_t c = 0200;
        update(ctx, &c, 1);
        while ((ctx.count[0] & 504) != 448) {
            c = 0000;
            update(ctx, &c, 1);
        }
        update(ctx, finalcount, 8);
        for (int i = 0; i < 20; i++) {
            digest[i] = static_cast<uint8_t>((ctx.state[i >> 2] >> ((3 - (i & 3)) * 8)) & 255);
        }
    }
} // namespace sha1

// Compact Base64 Encoding
inline std::string base64Encode(const uint8_t* data, size_t length) {
    static const char b64_chars[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string ret;
    int i = 0;
    uint8_t char_array_3[3];
    uint8_t char_array_4[4];

    while (length--) {
        char_array_3[i++] = *(data++);
        if (i == 3) {
            char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
            char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
            char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
            char_array_4[3] = char_array_3[2] & 0x3f;

            for (i = 0; i < 4; i++) ret += b64_chars[char_array_4[i]];
            i = 0;
        }
    }

    if (i) {
        for (int j = i; j < 3; j++) char_array_3[j] = '\0';
        char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
        char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
        char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);

        for (int j = 0; j < i + 1; j++) ret += b64_chars[char_array_4[j]];
        while ((i++ < 3)) ret += '=';
    }
    return ret;
}

inline std::string computeWebSocketAcceptKey(const std::string& client_key) {
    std::string concat = client_key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    uint8_t digest[20];
    sha1::Context ctx;
    sha1::init(ctx);
    sha1::update(ctx, reinterpret_cast<const uint8_t*>(concat.data()), concat.size());
    sha1::final(digest, ctx);
    return base64Encode(digest, 20);
}

} // namespace vlive::net
