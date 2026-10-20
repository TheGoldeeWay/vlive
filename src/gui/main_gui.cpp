/**
 * VLive — Native Windows GUI Application
 * Combines high-performance C++20 MIDI engine, hardware serial bridge,
 * multi-device Wi-Fi sync, and an embedded modern Stage Controller window.
 */

#include <windows.h>
#include <shellapi.h>
#include <dwmapi.h>
#include <shlobj.h>
#include <wrl.h>
#include <mmsystem.h>
#include <avrt.h>
#include <dbghelp.h>
#include <csignal>

#include <algorithm>
#include <string>
#include <vector>
#include <memory>
#include <thread>
#include <atomic>
#include <mutex>
#include <sstream>
#include <filesystem>
#include <iostream>
#include <fstream>
#include <functional>
#include <tlhelp32.h>

#include "third_party/webview2/build/native/include/WebView2.h"

#include "src/common/types.hpp"
#include "src/midi/midi_engine.hpp"
#include "src/sync/sync_engine.hpp"
#include "src/session/session_manager.hpp"
#include "src/network/socket_utils.hpp"
#include "src/network/http_server.hpp"
#include "src/network/websocket_server.hpp"

using namespace Microsoft::WRL;

// Application Logging (Rotating Black-Box Log in %LOCALAPPDATA%\VLive\logs\vlive.log)
static void logGui(const std::string& msg) {
    static std::mutex logMutex;
    std::lock_guard<std::mutex> lock(logMutex);

    wchar_t localAppData[MAX_PATH];
    std::string logPath = "vlive.log";
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, localAppData))) {
        char pathA[MAX_PATH];
        WideCharToMultiByte(CP_UTF8, 0, localAppData, -1, pathA, MAX_PATH, nullptr, nullptr);
        std::string dir = std::string(pathA) + "\\VLive\\logs";
        std::error_code ec;
        std::filesystem::create_directories(dir, ec);
        logPath = dir + "\\vlive.log";
    }

    // Automatic log rotation if file exceeds 5MB
    std::error_code ec;
    auto sz = std::filesystem::file_size(logPath, ec);
    if (!ec && sz > 5 * 1024 * 1024) {
        std::string rotated = logPath + ".1";
        std::filesystem::remove(rotated, ec);
        std::filesystem::rename(logPath, rotated, ec);
    }

    std::ofstream logFile(logPath, std::ios::out | std::ios::app);
    if (logFile.is_open()) {
        SYSTEMTIME st;
        GetLocalTime(&st);
        char timeBuf[64];
        snprintf(timeBuf, sizeof(timeBuf), "[%04d-%02d-%02d %02d:%02d:%02d.%03d] [PID %lu] ",
                 st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond, st.wMilliseconds, GetCurrentProcessId());
        logFile << timeBuf << msg << std::endl;
        logFile.flush();
    }
}

static void terminateStaleInstances() {
    DWORD currentPid = GetCurrentProcessId();
    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnap != INVALID_HANDLE_VALUE) {
        PROCESSENTRY32W pe;
        pe.dwSize = sizeof(pe);
        if (Process32FirstW(hSnap, &pe)) {
            do {
                if (_wcsicmp(pe.szExeFile, L"VLive.exe") == 0 && pe.th32ProcessID != currentPid) {
                    logGui("Terminating stale VLive process PID: " + std::to_string(pe.th32ProcessID));
                    HANDLE hProc = OpenProcess(PROCESS_TERMINATE, FALSE, pe.th32ProcessID);
                    if (hProc) {
                        TerminateProcess(hProc, 0);
                        CloseHandle(hProc);
                    }
                }
            } while (Process32NextW(hSnap, &pe));
        }
        CloseHandle(hSnap);
    }
}

// Application Constants
static const wchar_t CLASS_NAME[] = L"VLiveMainWindowClass";
static const wchar_t SINGLE_INSTANCE_MUTEX_GLOBAL[] = L"Global\\VLive_SingleInstance_Mutex_9823";
static const wchar_t SINGLE_INSTANCE_MUTEX_LOCAL[] = L"Local\\VLive_SingleInstance_Mutex_9823";

// System Tray Notification Messages & Commands
#define WM_TRAYICON (WM_USER + 101)
#define ID_TRAY_OPEN 2001
#define ID_TRAY_STATUS 2002
#define ID_TRAY_EXIT 2003

static NOTIFYICONDATAW g_nid = {};
static bool g_tray_installed = false;
static uint16_t g_http_port = 8088;

