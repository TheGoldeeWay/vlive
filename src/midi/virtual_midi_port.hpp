#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <atomic>
#include <iostream>
#include <filesystem>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>
#endif

#include <mutex>

namespace vlive {

/**
 * In-process Virtual MIDI Driver integration.
 * Dynamically binds to teVirtualMIDI64.dll / teVirtualMIDI.dll at runtime.
 * Creates an in-process native Windows MIDI device (e.g. "VLive MIDI Controller")
 * that any DAW (Ableton, FL Studio, Reaper, Cubase) detects immediately.
 * On a fresh PC without the driver, it automatically installs the bundled signed driver.
 */
class VirtualMidiPort {
public:
    VirtualMidiPort() = default;
    ~VirtualMidiPort() {
        close();
    }

    // Non-copyable
    VirtualMidiPort(const VirtualMidiPort&) = delete;
    VirtualMidiPort& operator=(const VirtualMidiPort&) = delete;

    static bool isDriverServiceRunning() {
#ifdef _WIN32
        SC_HANDLE scm = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
        if (!scm) return false;
        SC_HANDLE svc = OpenServiceW(scm, L"teVirtualMIDI64", SERVICE_QUERY_STATUS);
        if (!svc) {
            CloseServiceHandle(scm);
            return false;
        }
        SERVICE_STATUS_PROCESS ssp{};
        DWORD bytesNeeded = 0;
        bool running = false;
        if (QueryServiceStatusEx(svc, SC_STATUS_PROCESS_INFO, reinterpret_cast<LPBYTE>(&ssp), sizeof(ssp), &bytesNeeded)) {
            running = (ssp.dwCurrentState == SERVICE_RUNNING);
        }
        CloseServiceHandle(svc);
        CloseServiceHandle(scm);
        return running;
#else
        return false;
#endif
    }

    static bool ensureDriverServiceStarted(bool promptElevation = false) {
#ifdef _WIN32
        if (isDriverServiceRunning()) {
            return true;
        }

        // 1. Try direct StartService via Service Control Manager (works if running as admin or pre-configured)
        SC_HANDLE scm = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
        if (scm) {
            SC_HANDLE svc = OpenServiceW(scm, L"teVirtualMIDI64", SERVICE_START | SERVICE_QUERY_STATUS);
            if (svc) {
                if (StartServiceW(svc, 0, nullptr)) {
                    SERVICE_STATUS_PROCESS ssp{};
                    DWORD bytesNeeded = 0;
                    for (int i = 0; i < 25; ++i) {
                        Sleep(100);
                        if (QueryServiceStatusEx(svc, SC_STATUS_PROCESS_INFO, reinterpret_cast<LPBYTE>(&ssp), sizeof(ssp), &bytesNeeded)) {
                            if (ssp.dwCurrentState == SERVICE_RUNNING) {
                                CloseServiceHandle(svc);
                                CloseServiceHandle(scm);
                                return true;
                            }
                        }
                    }
                }
                CloseServiceHandle(svc);
            }
            CloseServiceHandle(scm);
        }

        if (!promptElevation) {
            return isDriverServiceRunning();
        }

        // 2. Locate bundled signed MSI driver if present
        wchar_t exePath[MAX_PATH];
        std::filesystem::path msiCandidate;
        if (GetModuleFileNameW(NULL, exePath, MAX_PATH) > 0) {
            auto baseDir = std::filesystem::path(exePath).parent_path();
            if (std::filesystem::exists(baseDir / "drivers" / "teVirtualMIDI64.msi")) {
                msiCandidate = baseDir / "drivers" / "teVirtualMIDI64.msi";
            } else if (std::filesystem::exists(baseDir.parent_path() / "drivers" / "teVirtualMIDI64.msi")) {
                msiCandidate = baseDir.parent_path() / "drivers" / "teVirtualMIDI64.msi";
            } else if (std::filesystem::exists(std::filesystem::current_path() / "drivers" / "teVirtualMIDI64.msi")) {
                msiCandidate = std::filesystem::current_path() / "drivers" / "teVirtualMIDI64.msi";
            }
        }

        std::wstring cmdParams;
        if (!msiCandidate.empty()) {
            cmdParams = L"/c msiexec.exe /i \"" + msiCandidate.wstring() + L"\" /qn /norestart & sc.exe config teVirtualMIDI64 start= auto & net.exe start teVirtualMIDI64";
        } else {
            cmdParams = L"/c sc.exe config teVirtualMIDI64 start= auto & net.exe start teVirtualMIDI64";
        }

        // 3. Elevate with standard Windows UAC dialog so user can authorize one-time driver activation
        SHELLEXECUTEINFOW sei = { sizeof(sei) };
        sei.fMask = SEE_MASK_NOCLOSEPROCESS;
        sei.lpVerb = L"runas";
        sei.lpFile = L"cmd.exe";
        sei.lpParameters = cmdParams.c_str();
        sei.nShow = SW_HIDE;

        if (ShellExecuteExW(&sei) && sei.hProcess) {
            WaitForSingleObject(sei.hProcess, 10000);
            CloseHandle(sei.hProcess);
            Sleep(800);
        }

        return isDriverServiceRunning();
#else
        return false;
#endif
    }

