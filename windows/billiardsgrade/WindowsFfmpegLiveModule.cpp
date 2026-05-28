#include "pch.h"
#include "WindowsFfmpegLiveModule.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <mutex>
#include <sstream>
#include <string>
#include <cwctype>
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

#ifndef CREATE_NEW_PROCESS_GROUP
#define CREATE_NEW_PROCESS_GROUP 0x00000200
#endif

#ifndef BELOW_NORMAL_PRIORITY_CLASS
#define BELOW_NORMAL_PRIORITY_CLASS 0x00004000
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

    bool FileExists(std::wstring const &path)
    {
        if (path.empty())
        {
            return false;
        }
        DWORD attrs = GetFileAttributesW(path.c_str());
        return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY);
    }

    std::wstring Trim(std::wstring value)
    {
        value.erase(value.begin(), std::find_if(value.begin(), value.end(), [](wchar_t ch) { return !std::iswspace(ch); }));
        value.erase(std::find_if(value.rbegin(), value.rend(), [](wchar_t ch) { return !std::iswspace(ch); }).base(), value.end());
        return value;
    }

    std::wstring GetDirectoryName(std::wstring const &path)
    {
        auto pos = path.find_last_of(L"\\/");
        if (pos == std::wstring::npos)
        {
            return L"";
        }
        return path.substr(0, pos);
    }

    std::wstring GetModuleDirectory()
    {
        std::wstring buffer(32768, L'\0');
        DWORD len = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        if (len == 0)
        {
            return L"";
        }
        buffer.resize(len);
        return GetDirectoryName(buffer);
    }

    bool IsAbsolutePath(std::wstring const &value)
    {
        return value.size() >= 3 && std::iswalpha(value[0]) && value[1] == L':' && (value[2] == L'\\' || value[2] == L'/');
    }

    std::wstring JoinPath(std::wstring const &dir, std::wstring const &name)
    {
        if (dir.empty())
        {
            return name;
        }
        wchar_t last = dir.back();
        if (last == L'\\' || last == L'/')
        {
            return dir + name;
        }
        return dir + L"\\" + name;
    }

    std::wstring GetEnvironmentString(std::wstring const &name)
    {
        DWORD needed = GetEnvironmentVariableW(name.c_str(), nullptr, 0);
        if (needed == 0)
        {
            return L"";
        }
        std::wstring value(needed, L'\0');
        DWORD len = GetEnvironmentVariableW(name.c_str(), value.data(), needed);
        if (len == 0)
        {
            return L"";
        }
        value.resize(len);
        return value;
    }

    std::wstring SearchPathForExecutable(std::wstring const &exeName)
    {
        // SearchPathW is not available in this React Native Windows/UWP build,
        // so resolve PATH manually. This keeps the module buildable and avoids
        // relying on the shell to expand ffmpeg.exe.
        auto pathValue = GetEnvironmentString(L"PATH");
        if (pathValue.empty())
        {
            pathValue = GetEnvironmentString(L"Path");
        }
        if (pathValue.empty())
        {
            return L"";
        }

        size_t start = 0;
        while (start <= pathValue.size())
        {
            auto end = pathValue.find(L';', start);
            auto part = pathValue.substr(start, end == std::wstring::npos ? std::wstring::npos : end - start);
            part = Trim(part);
            if (!part.empty() && part.front() == L'"' && part.back() == L'"' && part.size() >= 2)
            {
                part = part.substr(1, part.size() - 2);
            }

            if (!part.empty())
            {
                auto candidate = JoinPath(part, exeName);
                if (FileExists(candidate))
                {
                    return candidate;
                }
            }

            if (end == std::wstring::npos)
            {
                break;
            }
            start = end + 1;
        }

        return L"";
    }

    std::wstring GetEnvPath(std::wstring const &name)
    {
        DWORD needed = GetEnvironmentVariableW(name.c_str(), nullptr, 0);
        if (needed == 0)
        {
            return L"";
        }
        std::wstring value(needed, L'\0');
        DWORD len = GetEnvironmentVariableW(name.c_str(), value.data(), needed);
        if (len == 0)
        {
            return L"";
        }
        value.resize(len);
        return value;
    }

    std::wstring NormalizeFfmpegPath(std::string const &value)
    {
        auto requested = Trim(ToWide(value));
        std::replace(requested.begin(), requested.end(), L'/', L'\\');

        auto lower = requested;
        std::transform(lower.begin(), lower.end(), lower.begin(), [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });

        const bool wantsAuto = requested.empty() || lower == L"ffmpeg" || lower == L"ffmpeg.exe" || lower == L"path:ffmpeg";
        const auto moduleDir = GetModuleDirectory();

        std::vector<std::wstring> candidates;
        if (!wantsAuto)
        {
            candidates.push_back(requested);
            if (!IsAbsolutePath(requested) && !moduleDir.empty())
            {
                candidates.push_back(moduleDir + L"\\" + requested);
            }
        }

        if (!moduleDir.empty())
        {
            candidates.push_back(moduleDir + L"\\Assets\\ffmpeg\\ffmpeg.exe");
            candidates.push_back(moduleDir + L"\\ffmpeg.exe");
        }
        candidates.push_back(L"C:\\ffmpeg\\bin\\ffmpeg.exe");

        auto localAppData = GetEnvPath(L"LOCALAPPDATA");
        if (!localAppData.empty())
        {
            candidates.push_back(localAppData + L"\\Microsoft\\WinGet\\Links\\ffmpeg.exe");
        }
        auto userProfile = GetEnvPath(L"USERPROFILE");
        if (!userProfile.empty())
        {
            candidates.push_back(userProfile + L"\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe");
        }

        auto searched = SearchPathForExecutable(L"ffmpeg.exe");
        if (!searched.empty())
        {
            candidates.push_back(searched);
        }

        for (auto const &candidate : candidates)
        {
            if (FileExists(candidate))
            {
                return candidate;
            }
        }

        if (!requested.empty() && !wantsAuto)
        {
            return requested;
        }
        return L"ffmpeg.exe";
    }

    std::string NormalizeFfmpegPathForResult(std::string const &value)
    {
        return ToUtf8(NormalizeFfmpegPath(value));
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
                result["ffmpegPath"] = JSValue(ToUtf8(path));
                result["available"] = JSValue(output.started && !output.timedOut && output.exitCode == 0);
                result["version"] = JSValue(FirstLine(output.output));
                result["error"] = JSValue(output.error.empty() ? (output.timedOut ? "ffmpeg -version timed out" : "") : output.error);
                promise.Resolve(result);
            }
            catch (std::exception const &ex)
            {
                result["available"] = JSValue(false);
                result["ffmpegPath"] = JSValue(NormalizeFfmpegPathForResult(ffmpegPath));
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
        // Extract JS values on the RN caller thread. The FFmpeg process is then
        // launched in a detached/native way with no stdout/stderr pipes. Keeping
        // long-running pipe reader threads attached to RNW can destabilize the app
        // when gameplay starts updating quickly.
        auto requestedFfmpegPath = StringFromPayload(payload, "ffmpegPath");
        auto requestedArgs = ArgsFromPayload(payload);

        std::thread([requestedFfmpegPath, requestedArgs = std::move(requestedArgs), promise]() mutable {
            JSValueObject result;
            try
            {
                std::lock_guard<std::mutex> lock(g_processMutex);
                if (g_processActive && g_processInfo.hProcess)
                {
                    DWORD exitCode = 0;
                    if (GetExitCodeProcess(g_processInfo.hProcess, &exitCode) && exitCode == STILL_ACTIVE)
                    {
                        result["status"] = JSValue("live");
                        result["pid"] = JSValue(static_cast<double>(g_processInfo.dwProcessId));
                        result["error"] = JSValue("FFmpeg live process is already running");
                        promise.Resolve(result);
                        return;
                    }
                    ResetActiveProcessHandles();
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

                STARTUPINFOW si{};
                si.cb = sizeof(si);

                PROCESS_INFORMATION pi{};
                auto command = BuildCommandLine(ffmpegPath, args);
                std::vector<wchar_t> commandLine(command.begin(), command.end());
                commandLine.push_back(L'\0');

                BOOL ok = CreateProcessW(
                    nullptr,
                    commandLine.data(),
                    nullptr,
                    nullptr,
                    FALSE,
                    CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | BELOW_NORMAL_PRIORITY_CLASS,
                    nullptr,
                    nullptr,
                    &si,
                    &pi);

                if (!ok)
                {
                    result["status"] = JSValue("error");
                    result["pid"] = JSValue(0.0);
                    result["error"] = JSValue("CreateProcessW failed: " + WindowsErrorMessage(GetLastError()));
                    promise.Resolve(result);
                    return;
                }

                // CRASH-FIX v10: do not wait/probe the newly created FFmpeg process here.
                // Some GPU encoder/device failures terminate ffmpeg with an access violation
                // immediately after CreateProcessW. Waiting on that crash from the RNW native
                // module and then retrying encoders has repeatedly destabilized the gameplay app.
                // Launch FFmpeg in a fire-and-forget style and let the app remain isolated.

                g_processInfo = pi;
                g_stdinWrite = nullptr;
                g_stderrRead = nullptr;
                g_stderrSummary = "FFmpeg started fire-and-forget; stderr is intentionally not captured for app stability.";
                g_processActive = true;

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
                    if (GetExitCodeProcess(g_processInfo.hProcess, &exitCode) && exitCode == STILL_ACTIVE)
                    {
                        TerminateProcess(g_processInfo.hProcess, 0);
                        WaitForSingleObject(g_processInfo.hProcess, 2000);
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