static void setupTrayIcon(HWND hWnd, HINSTANCE hInstance) {
    ZeroMemory(&g_nid, sizeof(g_nid));
    g_nid.cbSize = sizeof(NOTIFYICONDATAW);
    g_nid.hWnd = hWnd;
    g_nid.uID = 1;
    g_nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    g_nid.uCallbackMessage = WM_TRAYICON;
    g_nid.hIcon = LoadIconW(hInstance, MAKEINTRESOURCEW(101));
    if (!g_nid.hIcon) {
        g_nid.hIcon = LoadIconW(NULL, (LPCWSTR)IDI_APPLICATION);
    }
    wcscpy_s(g_nid.szTip, L"VLive MIDI Controller (Running in background)");
    Shell_NotifyIconW(NIM_ADD, &g_nid);
    g_tray_installed = true;
    logGui("System tray icon initialized.");
}

static void removeTrayIcon() {
    if (g_tray_installed) {
        Shell_NotifyIconW(NIM_DELETE, &g_nid);
        g_tray_installed = false;
        logGui("System tray icon removed.");
    }
}

static void showTrayBalloon(HWND hWnd, const wchar_t* title, const wchar_t* msg) {
    static bool s_balloonShown = false;
    if (s_balloonShown) return;
    s_balloonShown = true;

    NOTIFYICONDATAW nid = {};
    nid.cbSize = sizeof(NOTIFYICONDATAW);
    nid.hWnd = hWnd;
    nid.uID = 1;
    nid.uFlags = NIF_INFO;
    nid.dwInfoFlags = NIIF_INFO;
    wcscpy_s(nid.szInfoTitle, title);
    wcscpy_s(nid.szInfo, msg);
    Shell_NotifyIconW(NIM_MODIFY, &nid);
}

// Global Window & WebView2 State
static HWND g_hwnd = nullptr;
static ComPtr<ICoreWebView2Controller> g_webview_controller;
static ComPtr<ICoreWebView2> g_webview;
static std::atomic<bool> g_app_running{true};

// Global VLive Subsystems
static std::shared_ptr<vlive::MidiEngine> g_midi_engine;
static std::shared_ptr<vlive::SyncEngine> g_sync_engine;
static std::shared_ptr<vlive::SessionManager> g_session_mgr;
static std::shared_ptr<vlive::net::WebSocketServer> g_ws_server;
static std::unique_ptr<vlive::net::HttpServer> g_http_server;

// Locate web assets directory dynamically
static std::string resolveWebRoot() {
    wchar_t exePath[MAX_PATH];
    if (GetModuleFileNameW(NULL, exePath, MAX_PATH) > 0) {
        std::filesystem::path p(exePath);
        auto dir = p.parent_path();
        if (std::filesystem::exists(dir / "web" / "index.html")) {
            return (dir / "web").string();
        }
        if (std::filesystem::exists(dir.parent_path() / "web" / "index.html")) {
            return (dir.parent_path() / "web").string();
        }
        if (std::filesystem::exists(dir.parent_path().parent_path() / "web" / "index.html")) {
            return (dir.parent_path().parent_path() / "web").string();
        }
    }

    if (std::filesystem::exists("web/index.html")) return "web";
    if (std::filesystem::exists("../web/index.html")) return "../web";
    if (std::filesystem::exists("../../web/index.html")) return "../../web";

    return "web";
}

