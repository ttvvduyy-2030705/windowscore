#include "pch.h"
#include "WindowsFfmpegLiveModule.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#ifndef HANDLE_FLAG_INHERIT
#define HANDLE_FLAG_INHERIT 0x00000001
#endif

#ifndef CREATE_NO_WINDOW
#define CREATE_NO_WINDOW 0x08000000
#endif

#ifndef STARTF_USESTDHANDLES
#define STARTF_USESTDHANDLES 0x00000100
#endif

#ifndef STD_INPUT_HANDLE
#define STD_INPUT_HANDLE ((DWORD)-10)
#endif

#ifndef WAIT_OBJECT_0
#define WAIT_OBJECT_0 0x00000000L
#endif

#ifndef WAIT_TIMEOUT
#define WAIT_TIMEOUT 258L
#endif

#ifndef STILL_ACTIVE
#define STILL_ACTIVE 259L
#endif

using namespace winrt::Microsoft::ReactNative;

namespace
{
    std::mutex g_processMutex;
    PROCESS_INFORMATION g_processInfo{};
    HANDLE g_stdinWrite = nullptr;
    HANDLE g_stderrRead = nullptr;
    std::atomic<bool> g_processActive{false};
    std::string g_stderrSummary;

    std::wstring ToWide(std::string const &value)
    {
        return std::wstring(winrt::to_hstring(value).c_str());
    }

    std::string ToUtf8(std::wstring const &value)
    {
        return winrt::to_string(winrt::hstring(value));
    }

    std::string WindowsErrorMessage(DWORD error)
    {
        LPWSTR buffer = nullptr;
        auto size = FormatMessageW(
            FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
            nullptr,
            error,
            MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
            reinterpret_cast<LPWSTR>(&buffer),
            0,
            nullptr);

        std::wstring message = size && buffer ? std::wstring(buffer, size) : L"Unknown Windows error";
        if (buffer)
        {
            LocalFree(buffer);
        }
        while (!message.empty() && (message.back() == L'\r' || message.back() == L'\n' || message.back() == L' '))
        {
            message.pop_back();
        }
        return ToUtf8(message) + " (" + std::to_string(error) + ")";
    }

    std::wstring NormalizeFfmpegPath(std::string const &value)
    {
        auto trimmed = value;
        trimmed.erase(trimmed.begin(), std::find_if(trimmed.begin(), trimmed.end(), [](unsigned char ch) { return !std::isspace(ch); }));
        trimmed.erase(std::find_if(trimmed.rbegin(), trimmed.rend(), [](unsigned char ch) { return !std::isspace(ch); }).base(), trimmed.end());
        if (trimmed.empty())
        {
            trimmed = "ffmpeg.exe";
        }
        std::replace(trimmed.begin(), trimmed.end(), '/', '\\');
        return ToWide(trimmed);
    }

    std::wstring Quote(std::wstring value)
    {
        std::wstring escaped;
        escaped.reserve(value.size() + 2);
        escaped.push_back(L'"');
        for (auto ch : value)
        {
            if (ch == L'"')
            {
                escaped += L"\\\"";
            }
            else
            {
                escaped.push_back(ch);
            }
        }
        escaped.push_back(L'"');
        return escaped;
    }

    std::wstring BuildCommandLine(std::wstring const &ffmpegPath, std::vector<std::string> const &args)
    {
        std::wstring command = Quote(ffmpegPath);
        for (auto const &arg : args)
        {
            command += L" ";
            command += Quote(ToWide(arg));
        }
        return command;
    }

    struct ProcessOutput
    {
        DWORD exitCode = 0;
        bool timedOut = false;
        bool started = false;
        std::string output;
        std::string error;
    };