    using IncomingCallback = std::function<void(const uint8_t* data, size_t length)>;

    void setIncomingCallback(IncomingCallback cb) {
        std::lock_guard<std::mutex> lock(cb_mutex_);
        incoming_cb_ = std::move(cb);
    }

    void handleIncomingData(const BYTE* data, DWORD length) noexcept {
        try {
            IncomingCallback cb;
            {
                std::lock_guard<std::mutex> lock(cb_mutex_);
                cb = incoming_cb_;
            }
            if (cb && data && length > 0) {
                cb(reinterpret_cast<const uint8_t*>(data), static_cast<size_t>(length));
            }
        } catch (...) {
            // Guarantee no exception escapes into unmanaged C driver thread
        }
    }

    bool open(const std::wstring& port_name = L"VLive MIDI Controller", bool promptElevation = false) {
        close();

#ifdef _WIN32
        // 1. Ensure driver service is running
        ensureDriverServiceStarted(promptElevation);

        // 2. Try loading DLL from system, standard install paths, and app directory
        if (!hDll_) {
            const wchar_t* dllCandidates[] = {
                L"teVirtualMIDI64.dll",
                L"teVirtualMIDI.dll",
                L"C:\\Program Files\\teVirtualMIDI\\teVirtualMIDI64.dll",
                L"C:\\Program Files (x86)\\teVirtualMIDI\\teVirtualMIDI.dll"
            };
            for (const auto* path : dllCandidates) {
                hDll_ = LoadLibraryW(path);
                if (hDll_) break;
            }
        }

        if (!hDll_) {
            return false;
        }

        // 3. Resolve function pointers
        createPortEx2Fn_ = reinterpret_cast<CreatePortEx2Fn>(GetProcAddress(hDll_, "virtualMIDICreatePortEx2"));
        createPortExFn_  = reinterpret_cast<CreatePortExFn>(GetProcAddress(hDll_, "virtualMIDICreatePortEx"));
        createPortFn_    = reinterpret_cast<CreatePortFn>(GetProcAddress(hDll_, "virtualMIDICreatePort"));
        sendDataFn_      = reinterpret_cast<SendDataFn>(GetProcAddress(hDll_, "virtualMIDISendData"));
        closePortFn_     = reinterpret_cast<ClosePortFn>(GetProcAddress(hDll_, "virtualMIDIClosePort"));

        if ((!createPortEx2Fn_ && !createPortExFn_ && !createPortFn_) || !sendDataFn_ || !closePortFn_) {
            return false;
        }

        // 4. Create the virtual port with full duplex flags:
        // Try multiple flag combinations (15: full duplex parsed, 12: instantiate both, 0: basic)
        const DWORD flagCandidates[] = { 15, 12, 0 };
        std::vector<std::wstring> nameCandidates = {
            port_name,
            port_name + L" 1",
            L"VLive Studio MIDI"
        };

        for (const auto& name : nameCandidates) {
            for (DWORD flags : flagCandidates) {
                if (createPortEx2Fn_) {
                    port_handle_ = createPortEx2Fn_(name.c_str(), teVirtualMidiCallback, reinterpret_cast<DWORD_PTR>(this), 65535, flags);
                }
                if (port_handle_) break;
            }

            if (!port_handle_ && createPortExFn_) {
                port_handle_ = createPortExFn_(name.c_str(), teVirtualMidiCallback, reinterpret_cast<DWORD_PTR>(this), 65535);
            }
            if (!port_handle_ && createPortFn_) {
                port_handle_ = createPortFn_(name.c_str(), teVirtualMidiCallback, reinterpret_cast<DWORD_PTR>(this));
            }

            if (port_handle_) {
                port_name_ = name;
                is_open_ = true;
                Sleep(50);
                return true;
            }
        }

        return false;
#else
        return false;
#endif
    }