// Win32 Window Procedure
LRESULT CALLBACK WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_SIZE:
        if (g_webview_controller) {
            RECT bounds;
            GetClientRect(hWnd, &bounds);
            g_webview_controller->put_Bounds(bounds);
            g_webview_controller->put_IsVisible(TRUE);
        }
        return 0;

    case WM_GETMINMAXINFO: {
        LPMINMAXINFO lpMMI = (LPMINMAXINFO)lParam;
        lpMMI->ptMinTrackSize.x = 800;
        lpMMI->ptMinTrackSize.y = 600;
        return 0;
    }

    case WM_ERASEBKGND:
        // Dark background matching VLive theme (#08080c)
        return 1;

    case WM_CLOSE: {
        logGui("WndProc: WM_CLOSE received -> Minimizing to system tray background");
        ShowWindow(hWnd, SW_HIDE);
        showTrayBalloon(hWnd, L"VLive Running in Background", L"VLive is still active and listening for MIDI and Wi-Fi connections.\nClick or right-click this tray icon to open or exit.");
        return 0; // Keep application running in background!
    }

    case WM_TRAYICON: {
        if (lParam == WM_LBUTTONUP || lParam == WM_LBUTTONDBLCLK) {
            ShowWindow(hWnd, SW_SHOW);
            ShowWindow(hWnd, SW_RESTORE);
            SetForegroundWindow(hWnd);
        } else if (lParam == WM_RBUTTONUP || lParam == WM_CONTEXTMENU) {
            POINT pt;
            GetCursorPos(&pt);
            HMENU hMenu = CreatePopupMenu();
            if (hMenu) {
                AppendMenuW(hMenu, MF_STRING, ID_TRAY_OPEN, L"Open VLive Studio");
                AppendMenuW(hMenu, MF_SEPARATOR, 0, nullptr);
                std::wstring statusText = L"Status: Active on Port " + std::to_wstring(g_http_port);
                AppendMenuW(hMenu, MF_STRING | MF_DISABLED | MF_GRAYED, ID_TRAY_STATUS, statusText.c_str());
                AppendMenuW(hMenu, MF_SEPARATOR, 0, nullptr);
                AppendMenuW(hMenu, MF_STRING, ID_TRAY_EXIT, L"Exit VLive");

                SetMenuDefaultItem(hMenu, ID_TRAY_OPEN, FALSE);

                SetForegroundWindow(hWnd);
                TrackPopupMenu(hMenu, TPM_RIGHTBUTTON | TPM_BOTTOMALIGN, pt.x, pt.y, 0, hWnd, NULL);
                PostMessageW(hWnd, WM_NULL, 0, 0);
                DestroyMenu(hMenu);
            }
        }
        return 0;
    }

    case WM_COMMAND: {
        int wmId = LOWORD(wParam);
        if (wmId == ID_TRAY_OPEN) {
            ShowWindow(hWnd, SW_SHOW);
            ShowWindow(hWnd, SW_RESTORE);
            SetForegroundWindow(hWnd);
            return 0;
        } else if (wmId == ID_TRAY_EXIT) {
            logGui("Tray: Exit requested");
            if (g_midi_engine) g_midi_engine->closeVirtualPort();
            removeTrayIcon();
            g_app_running = false;
            DestroyWindow(hWnd);
            return 0;
        }
        break;
    }

    case WM_QUERYENDSESSION:
        return TRUE;

    case WM_ENDSESSION:
        if (wParam) {
            logGui("WM_ENDSESSION: System closing down. Releasing MIDI ports.");
            if (g_midi_engine) g_midi_engine->closeVirtualPort();
            removeTrayIcon();
            g_app_running = false;
            DestroyWindow(hWnd);
        }
        return 0;

    case WM_DESTROY:
        logGui("WndProc: WM_DESTROY received");
        if (g_midi_engine) g_midi_engine->closeVirtualPort();
        removeTrayIcon();
        g_app_running = false;
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProcW(hWnd, msg, wParam, lParam);
}

// Graceful Virtual MIDI Port Teardown
static void safeCleanupVirtualMidiPort() noexcept {
    try {
        if (g_midi_engine) {
            g_midi_engine->closeVirtualPort();
        }
    } catch (...) {}
}

static void handleTerminationSignal(int sig) {
    char buf[64];
    snprintf(buf, sizeof(buf), "Received signal %d. Shutting down safely...", sig);
    logGui(buf);
    safeCleanupVirtualMidiPort();
    _exit(0);
}

// Application Crash Filter with MiniDump Generation
static LONG WINAPI VLiveCrashFilter(EXCEPTION_POINTERS* pEx) {
    safeCleanupVirtualMidiPort();

    wchar_t localAppData[MAX_PATH];
    std::wstring dumpPath = L"vlive_crash.dmp";
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, localAppData))) {
        std::wstring dir = std::wstring(localAppData) + L"\\VLive\\logs";
        CreateDirectoryW((std::wstring(localAppData) + L"\\VLive").c_str(), NULL);
        CreateDirectoryW(dir.c_str(), NULL);

        SYSTEMTIME st;
        GetLocalTime(&st);
        wchar_t fname[128];
        swprintf_s(fname, L"\\vlive_crash_%04d%02d%02d_%02d%02d%02d.dmp",
                  st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond);
        dumpPath = dir + fname;
    }

    HANDLE hFile = CreateFileW(dumpPath.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr,
                               CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (hFile != INVALID_HANDLE_VALUE) {
        MINIDUMP_EXCEPTION_INFORMATION mdei;
        mdei.ThreadId = GetCurrentThreadId();
        mdei.ExceptionPointers = pEx;
        mdei.ClientPointers = FALSE;

        MiniDumpWriteDump(GetCurrentProcess(), GetCurrentProcessId(), hFile,
                          MiniDumpNormal, (pEx ? &mdei : nullptr), nullptr, nullptr);
        CloseHandle(hFile);
    }

    if (pEx && pEx->ExceptionRecord) {
        char buf[256];
        snprintf(buf, sizeof(buf), "CRITICAL: Crash at 0x%p (code 0x%08lX). Minidump written to %ls",
                 pEx->ExceptionRecord->ExceptionAddress, pEx->ExceptionRecord->ExceptionCode, dumpPath.c_str());
        logGui(buf);
    }
    return EXCEPTION_EXECUTE_HANDLER;
}

// Windows 11 EcoQoS / Power Throttling Bypass
static void disablePowerThrottling() {
    PROCESS_POWER_THROTTLING_STATE powerThrottling{};
    powerThrottling.Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION;
    powerThrottling.ControlMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION;
    powerThrottling.StateMask = 0; // Turn off efficiency mode / throttling
    if (SetProcessInformation(GetCurrentProcess(), ProcessPowerThrottling, &powerThrottling, sizeof(powerThrottling))) {
        logGui("Windows EcoQoS / Power Throttling disabled for process.");
    }
}