    ProcessOutput RunProcessAndCapture(std::wstring const &ffmpegPath, std::vector<std::string> const &args, DWORD timeoutMs)
    {
        ProcessOutput result;
        SECURITY_ATTRIBUTES sa{};
        sa.nLength = sizeof(SECURITY_ATTRIBUTES);
        sa.bInheritHandle = TRUE;
        sa.lpSecurityDescriptor = nullptr;

        HANDLE readPipe = nullptr;
        HANDLE writePipe = nullptr;
        if (!CreatePipe(&readPipe, &writePipe, &sa, 0))
        {
            result.error = "CreatePipe failed: " + WindowsErrorMessage(GetLastError());
            return result;
        }
        SetHandleInformation(readPipe, HANDLE_FLAG_INHERIT, 0);

        STARTUPINFOW si{};
        si.cb = sizeof(si);
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        si.hStdOutput = writePipe;
        si.hStdError = writePipe;

        PROCESS_INFORMATION pi{};
        auto command = BuildCommandLine(ffmpegPath, args);
        std::vector<wchar_t> commandLine(command.begin(), command.end());
        commandLine.push_back(L'\0');

        BOOL ok = CreateProcessW(
            nullptr,
            commandLine.data(),
            nullptr,
            nullptr,
            TRUE,
            CREATE_NO_WINDOW,
            nullptr,
            nullptr,
            &si,
            &pi);

        CloseHandle(writePipe);

        if (!ok)
        {
            result.error = "CreateProcessW failed: " + WindowsErrorMessage(GetLastError());
            CloseHandle(readPipe);
            return result;
        }

        result.started = true;
        std::string output;
        auto start = std::chrono::steady_clock::now();
        char buffer[4096];
        DWORD bytesRead = 0;

        for (;;)
        {
            while (PeekNamedPipe(readPipe, nullptr, 0, nullptr, &bytesRead, nullptr) && bytesRead > 0)
            {
                DWORD readNow = 0;
                if (ReadFile(readPipe, buffer, sizeof(buffer), &readNow, nullptr) && readNow > 0)
                {
                    output.append(buffer, buffer + readNow);
                    if (output.size() > 32768)
                    {
                        output.erase(0, output.size() - 32768);
                    }
                }
                else
                {
                    break;
                }
                bytesRead = 0;
            }

            auto wait = WaitForSingleObject(pi.hProcess, 40);
            if (wait == WAIT_OBJECT_0)
            {
                break;
            }

            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
            if (elapsed > timeoutMs)
            {
                result.timedOut = true;
                TerminateProcess(pi.hProcess, 124);
                WaitForSingleObject(pi.hProcess, 1000);
                break;
            }
        }

        while (ReadFile(readPipe, buffer, sizeof(buffer), &bytesRead, nullptr) && bytesRead > 0)
        {
            output.append(buffer, buffer + bytesRead);
            if (output.size() > 32768)
            {
                output.erase(0, output.size() - 32768);
            }
        }

        DWORD exitCode = 0;
        GetExitCodeProcess(pi.hProcess, &exitCode);
        result.exitCode = exitCode;
        result.output = output;

        CloseHandle(readPipe);
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        return result;
    }

    std::string FirstLine(std::string text)
    {
        auto pos = text.find_first_of("\r\n");
        if (pos != std::string::npos)
        {
            text = text.substr(0, pos);
        }
        if (text.size() > 240)
        {
            text = text.substr(0, 240);
        }
        return text;
    }

    JSValueArray ParseDshowDevices(std::string const &output, bool wantVideo)
    {
        JSValueArray devices;
        bool inVideo = false;
        bool inAudio = false;
        std::istringstream stream(output);
        std::string line;

        while (std::getline(stream, line))
        {
            auto lower = line;
            std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });

            if (lower.find("directshow video devices") != std::string::npos)
            {
                inVideo = true;
                inAudio = false;
                continue;
            }
            if (lower.find("directshow audio devices") != std::string::npos)
            {
                inVideo = false;
                inAudio = true;
                continue;
            }

            if ((wantVideo && !inVideo) || (!wantVideo && !inAudio))
            {
                continue;
            }

