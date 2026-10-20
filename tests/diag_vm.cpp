#include <windows.h>
#include <iostream>

int main() {
    std::cout << "=== teVirtualMIDI Diagnostic ===\n";
    HMODULE h = LoadLibraryW(L"teVirtualMIDI64.dll");
    std::cout << "LoadLibraryW(teVirtualMIDI64.dll): " << h << " (err: " << GetLastError() << ")\n";
    if (!h) {
        h = LoadLibraryW(L"teVirtualMIDI.dll");
        std::cout << "LoadLibraryW(teVirtualMIDI.dll): " << h << " (err: " << GetLastError() << ")\n";
    }
    if (!h) {
        h = LoadLibraryW(L"C:\\Program Files\\teVirtualMIDI\\teVirtualMIDI64.dll");
        std::cout << "LoadLibraryW(C:\\Program Files\\...): " << h << " (err: " << GetLastError() << ")\n";
    }

    if (!h) {
        std::cout << "FATAL: DLL not loaded.\n";
        return 1;
    }

    using CreatePortEx2Fn = LPVOID(WINAPI*)(LPCWSTR, void*, DWORD_PTR, DWORD, DWORD);
    using CreatePortExFn = LPVOID(WINAPI*)(LPCWSTR, void*, DWORD_PTR, DWORD);
    using CreatePortFn = LPVOID(WINAPI*)(LPCWSTR, void*, DWORD_PTR);
    using ClosePortFn = void(WINAPI*)(LPVOID);

    auto c2 = (CreatePortEx2Fn)GetProcAddress(h, "virtualMIDICreatePortEx2");
    auto ce = (CreatePortExFn)GetProcAddress(h, "virtualMIDICreatePortEx");
    auto c1 = (CreatePortFn)GetProcAddress(h, "virtualMIDICreatePort");
    auto cl = (ClosePortFn)GetProcAddress(h, "virtualMIDIClosePort");

    std::cout << "virtualMIDICreatePortEx2: " << (void*)c2 << "\n";
    std::cout << "virtualMIDICreatePortEx: " << (void*)ce << "\n";
    std::cout << "virtualMIDICreatePort: " << (void*)c1 << "\n";
    std::cout << "virtualMIDIClosePort: " << (void*)cl << "\n";

    if (c2) {
        SetLastError(0);
        LPVOID port = c2(L"VLive MIDI Controller", nullptr, 0, 65535, 15);
        DWORD err = GetLastError();
        std::cout << "c2(VLive MIDI Controller, flags=15): port=" << port << ", err=" << err << "\n";
        if (port) {
            std::cout << "SUCCESS! Port created with c2 flags=15\n";
            cl(port);
        } else {
            SetLastError(0);
            port = c2(L"VLive MIDI Controller", nullptr, 0, 65535, 0);
            err = GetLastError();
            std::cout << "c2(flags=0): port=" << port << ", err=" << err << "\n";
            if (port) cl(port);
        }
    }

    if (ce) {
        SetLastError(0);
        LPVOID port = ce(L"VLive MIDI Controller", nullptr, 0, 65535);
        DWORD err = GetLastError();
        std::cout << "ce(VLive MIDI Controller): port=" << port << ", err=" << err << "\n";
        if (port) cl(port);
    }

    if (c1) {
        SetLastError(0);
        LPVOID port = c1(L"VLive MIDI Controller", nullptr, 0);
        DWORD err = GetLastError();
        std::cout << "c1(VLive MIDI Controller): port=" << port << ", err=" << err << "\n";
        if (port) cl(port);
    }

    return 0;
}