// Windows Firewall Auto-Registration Helper
static bool registerFirewallRulesElevated() {
    wchar_t exePath[MAX_PATH];
    if (GetModuleFileNameW(NULL, exePath, MAX_PATH) == 0) return false;

    logGui("Registering Windows Firewall rules across Private and Public profiles...");
    std::wstring cmdTcp = L"/c netsh advfirewall firewall add rule name=\"VLive MIDI Controller (TCP)\" dir=in action=allow program=\"" + std::wstring(exePath) + L"\" enable=yes profile=any protocol=TCP";
    std::wstring cmdUdp = L"/c netsh advfirewall firewall add rule name=\"VLive MIDI Controller (UDP)\" dir=in action=allow program=\"" + std::wstring(exePath) + L"\" enable=yes profile=any protocol=UDP";

    SHELLEXECUTEINFOW sei = { sizeof(sei) };
    sei.fMask = SEE_MASK_NOCLOSEPROCESS;
    sei.lpVerb = L"runas";
    sei.lpFile = L"cmd.exe";
    sei.lpParameters = cmdTcp.c_str();
    sei.nShow = SW_HIDE;
    if (ShellExecuteExW(&sei) && sei.hProcess) {
        WaitForSingleObject(sei.hProcess, 5000);
        CloseHandle(sei.hProcess);
    }

    sei.lpParameters = cmdUdp.c_str();
    if (ShellExecuteExW(&sei) && sei.hProcess) {
        WaitForSingleObject(sei.hProcess, 5000);
        CloseHandle(sei.hProcess);
    }
    return true;
}