            auto firstQuote = line.find('"');
            auto secondQuote = firstQuote == std::string::npos ? std::string::npos : line.find('"', firstQuote + 1);
            if (firstQuote != std::string::npos && secondQuote != std::string::npos && secondQuote > firstQuote + 1)
            {
                auto name = line.substr(firstQuote + 1, secondQuote - firstQuote - 1);
                bool exists = false;
                for (auto const &item : devices)
                {
                    if (item.AsString() == name)
                    {
                        exists = true;
                        break;
                    }
                }
                if (!exists)
                {
                    devices.push_back(JSValue(name));
                }
            }
        }

        return devices;
    }

    void CloseHandleIfValid(HANDLE &handle)
    {
        if (handle)
        {
            CloseHandle(handle);
            handle = nullptr;
        }
    }

    void ResetActiveProcessHandles()
    {
        CloseHandleIfValid(g_stdinWrite);
        CloseHandleIfValid(g_stderrRead);
        if (g_processInfo.hThread)
        {
            CloseHandle(g_processInfo.hThread);
            g_processInfo.hThread = nullptr;
        }
        if (g_processInfo.hProcess)
        {
            CloseHandle(g_processInfo.hProcess);
            g_processInfo.hProcess = nullptr;
        }
        g_processInfo.dwProcessId = 0;
        g_processInfo.dwThreadId = 0;
        g_processActive = false;
    }

    void AppendStderrSummary(std::string const &text)
    {
        std::lock_guard<std::mutex> lock(g_processMutex);
        g_stderrSummary += text;
        if (g_stderrSummary.size() > 4096)
        {
            g_stderrSummary.erase(0, g_stderrSummary.size() - 4096);
        }
    }

    std::vector<std::string> ArgsFromPayload(JSValueObject const &payload)
    {
        std::vector<std::string> args;
        auto found = payload.find("args");
        if (found == payload.end())
        {
            return args;
        }

        try
        {
            for (auto const &item : found->second.AsArray())
            {
                args.push_back(item.AsString());
            }
        }
        catch (...)
        {
        }
        return args;
    }

    std::string StringFromPayload(JSValueObject const &payload, std::string const &key)
    {
        auto found = payload.find(key);
        if (found == payload.end())
        {
            return "";
        }
        try
        {
            return found->second.AsString();
        }
        catch (...)
        {
            return "";
        }
    }
}

namespace winrt::billiardsgrade::implementation
{
    void WindowsFfmpegLiveModule::CheckFfmpegAvailable(std::string ffmpegPath, ReactPromise<JSValueObject> promise) noexcept
    {
        std::thread([ffmpegPath, promise]() mutable {
            JSValueObject result;
            try
            {
                auto path = NormalizeFfmpegPath(ffmpegPath);
                auto output = RunProcessAndCapture(path, {"-version"}, 8000);
                result["ffmpegPath"] = JSValue(ffmpegPath.empty() ? "ffmpeg.exe" : ffmpegPath);
                result["available"] = JSValue(output.started && !output.timedOut && output.exitCode == 0);
                result["version"] = JSValue(FirstLine(output.output));
                result["error"] = JSValue(output.error.empty() ? (output.timedOut ? "ffmpeg -version timed out" : "") : output.error);
                promise.Resolve(result);
            }
            catch (std::exception const &ex)
            {
                result["available"] = JSValue(false);
                result["ffmpegPath"] = JSValue(ffmpegPath.empty() ? "ffmpeg.exe" : ffmpegPath);
                result["version"] = JSValue("");
                result["error"] = JSValue(ex.what());
                promise.Resolve(result);
            }
        }).detach();
    }