    bool ensureOpen(const std::wstring& port_name = L"VLive MIDI Controller") {
        if (isOpen()) return true;
        return open(port_name);
    }

    void close() {
#ifdef _WIN32
        if (port_handle_ && closePortFn_) {
            closePortFn_(port_handle_);
            port_handle_ = nullptr;
        }
#endif
        is_open_ = false;
        port_name_.clear();
    }

    bool sendData(const uint8_t* data, size_t length) {
#ifdef _WIN32
        if (!is_open_ || !port_handle_ || !sendDataFn_ || !data || length == 0) {
            return false;
        }
        return sendDataFn_(port_handle_, data, static_cast<DWORD>(length)) != FALSE;
#else
        return false;
#endif
    }

    [[nodiscard]] bool isOpen() const noexcept {
        return is_open_.load();
    }

    [[nodiscard]] std::wstring getPortName() const {
        return port_name_;
    }

    [[nodiscard]] std::string getPortNameUtf8() const {
        if (port_name_.empty()) return "";
        int len = WideCharToMultiByte(CP_UTF8, 0, port_name_.c_str(), -1, nullptr, 0, nullptr, nullptr);
        if (len <= 0) return "";
        std::string str(len - 1, '\0');
        WideCharToMultiByte(CP_UTF8, 0, port_name_.c_str(), -1, &str[0], len, nullptr, nullptr);
        return str;
    }

private:
#ifdef _WIN32
    using MidiCallbackFn  = void(CALLBACK*)(LPVOID midiPort, const BYTE* midiDataBytes, DWORD length, DWORD_PTR dwCallbackInstance);
    using CreatePortEx2Fn = LPVOID(WINAPI*)(LPCWSTR portName, MidiCallbackFn callback, DWORD_PTR dwCallbackInstance, DWORD maxSysex, DWORD flags);
    using CreatePortExFn  = LPVOID(WINAPI*)(LPCWSTR portName, MidiCallbackFn callback, DWORD_PTR dwCallbackInstance, DWORD maxSysex);
    using CreatePortFn    = LPVOID(WINAPI*)(LPCWSTR portName, MidiCallbackFn callback, DWORD_PTR dwCallbackInstance);
    using SendDataFn      = BOOL(WINAPI*)(LPVOID midiPort, const BYTE* midiDataBytes, DWORD length);
    using ClosePortFn     = void(WINAPI*)(LPVOID midiPort);

    static void CALLBACK teVirtualMidiCallback(LPVOID /*midiPort*/, const BYTE* midiDataBytes, DWORD length, DWORD_PTR dwCallbackInstance) noexcept {
        try {
            if (dwCallbackInstance && midiDataBytes && length > 0) {
                auto* self = reinterpret_cast<VirtualMidiPort*>(dwCallbackInstance);
                self->handleIncomingData(midiDataBytes, length);
            }
        } catch (...) {
            // Guard against any unhandled exception escaping into C kernel callback
        }
    }

    HMODULE hDll_{nullptr};
    CreatePortEx2Fn createPortEx2Fn_{nullptr};
    CreatePortExFn createPortExFn_{nullptr};
    CreatePortFn createPortFn_{nullptr};
    SendDataFn sendDataFn_{nullptr};
    ClosePortFn closePortFn_{nullptr};
    LPVOID port_handle_{nullptr};
#endif

    std::mutex cb_mutex_;
    IncomingCallback incoming_cb_;
    std::wstring port_name_;
    std::atomic<bool> is_open_{false};
};

} // namespace vlive