// Entry Point
int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE /*hPrevInstance*/, PWSTR /*pCmdLine*/, int nCmdShow) {
    SetUnhandledExceptionFilter(VLiveCrashFilter);
    signal(SIGINT, handleTerminationSignal);
    signal(SIGTERM, handleTerminationSignal);

    logGui("=== wWinMain entry ===");

    // 0. Single Instance Enforcement with Global and Local Mutex Fallback
    HANDLE hMutex = CreateMutexW(nullptr, TRUE, SINGLE_INSTANCE_MUTEX_GLOBAL);
    if (!hMutex && GetLastError() == ERROR_ACCESS_DENIED) {
        hMutex = CreateMutexW(nullptr, TRUE, SINGLE_INSTANCE_MUTEX_LOCAL);
    }
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND existingHwnd = FindWindowW(CLASS_NAME, nullptr);
        if (existingHwnd) {
            logGui("Another instance detected with active window. Activating existing window.");
            ShowWindow(existingHwnd, SW_SHOW);
            ShowWindow(existingHwnd, SW_RESTORE);
            SetForegroundWindow(existingHwnd);
            if (hMutex) CloseHandle(hMutex);
            logGui("Exiting duplicate instance cleanly.");
            return 0; // Seamlessly hand off to existing instance
        }
        // If there is NO active window, the previous instance is stale/zombie!
        logGui("Mutex exists but NO active window found! Cleaning up stale instance...");
        terminateStaleInstances();
        std::this_thread::sleep_for(std::chrono::milliseconds(150));
        if (hMutex) CloseHandle(hMutex);
        hMutex = CreateMutexW(nullptr, TRUE, SINGLE_INSTANCE_MUTEX_GLOBAL);
    }

    // High-Resolution 1ms Kernel Timer Resolution for Real-Time Stage Dispatch
    timeBeginPeriod(1);

    // MMCSS Pro Audio Registration for Stage Low Latency
    DWORD taskIndex = 0;
    HANDLE hAvrt = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);
    if (hAvrt) {
        AvSetMmThreadPriority(hAvrt, AVRT_PRIORITY_CRITICAL);
        logGui("Main thread registered with Windows MMCSS (Pro Audio).");
    }

    // Disable Windows 11 EcoQoS Power Throttling
    disablePowerThrottling();

    // 1. Initialize Winsock & COM
    vlive::net::WinsockScope winsock_scope;
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
        logGui("FAILED to initialize COM: hr=" + std::to_string(hr));
        MessageBoxW(nullptr, L"Failed to initialize COM library.", L"VLive Error", MB_ICONERROR);
        return 1;
    }
    logGui("Winsock and COM initialized.");

    // 2. Parse command line arguments
    int argc = 0;
    LPWSTR* argvW = CommandLineToArgvW(GetCommandLineW(), &argc);
    uint16_t http_port = 8088;
    double initial_bpm = 120.0;
    std::string web_root = resolveWebRoot();

    if (argvW) {
        for (int i = 1; i < argc; ++i) {
            std::wstring warg = argvW[i];
            if (warg == L"--port" && i + 1 < argc) {
                http_port = static_cast<uint16_t>(_wtoi(argvW[++i]));
            } else if (warg == L"--bpm" && i + 1 < argc) {
                initial_bpm = _wtof(argvW[++i]);
            } else if (warg == L"--register-firewall") {
                registerFirewallRulesElevated();
                LocalFree(argvW);
                return 0;
            }
        }
        LocalFree(argvW);
    }
    logGui("Parsed arguments: port=" + std::to_string(http_port) + " root=" + web_root);

    std::vector<std::string> local_ips;
    try {
        logGui("Initializing core subsystems (Midi, Sync, Session)...");
        g_midi_engine = std::make_shared<vlive::MidiEngine>();
        logGui("Midi engine created.");
        g_sync_engine = std::make_shared<vlive::SyncEngine>();
        logGui("Sync engine created.");
        g_session_mgr = std::make_shared<vlive::SessionManager>();
        logGui("Session manager created.");

        g_sync_engine->setBpm(initial_bpm);
        g_session_mgr->setBpm(initial_bpm);
        logGui("Querying local IP addresses...");
        local_ips = vlive::net::getLocalIpAddresses();
        logGui("Found " + std::to_string(local_ips.size()) + " local IP(s)");
    } catch (const std::exception& ex) {
        logGui("EXCEPTION in subsystem init: " + std::string(ex.what()));
    } catch (...) {
        logGui("UNKNOWN EXCEPTION in subsystem init");
    }
    std::string primary_url = "http://" + (local_ips.empty() ? "127.0.0.1" : local_ips[0]) + ":" + std::to_string(http_port);

    g_ws_server = std::make_shared<vlive::net::WebSocketServer>(g_session_mgr, g_midi_engine, g_sync_engine);

    // Full-Duplex DAW bi-directional sync: Broadcast any MIDI incoming from DAW directly to all web/app clients
    g_midi_engine->setIncomingRawCallback([](const uint8_t* data, size_t length) {
        if (g_ws_server) {
            g_ws_server->broadcastBinary(data, length);
        }
    });

    g_http_server = std::make_unique<vlive::net::HttpServer>(http_port, web_root);
    g_http_server->setPrimaryUrl(primary_url);
    g_http_server->setApiInfoProvider([&]() {
        auto adapters = vlive::net::getNetworkAdapters();
        std::ostringstream ss;
        ss << "{\"status\":\"ok\""
           << ",\"version\":\"2.0.0\""
           << ",\"port\":" << http_port
           << ",\"lanIp\":\"" << (adapters.empty() ? "127.0.0.1" : adapters[0].ip) << "\""
           << ",\"bpm\":" << g_sync_engine->getBpm()
           << ",\"playing\":" << (g_sync_engine->isPlaying() ? "true" : "false")
           << ",\"virtual_midi_active\":" << (g_midi_engine->isVirtualPortActive() ? "true" : "false")
           << ",\"virtual_midi_name\":\"" << g_midi_engine->getVirtualPortName() << "\""
           << ",\"winmm_active\":" << (g_midi_engine->isWinMidiActive() ? "true" : "false")
           << ",\"winmm_port\":\"" << g_midi_engine->getActiveWinMidiPortName() << "\""
           << ",\"clients_count\":" << g_session_mgr->getClientCount()
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

    g_http_server->setPortsListProvider([&]() {
        auto ports = vlive::MidiEngine::enumerateWinMidiPorts();
        std::ostringstream ss;
        ss << "{\"active\":\"" << g_midi_engine->getActiveWinMidiPortName() << "\""
           << ",\"virtual_active\":" << (g_midi_engine->isVirtualPortActive() ? "true" : "false")
           << ",\"virtual_name\":\"" << g_midi_engine->getVirtualPortName() << "\""
           << ",\"ports\":[";
        for (size_t i = 0; i < ports.size(); ++i) {
            ss << "\"" << ports[i] << "\"" << (i + 1 < ports.size() ? "," : "");
        }
        ss << "]}";
        return ss.str();
    });

    g_http_server->setPortConnectHandler([&](const std::string& p) {
        bool ok = g_midi_engine->selectWinMidiPort(p);
        std::ostringstream ss;
        ss << "{\"status\":\"" << (ok ? "ok" : "error") << "\""
           << ",\"port\":\"" << g_midi_engine->getActiveWinMidiPortName() << "\""
           << ",\"connected\":" << (ok ? "true" : "false") << "}";
        return ss.str();
    });

    g_http_server->setTestNoteHandler([&]() {
        bool ok = g_midi_engine->sendTestNote(60, 110);
        return std::string("{\"status\":\"") + (ok ? "ok" : "error") + "\",\"note\":60}";
    });

    g_http_server->setStartDriverHandler([&]() {
        logGui("Received request to start/activate virtual MIDI driver subsystem...");
        bool ok = vlive::VirtualMidiPort::ensureDriverServiceStarted(true);
        if (ok) {
            g_midi_engine->ensureVirtualPortActive();
        }
        std::ostringstream ss;
        ss << "{\"status\":\"" << (g_midi_engine->isVirtualPortActive() ? "ok" : "error") << "\""
           << ",\"virtual_active\":" << (g_midi_engine->isVirtualPortActive() ? "true" : "false")
           << ",\"virtual_name\":\"" << g_midi_engine->getVirtualPortName() << "\"}";
        logGui("Virtual MIDI driver activation result: " + ss.str());
        return ss.str();
    });

    g_http_server->setWebSocketUpgradeCallback([&](SOCKET sock, const std::string& key, const std::string& ip) {
        g_ws_server->acceptConnection(sock, key, ip);
    });

    logGui("Starting HTTP server on port " + std::to_string(http_port) + " with web_root: " + web_root);
    if (!g_http_server->start()) {
        logGui("FAILED to start embedded HTTP server!");
        MessageBoxW(nullptr, L"Failed to start embedded HTTP server.\nPlease ensure ports 8088+ are available.", L"VLive Server Error", MB_ICONERROR);
        return 1;
    }
    logGui("Embedded HTTP server started successfully on port " + std::to_string(g_http_server->getPort()));

    http_port = g_http_server->getPort();
    primary_url = "http://" + (local_ips.empty() ? "127.0.0.1" : local_ips[0]) + ":" + std::to_string(http_port);
    g_http_server->setPrimaryUrl(primary_url);

    // 4. Connect Master Clock Sync Callback
    g_sync_engine->setClockCallback([](uint64_t /*tick*/, uint32_t /*beat*/, bool /*is_quarter*/) {
        g_midi_engine->sendClockTick();
        g_ws_server->broadcastClockTick();
    });

    logGui("Virtual MIDI Controller active: " + g_midi_engine->getVirtualPortName());

    // 6. Create Native Windows GUI Window
    logGui("Registering window class...");
    HICON hAppIcon = LoadIconW(hInstance, MAKEINTRESOURCEW(101));
    if (!hAppIcon) {
        hAppIcon = (HICON)LoadImageW(hInstance, MAKEINTRESOURCEW(101), IMAGE_ICON, 32, 32, LR_DEFAULTCOLOR);
    }
    HICON hAppIconSm = (HICON)LoadImageW(hInstance, MAKEINTRESOURCEW(101), IMAGE_ICON, 16, 16, LR_DEFAULTCOLOR);

    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(WNDCLASSEXW);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.hIcon = hAppIcon;
    wc.hIconSm = hAppIconSm ? hAppIconSm : hAppIcon;
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = CreateSolidBrush(RGB(8, 8, 12)); // Stage dark background
    wc.lpszClassName = CLASS_NAME;

    RegisterClassExW(&wc);

    // Calculate window centered on desktop
    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    int winW = std::min(1360, screenW - 80);
    int winH = std::min(880, screenH - 80);
    int winX = (screenW - winW) / 2;
    int winY = (screenH - winH) / 2;

    logGui("Creating window (" + std::to_string(winW) + "x" + std::to_string(winH) + ")...");
    g_hwnd = CreateWindowExW(
        0,
        CLASS_NAME,
        L"VLive — Stage MIDI Controller & Studio (Made by Goldee)",
        WS_OVERLAPPEDWINDOW,
        winX, winY, winW, winH,
        nullptr, nullptr, hInstance, nullptr
    );

    if (!g_hwnd) {
        logGui("FAILED to create window!");
        MessageBoxW(nullptr, L"Failed to create VLive application window.", L"VLive Error", MB_ICONERROR);
        return 1;
    }
    if (hAppIcon) SendMessageW(g_hwnd, WM_SETICON, ICON_BIG, (LPARAM)hAppIcon);
    if (hAppIconSm) SendMessageW(g_hwnd, WM_SETICON, ICON_SMALL, (LPARAM)hAppIconSm);
    logGui("Window created successfully.");

    // Modern Windows Dark Mode Title Bar
    BOOL useDarkMode = TRUE;
    DwmSetWindowAttribute(g_hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &useDarkMode, sizeof(useDarkMode));

    ShowWindow(g_hwnd, nCmdShow);
    UpdateWindow(g_hwnd);

    // Initialize System Tray Icon for continuous background operation
    g_http_port = http_port;
    setupTrayIcon(g_hwnd, hInstance);

    // 7. Initialize WebView2 inside the Window with Evergreen Bootstrapping & Runtime Check
    wchar_t localAppData[MAX_PATH];
    std::wstring userDataFolder = L"";
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, localAppData))) {
        userDataFolder = std::wstring(localAppData) + L"\\VLive\\WebView2";
        std::error_code ec;
        std::filesystem::create_directories(userDataFolder, ec);
    }

    std::wstring targetUrl = L"http://127.0.0.1:" + std::to_wstring(http_port) + L"/?v=" + std::to_wstring(GetTickCount64());

    auto wstrToStr = [](LPCWSTR w) -> std::string {
        if (!w) return "";
        int len = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
        if (len <= 0) return "";
        std::string s(len - 1, '\0');
        WideCharToMultiByte(CP_UTF8, 0, w, -1, &s[0], len, nullptr, nullptr);
        return s;
    };

    // Pre-flight check: Verify WebView2 Runtime availability on this OS
    LPWSTR webviewVersion = nullptr;
    HRESULT hrVer = GetAvailableCoreWebView2BrowserVersionString(nullptr, &webviewVersion);
    bool webviewAvailable = (SUCCEEDED(hrVer) && webviewVersion != nullptr && wcslen(webviewVersion) > 0);
    if (webviewVersion) {
        logGui("Detected CoreWebView2 Runtime Version: " + wstrToStr(webviewVersion));
        CoTaskMemFree(webviewVersion);
        webviewVersion = nullptr;
    }

    if (!webviewAvailable) {
        logGui("WebView2 Runtime is not detected. Checking for bundled Evergreen Bootstrapper...");
        wchar_t exePath[MAX_PATH];
        std::filesystem::path bootstrapperPath;
        if (GetModuleFileNameW(NULL, exePath, MAX_PATH) > 0) {
            auto baseDir = std::filesystem::path(exePath).parent_path();
            if (std::filesystem::exists(baseDir / "drivers" / "MicrosoftEdgeWebview2Setup.exe")) {
                bootstrapperPath = baseDir / "drivers" / "MicrosoftEdgeWebview2Setup.exe";
            } else if (std::filesystem::exists(baseDir / "MicrosoftEdgeWebview2Setup.exe")) {
                bootstrapperPath = baseDir / "MicrosoftEdgeWebview2Setup.exe";
            } else if (std::filesystem::exists(std::filesystem::current_path() / "drivers" / "MicrosoftEdgeWebview2Setup.exe")) {
                bootstrapperPath = std::filesystem::current_path() / "drivers" / "MicrosoftEdgeWebview2Setup.exe";
            }
        }

        if (!bootstrapperPath.empty()) {
            logGui("Launching bundled Evergreen Bootstrapper silently: " + bootstrapperPath.string());
            SHELLEXECUTEINFOW sei = { sizeof(sei) };
            sei.fMask = SEE_MASK_NOCLOSEPROCESS;
            sei.lpVerb = L"runas";
            sei.lpFile = bootstrapperPath.c_str();
            sei.lpParameters = L"/silent /install";
            sei.nShow = SW_HIDE;
            if (ShellExecuteExW(&sei) && sei.hProcess) {
                WaitForSingleObject(sei.hProcess, 35000);
                CloseHandle(sei.hProcess);
            }

            hrVer = GetAvailableCoreWebView2BrowserVersionString(nullptr, &webviewVersion);
            webviewAvailable = (SUCCEEDED(hrVer) && webviewVersion != nullptr && wcslen(webviewVersion) > 0);
            if (webviewVersion) {
                logGui("Post-install WebView2 Runtime Version: " + wstrToStr(webviewVersion));
                CoTaskMemFree(webviewVersion);
            }
        }
    }

    if (!webviewAvailable) {
        logGui("WebView2 unavailable or install bypassed. Falling back gracefully to system default browser...");
        ShellExecuteW(nullptr, L"open", targetUrl.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        showTrayBalloon(g_hwnd, L"VLive Studio Active", L"Opened VLive in default browser. System tray is active.");
    } else {
        auto configureController = [targetUrl](ICoreWebView2Controller* controller) {
            g_webview_controller = controller;
            g_webview_controller->get_CoreWebView2(&g_webview);

            if (g_webview) {
                ICoreWebView2Settings* settings = nullptr;
                g_webview->get_Settings(&settings);
                if (settings) {
                    settings->put_IsScriptEnabled(TRUE);
                    settings->put_AreDefaultScriptDialogsEnabled(TRUE);
                    settings->put_IsWebMessageEnabled(TRUE);
                    settings->put_IsStatusBarEnabled(FALSE);
                    settings->put_AreDevToolsEnabled(TRUE);
                }

                RECT bounds;
                GetClientRect(g_hwnd, &bounds);
                g_webview_controller->put_Bounds(bounds);
                g_webview_controller->put_IsVisible(TRUE);

                // Auto-retry navigation if server was slow to accept initial request
                EventRegistrationToken navToken;
                g_webview->add_NavigationCompleted(
                    Callback<ICoreWebView2NavigationCompletedEventHandler>(
                        [targetUrl](ICoreWebView2* sender, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                            BOOL isSuccess = FALSE;
                            args->get_IsSuccess(&isSuccess);
                            if (!isSuccess) {
                                std::thread([sender, targetUrl]() {
                                    std::this_thread::sleep_for(std::chrono::milliseconds(350));
                                    sender->Navigate(targetUrl.c_str());
                                }).detach();
                            }
                            return S_OK;
                        }).Get(), &navToken);

                g_webview->Navigate(targetUrl.c_str());
            }
        };

        auto tryFallbackEnvironment = [configureController, targetUrl]() {
            wchar_t tempPath[MAX_PATH];
            GetTempPathW(MAX_PATH, tempPath);
            std::wstring fallbackFolder = std::wstring(tempPath) + L"VLive_WV2_" + std::to_wstring(GetCurrentProcessId());

            CreateCoreWebView2EnvironmentWithOptions(
                nullptr,
                fallbackFolder.c_str(),
                nullptr,
                Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                    [configureController, targetUrl](HRESULT hrFbEnv, ICoreWebView2Environment* fbEnv) -> HRESULT {
                        if (SUCCEEDED(hrFbEnv) && fbEnv) {
                            fbEnv->CreateCoreWebView2Controller(
                                g_hwnd,
                                Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                                    [configureController, targetUrl](HRESULT hrFbCtrl, ICoreWebView2Controller* fbCtrl) -> HRESULT {
                                        if (SUCCEEDED(hrFbCtrl) && fbCtrl) {
                                            configureController(fbCtrl);
                                            return S_OK;
                                        }
                                        logGui("WebView2 Controller creation failed. Launching default system browser...");
                                        ShellExecuteW(nullptr, L"open", targetUrl.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                                        return hrFbCtrl;
                                    }).Get());
                            return S_OK;
                        }
                        logGui("WebView2 Environment creation failed. Launching default system browser...");
                        ShellExecuteW(nullptr, L"open", targetUrl.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                        return hrFbEnv;
                    }).Get());
        };

        auto initPrimaryController = [configureController, tryFallbackEnvironment](ICoreWebView2Environment* env) {
            logGui("initPrimaryController: creating controller on primary environment");
            env->CreateCoreWebView2Controller(
                g_hwnd,
                Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [configureController, tryFallbackEnvironment](HRESULT hrCtrl, ICoreWebView2Controller* controller) -> HRESULT {
                        if (SUCCEEDED(hrCtrl) && controller) {
                            logGui("initPrimaryController: primary controller created successfully!");
                            configureController(controller);
                            return S_OK;
                        }
                        char errBuf[128];
                        snprintf(errBuf, sizeof(errBuf), "Primary CreateCoreWebView2Controller failed: 0x%08X. Falling back to isolated session...", hrCtrl);
                        logGui(errBuf);
                        tryFallbackEnvironment();
                        return S_OK;
                    }).Get());
        };

        logGui("Creating primary CoreWebView2 Environment...");
        HRESULT hrEnv = CreateCoreWebView2EnvironmentWithOptions(
            nullptr,
            userDataFolder.empty() ? nullptr : userDataFolder.c_str(),
            nullptr,
            Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                [initPrimaryController, tryFallbackEnvironment](HRESULT hrResult, ICoreWebView2Environment* env) -> HRESULT {
                    if (SUCCEEDED(hrResult) && env) {
                        logGui("Primary CoreWebView2 Environment created successfully.");
                        initPrimaryController(env);
                        return S_OK;
                    }
                    char errBuf[128];
                    snprintf(errBuf, sizeof(errBuf), "Primary CreateCoreWebView2EnvironmentWithOptions failed: 0x%08X. Falling back...", hrResult);
                    logGui(errBuf);
                    tryFallbackEnvironment();
                    return S_OK;
                }).Get());

        if (FAILED(hrEnv)) {
            char errBuf[128];
            snprintf(errBuf, sizeof(errBuf), "CreateCoreWebView2EnvironmentWithOptions returned immediate HRESULT: 0x%08X", hrEnv);
            logGui(errBuf);
            tryFallbackEnvironment();
        }
    }

    logGui("Entering Win32 Message Loop...");
    // 8. Win32 Message Loop
    MSG msg = {};
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    logGui("Exited Win32 Message Loop with wParam=" + std::to_string(msg.wParam));

    // 9. Clean Shutdown & Safe Resource De-allocation
    g_app_running = false;

    if (hAvrt) {
        AvRevertMmThreadCharacteristics(hAvrt);
    }
    timeEndPeriod(1);

    if (g_midi_engine) {
        g_midi_engine->closeVirtualPort();
    }

    g_http_server.reset();
    g_ws_server.reset();
    g_midi_engine.reset();
    g_sync_engine.reset();
    g_session_mgr.reset();

    CoUninitialize();

    if (hMutex) {
        CloseHandle(hMutex);
    }
    logGui("=== wWinMain cleanly exited ===");

    ExitProcess(static_cast<UINT>(msg.wParam));
    return static_cast<int>(msg.wParam);
}