    void WindowsFfmpegLiveModule::ListDevices(std::string ffmpegPath, ReactPromise<JSValueObject> promise) noexcept
    {
        std::thread([ffmpegPath, promise]() mutable {
            JSValueObject result;
            try
            {
                auto path = NormalizeFfmpegPath(ffmpegPath);
                auto output = RunProcessAndCapture(path, {"-list_devices", "true", "-f", "dshow", "-i", "dummy"}, 9000);
                result["videoDevices"] = JSValue(ParseDshowDevices(output.output, true));
                result["audioDevices"] = JSValue(ParseDshowDevices(output.output, false));
                result["error"] = JSValue(output.error);
                promise.Resolve(result);
            }
            catch (std::exception const &ex)
            {
                result["videoDevices"] = JSValue(JSValueArray{});
                result["audioDevices"] = JSValue(JSValueArray{});
                result["error"] = JSValue(ex.what());
                promise.Resolve(result);
            }
        }).detach();
    }

    void WindowsFfmpegLiveModule::Start(JSValueObject payload, ReactPromise<JSValueObject> promise) noexcept
    {
        // JSValueObject is move-only in this RNW version, so never copy it into
        // the background lambda. Extract the primitive values on the caller
        // thread and capture only STL values.
        auto requestedFfmpegPath = StringFromPayload(payload, "ffmpegPath");
        auto requestedArgs = ArgsFromPayload(payload);

        std::thread([requestedFfmpegPath, requestedArgs = std::move(requestedArgs), promise]() mutable {
            JSValueObject result;
            try
            {
                std::lock_guard<std::mutex> lock(g_processMutex);
                if (g_processActive && g_processInfo.hProcess)
                {
                    result["status"] = JSValue("live");
                    result["pid"] = JSValue(static_cast<double>(g_processInfo.dwProcessId));
                    result["error"] = JSValue("FFmpeg live process is already running");
                    promise.Resolve(result);
                    return;
                }

                auto ffmpegPath = NormalizeFfmpegPath(requestedFfmpegPath);
                auto args = std::move(requestedArgs);
                if (args.empty())
                {
                    result["status"] = JSValue("error");
                    result["pid"] = JSValue(0.0);
                    result["error"] = JSValue("Missing FFmpeg arguments");
                    promise.Resolve(result);
                    return;
                }

                SECURITY_ATTRIBUTES sa{};
                sa.nLength = sizeof(SECURITY_ATTRIBUTES);
                sa.bInheritHandle = TRUE;
                sa.lpSecurityDescriptor = nullptr;

                HANDLE stdinRead = nullptr;
                HANDLE stdinWrite = nullptr;
                HANDLE stderrRead = nullptr;
                HANDLE stderrWrite = nullptr;

                if (!CreatePipe(&stdinRead, &stdinWrite, &sa, 0) || !CreatePipe(&stderrRead, &stderrWrite, &sa, 0))
                {
                    result["status"] = JSValue("error");
                    result["pid"] = JSValue(0.0);
                    result["error"] = JSValue("CreatePipe failed: " + WindowsErrorMessage(GetLastError()));
                    CloseHandleIfValid(stdinRead);
                    CloseHandleIfValid(stdinWrite);
                    CloseHandleIfValid(stderrRead);
                    CloseHandleIfValid(stderrWrite);
                    promise.Resolve(result);
                    return;
                }

                SetHandleInformation(stdinWrite, HANDLE_FLAG_INHERIT, 0);
                SetHandleInformation(stderrRead, HANDLE_FLAG_INHERIT, 0);

                STARTUPINFOW si{};
                si.cb = sizeof(si);
                si.dwFlags = STARTF_USESTDHANDLES;
                si.hStdInput = stdinRead;
                si.hStdOutput = stderrWrite;
                si.hStdError = stderrWrite;

                PROCESS_INFORMATION pi{};
                auto command = BuildCommandLine(ffmpegPath, args);
                std::vector<wchar_t> commandLine(command.begin(), command.end());
                commandLine.push_back(L'\0');

                BOOL ok = CreateProcessW(
                    nullptr,
                    commandLine.data(),
                    nullptr,
                    nullptr,
                    TRUE,
                    CREATE_NO_WINDOW,
                    nullptr,
                    nullptr,
                    &si,
                    &pi);

                CloseHandleIfValid(stdinRead);
                CloseHandleIfValid(stderrWrite);

                if (!ok)
                {
                    result["status"] = JSValue("error");
                    result["pid"] = JSValue(0.0);
                    result["error"] = JSValue("CreateProcessW failed: " + WindowsErrorMessage(GetLastError()));
                    CloseHandleIfValid(stdinWrite);
                    CloseHandleIfValid(stderrRead);
                    promise.Resolve(result);
                    return;
                }

                g_processInfo = pi;
                g_stdinWrite = stdinWrite;
                g_stderrRead = stderrRead;
                g_stderrSummary.clear();
                g_processActive = true;

                HANDLE readForThread = g_stderrRead;
                std::thread([readForThread]() {
                    char buffer[2048];
                    DWORD bytesRead = 0;
                    while (ReadFile(readForThread, buffer, sizeof(buffer), &bytesRead, nullptr) && bytesRead > 0)
                    {
                        AppendStderrSummary(std::string(buffer, buffer + bytesRead));
                    }
                }).detach();

                result["status"] = JSValue("live");
                result["pid"] = JSValue(static_cast<double>(pi.dwProcessId));
                result["error"] = JSValue("");
                promise.Resolve(result);
            }
            catch (std::exception const &ex)
            {
                result["status"] = JSValue("error");
                result["pid"] = JSValue(0.0);
                result["error"] = JSValue(ex.what());
                promise.Resolve(result);
            }
        }).detach();
    }

