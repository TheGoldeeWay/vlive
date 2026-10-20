cmake_minimum_required(VERSION 3.20)
project(VLive VERSION 2.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Use static MSVC runtime (/MT) so the app runs on any machine without requiring VC++ Redistributable
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# Target Windows 10+ API compatibility, UTF-8 source encoding, and lean Win32
add_compile_definitions(
    NOMINMAX 
    WIN32_LEAN_AND_MEAN 
    _WIN32_WINNT=0x0A00 
    WINVER=0x0A00
)

if(MSVC)
    add_compile_options(/utf-8 /W4 /permissive- /EHsc)
    # Enable aggressive whole-program optimization and inlining for Release builds
    add_compile_options("$<$<CONFIG:Release>:/O2;/Oi;/GL;/Gy;/GF>")
    add_link_options("$<$<CONFIG:Release>:/LTCG;/OPT:REF;/OPT:ICF>")
endif()

# Core Application Sources
set(CORE_SOURCES
    src/main.cpp
    src/midi/midi_engine.cpp
    src/sync/sync_engine.cpp
    src/session/session_manager.cpp
    src/network/http_server.cpp
    src/network/websocket_server.cpp
    src/ui/terminal_ui.cpp
)

add_executable(vlive_core ${CORE_SOURCES})
target_include_directories(vlive_core PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

if(WIN32)
    target_link_libraries(vlive_core PRIVATE ws2_32 winmm iphlpapi avrt dbghelp)
endif()

# Automated Test: MIDI Engine & Ring Buffer
add_executable(test_midi tests/test_midi.cpp)
target_include_directories(test_midi PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

# Automated Test: Sync Engine & Clock Sync
add_executable(test_sync tests/test_sync.cpp src/sync/sync_engine.cpp)
target_include_directories(test_sync PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
if(WIN32)
    target_link_libraries(test_sync PRIVATE winmm)
endif()

# Automated Test: End-to-End In-Process Virtual MIDI Port & Windows Subsystem Verification
if(WIN32)
    add_executable(test_e2e_virtual_midi 
        tests/test_e2e_virtual_midi.cpp 
        src/midi/midi_engine.cpp
    )
    target_include_directories(test_e2e_virtual_midi PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(test_e2e_virtual_midi PRIVATE winmm ws2_32 iphlpapi)
endif()

# Native Windows Desktop GUI Application (VLive.exe)
if(WIN32)
    set(GUI_SOURCES
        src/gui/main_gui.cpp
        src/midi/midi_engine.cpp
        src/sync/sync_engine.cpp
        src/session/session_manager.cpp
        src/network/http_server.cpp
        src/network/websocket_server.cpp
        src/ui/terminal_ui.cpp
        resources/vlive.rc
        resources/vlive.manifest
    )

    add_executable(VLive WIN32 ${GUI_SOURCES})
    target_include_directories(VLive PRIVATE 
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2/build/native/include
    )
    target_link_libraries(VLive PRIVATE
        ws2_32
        winmm
        iphlpapi
        dwmapi
        shlwapi
        ole32
        shell32
        avrt
        dbghelp
        ${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2/build/native/x64/WebView2LoaderStatic.lib
    )

    # Automatically copy VLive.exe to project root for one-click launching
    add_custom_command(TARGET VLive POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "$<TARGET_FILE:VLive>"
        "${CMAKE_CURRENT_SOURCE_DIR}/VLive.exe"
    )
endif()