    void WindowsFfmpegLiveModule::Stop(ReactPromise<JSValueObject> promise) noexcept
    {
        std::thread([promise]() mutable {
            JSValueObject result;
            std::lock_guard<std::mutex> lock(g_processMutex);
            try
            {
                DWORD exitCode = 0;
                if (g_processActive && g_processInfo.hProcess)
                {
                    if (g_stdinWrite)
                    {
                        DWORD written = 0;
                        const char quit[] = "q\n";
                        WriteFile(g_stdinWrite, quit, static_cast<DWORD>(sizeof(quit) - 1), &written, nullptr);
                    }

                    auto wait = WaitForSingleObject(g_processInfo.hProcess, 3000);
                    if (wait != WAIT_OBJECT_0)
                    {
                        TerminateProcess(g_processInfo.hProcess, 1);
                        WaitForSingleObject(g_processInfo.hProcess, 1500);
                    }
                    GetExitCodeProcess(g_processInfo.hProcess, &exitCode);
                }
                ResetActiveProcessHandles();
                result["stopped"] = JSValue(true);
                result["exitCode"] = JSValue(static_cast<double>(exitCode));
                result["error"] = JSValue("");
                promise.Resolve(result);
            }
            catch (std::exception const &ex)
            {
                ResetActiveProcessHandles();
                result["stopped"] = JSValue(false);
                result["exitCode"] = JSValue(0.0);
                result["error"] = JSValue(ex.what());
                promise.Resolve(result);
            }
        }).detach();
    }

    void WindowsFfmpegLiveModule::Status(ReactPromise<JSValueObject> promise) noexcept
    {
        JSValueObject result;
        std::lock_guard<std::mutex> lock(g_processMutex);
        DWORD exitCode = 0;
        bool active = g_processActive && g_processInfo.hProcess && GetExitCodeProcess(g_processInfo.hProcess, &exitCode) && exitCode == STILL_ACTIVE;
        result["status"] = JSValue(active ? "live" : "stopped");
        result["pid"] = JSValue(static_cast<double>(active ? g_processInfo.dwProcessId : 0));
        result["stderrSummary"] = JSValue(g_stderrSummary);
        result["error"] = JSValue("");
        promise.Resolve(result);
    }
}
