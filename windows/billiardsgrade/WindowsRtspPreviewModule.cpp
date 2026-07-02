#include "pch.h"
#include "WindowsRtspPreviewModule.h"
#include "JSValue.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>


using namespace winrt;
using namespace winrt::Microsoft::ReactNative;

namespace
{
    std::mutex g_mutex;
    std::mutex g_recordLogMutex;
    PROCESS_INFORMATION g_processInfo{};
    bool g_processActive = false;
    std::wstring g_outputPath;
    std::wstring g_lastCommand;
    std::string g_lastError;
    std::string g_stderrSummary;
    PROCESS_INFORMATION g_recordProcessInfo{};
    bool g_recordProcessActive = false;
    HANDLE g_recordStdinWrite = nullptr;
    std::wstring g_recordOutputPath;
    std::wstring g_recordRequestedOutputPath;
    std::wstring g_recordCommand;
    std::chrono::steady_clock::time_point g_recordStartedAt{};
    std::string g_recordLastError;
    std::string g_recordStderrSummary;
    DWORD g_recordLastExitCode = 259;
    std::string g_previewUrl;
    std::string g_previewTransport = "tcp";
    std::string g_previewFfmpegPathRequest;
    double g_previewFps = 4.0;

    // Keep this module buildable across React Native Windows templates that
    // expose only a restricted subset of Win32 macros. 259 is the documented
    // kProcessStillActive process exit code returned by GetExitCodeProcess.
    constexpr DWORD kProcessStillActive = 259;

#ifndef HANDLE_FLAG_INHERIT
    constexpr DWORD HANDLE_FLAG_INHERIT = 0x00000001;
#endif
#ifndef STARTF_USESTDHANDLES
    constexpr DWORD STARTF_USESTDHANDLES = 0x00000100;
#endif

    constexpr DWORD kStderrSummaryMaxChars = 4000;
    constexpr DWORD kCreateNoWindow = 0x08000000;
    constexpr DWORD kStartfUseShowWindow = 0x00000001;
    constexpr WORD kSwHide = 0;

    std::wstring ToWide(std::string const &value)
    {
        if (value.empty())
        {
            return L"";
        }
        int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0);
        if (size <= 0)
        {
            return std::wstring(value.begin(), value.end());
        }
        std::wstring output(size, L'\0');
        MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), output.data(), size);
        return output;
    }

    std::string ToUtf8(std::wstring const &value)
    {
        if (value.empty())
        {
            return "";
        }
        int size = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
        if (size <= 0)
        {
            return std::string(value.begin(), value.end());
        }
        std::string output(size, '\0');
        WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), output.data(), size, nullptr, nullptr);
        return output;
    }

    std::string StringFromPayload(JSValueObject const &payload, char const *key)
    {
        auto it = payload.find(key);
        if (it == payload.end() || it->second.Type() != JSValueType::String)
        {
            return "";
        }
        return it->second.AsString();
    }

    double DoubleFromPayload(JSValueObject const &payload, char const *key, double fallback)
    {
        auto it = payload.find(key);
        if (it == payload.end())
        {
            return fallback;
        }
        if (it->second.Type() == JSValueType::Double || it->second.Type() == JSValueType::Int64)
        {
            return it->second.AsDouble();
        }
        return fallback;
    }

    std::wstring GetEnvVar(std::wstring const &name)
    {
        DWORD needed = GetEnvironmentVariableW(name.c_str(), nullptr, 0);
        if (needed == 0)
        {
            return L"";
        }
        std::wstring value(needed, L'\0');
        DWORD written = GetEnvironmentVariableW(name.c_str(), value.data(), needed);
        if (written == 0)
        {
            return L"";
        }
        value.resize(written);
        return value;
    }

    std::wstring ModuleDirectory()
    {
        wchar_t buffer[MAX_PATH]{};
        DWORD written = GetModuleFileNameW(nullptr, buffer, MAX_PATH);
        if (written == 0 || written >= MAX_PATH)
        {
            return L"";
        }
        std::wstring path(buffer, written);
        auto slash = path.find_last_of(L"\\/");
        return slash == std::wstring::npos ? L"" : path.substr(0, slash);
    }

    std::wstring JoinPath(std::wstring left, std::wstring const &right)
    {
        if (left.empty())
        {
            return right;
        }
        if (left.back() != L'\\' && left.back() != L'/')
        {
            left.push_back(L'\\');
        }
        return left + right;
    }

    bool EnsureDirectory(std::wstring const &path)
    {
        if (path.empty())
        {
            return false;
        }

        std::wstring normalized = path;
        std::replace(normalized.begin(), normalized.end(), L'/', L'\\');

        if (GetFileAttributesW(normalized.c_str()) != INVALID_FILE_ATTRIBUTES)
        {
            return true;
        }

        size_t pos = 0;
        while ((pos = normalized.find(L'\\', pos + 1)) != std::wstring::npos)
        {
            std::wstring part = normalized.substr(0, pos);
            if (part.size() > 3 && GetFileAttributesW(part.c_str()) == INVALID_FILE_ATTRIBUTES)
            {
                CreateDirectoryW(part.c_str(), nullptr);
            }
        }

        if (CreateDirectoryW(normalized.c_str(), nullptr))
        {
            return true;
        }
        return GetLastError() == ERROR_ALREADY_EXISTS;
    }

    std::wstring Quote(std::wstring const &value)
    {
        std::wstring escaped = L"\"";
        for (wchar_t ch : value)
        {
            if (ch == L'\"')
            {
                escaped += L"\\\"";
            }
            else
            {
                escaped.push_back(ch);
            }
        }
        escaped += L"\"";
        return escaped;
    }

    bool FileExistsAndHasData(std::wstring const &path)
    {
        WIN32_FILE_ATTRIBUTE_DATA data{};
        if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &data))
        {
            return false;
        }
        ULARGE_INTEGER size{};
        size.HighPart = data.nFileSizeHigh;
        size.LowPart = data.nFileSizeLow;
        return size.QuadPart > 0;
    }

    uint64_t FileSizeBytes(std::wstring const &path)
    {
        WIN32_FILE_ATTRIBUTE_DATA data{};
        if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &data))
        {
            return 0;
        }
        ULARGE_INTEGER size{};
        size.HighPart = data.nFileSizeHigh;
        size.LowPart = data.nFileSizeLow;
        return size.QuadPart;
    }

    std::wstring ParentDirectory(std::wstring const &path)
    {
        auto slash = path.find_last_of(L"\\/");
        return slash == std::wstring::npos ? L"" : path.substr(0, slash);
    }

    std::wstring EnsureMp4Output(std::wstring path)
    {
        auto slash = path.find_last_of(L"\\/");
        auto dot = path.find_last_of(L'.');
        if (dot != std::wstring::npos && (slash == std::wstring::npos || dot > slash))
        {
            return path.substr(0, dot) + L".mp4";
        }
        return path + L".mp4";
    }


    std::wstring SafeFileStem(std::wstring value)
    {
        auto slash = value.find_last_of(L"\\/");
        if (slash != std::wstring::npos)
        {
            value = value.substr(slash + 1);
        }
        auto dot = value.find_last_of(L'.');
        if (dot != std::wstring::npos)
        {
            value = value.substr(0, dot);
        }
        for (auto &ch : value)
        {
            if (ch == L' ' || ch == L':' || ch == L'/' || ch == L'\\' || ch == L'"' || ch == L'<' || ch == L'>' || ch == L'|' || ch == L'?' || ch == L'*')
            {
                ch = L'_';
            }
        }
        return value.empty() ? L"rtsp-record" : value;
    }

    std::wstring BuildSafeRtspRecordPath(std::wstring const &requestedPath)
    {
        auto localAppData = GetEnvVar(L"LOCALAPPDATA");
        if (localAppData.empty())
        {
            localAppData = GetEnvVar(L"TEMP");
        }
        auto recordDir = JoinPath(localAppData, L"AplusScore\\RtspRecord");
        EnsureDirectory(recordDir);
        auto nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        std::wstringstream name;
        name << SafeFileStem(requestedPath) << L"_" << nowMs << L".mp4";
        return JoinPath(recordDir, name.str());
    }

    bool CopyFinalRecordingToRequestedPath(std::wstring const &tempPath, std::wstring const &requestedPath)
    {
        if (tempPath.empty())
        {
            return false;
        }
        if (requestedPath.empty() || tempPath == requestedPath)
        {
            return FileExistsAndHasData(tempPath);
        }
        if (!FileExistsAndHasData(tempPath))
        {
            return false;
        }
        auto parent = ParentDirectory(requestedPath);
        if (!parent.empty())
        {
            EnsureDirectory(parent);
        }
        DeleteFileW(requestedPath.c_str());
        return CopyFileW(tempPath.c_str(), requestedPath.c_str(), FALSE) == TRUE && FileExistsAndHasData(requestedPath);
    }

    void AppendStderrSummary(std::string const &chunk)
    {
        if (chunk.empty())
        {
            return;
        }

        g_stderrSummary += chunk;
        if (g_stderrSummary.size() > kStderrSummaryMaxChars)
        {
            g_stderrSummary.erase(0, g_stderrSummary.size() - kStderrSummaryMaxChars);
        }
    }

    void AppendRecordStderrSummary(std::string const &chunk)
    {
        if (chunk.empty())
        {
            return;
        }

        std::lock_guard<std::mutex> lock(g_recordLogMutex);
        g_recordStderrSummary += chunk;
        if (g_recordStderrSummary.size() > kStderrSummaryMaxChars)
        {
            g_recordStderrSummary.erase(0, g_recordStderrSummary.size() - kStderrSummaryMaxChars);
        }
    }

    void StartRecordStderrDrainThread(HANDLE stderrRead)
    {
        if (!stderrRead)
        {
            return;
        }

        std::thread([stderrRead]() {
            char buffer[1024]{};
            DWORD read = 0;
            while (ReadFile(stderrRead, buffer, static_cast<DWORD>(sizeof(buffer) - 1), &read, nullptr) && read > 0)
            {
                AppendRecordStderrSummary(std::string(buffer, buffer + read));
                read = 0;
            }
            CloseHandle(stderrRead);
        }).detach();
    }

    void DrainPipeNonBlocking(HANDLE pipe)
    {
        if (!pipe)
        {
            return;
        }

        DWORD available = 0;
        while (PeekNamedPipe(pipe, nullptr, 0, nullptr, &available, nullptr) && available > 0)
        {
            char buffer[512]{};
            DWORD toRead = std::min<DWORD>(available, static_cast<DWORD>(sizeof(buffer) - 1));
            DWORD read = 0;
            if (!ReadFile(pipe, buffer, toRead, &read, nullptr) || read == 0)
            {
                break;
            }
            AppendStderrSummary(std::string(buffer, buffer + read));
        }
    }

    std::wstring SearchPathForExecutable(std::wstring const &name)
    {
        if (name.empty())
        {
            return L"";
        }

        auto isExecutableFile = [](std::wstring const &path) -> bool {
            if (path.empty())
            {
                return false;
            }
            DWORD attr = GetFileAttributesW(path.c_str());
            return attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY);
        };

        if (name.find(L'\\') != std::wstring::npos || name.find(L'/') != std::wstring::npos)
        {
            return isExecutableFile(name) ? name : L"";
        }

        auto pathValue = GetEnvVar(L"PATH");
        size_t start = 0;
        while (start <= pathValue.size())
        {
            size_t end = pathValue.find(L';', start);
            std::wstring dir = end == std::wstring::npos
                ? pathValue.substr(start)
                : pathValue.substr(start, end - start);

            if (!dir.empty())
            {
                if (dir.front() == L'\"' && dir.back() == L'\"' && dir.size() >= 2)
                {
                    dir = dir.substr(1, dir.size() - 2);
                }

                auto candidate = JoinPath(dir, name);
                if (isExecutableFile(candidate))
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

    std::wstring ResolveFfmpeg(std::string const &requested)
    {
        std::vector<std::wstring> candidates;
        auto requestedWide = ToWide(requested);
        if (!requestedWide.empty() && requestedWide != L"ffmpeg" && requestedWide != L"ffmpeg.exe")
        {
            candidates.push_back(requestedWide);
        }

        auto localAppData = GetEnvVar(L"LOCALAPPDATA");
        if (!localAppData.empty())
        {
            candidates.push_back(JoinPath(localAppData, L"AplusScore\\ffmpeg\\ffmpeg.exe"));
            candidates.push_back(JoinPath(localAppData, L"Microsoft\\WinGet\\Links\\ffmpeg.exe"));
        }

        auto userProfile = GetEnvVar(L"USERPROFILE");
        if (!userProfile.empty())
        {
            candidates.push_back(JoinPath(userProfile, L"AppData\\Local\\AplusScore\\ffmpeg\\ffmpeg.exe"));
            candidates.push_back(JoinPath(userProfile, L"AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe"));
        }

        candidates.push_back(L"C:\\ffmpeg\\bin\\ffmpeg.exe");
        auto moduleDir = ModuleDirectory();
        if (!moduleDir.empty())
        {
            candidates.push_back(JoinPath(moduleDir, L"Assets\\ffmpeg\\ffmpeg.exe"));
            candidates.push_back(JoinPath(moduleDir, L"ffmpeg.exe"));
        }

        auto fromPath = SearchPathForExecutable(L"ffmpeg.exe");
        if (!fromPath.empty())
        {
            candidates.push_back(fromPath);
        }
        candidates.push_back(L"ffmpeg.exe");

        for (auto const &candidate : candidates)
        {
            if (candidate == L"ffmpeg.exe")
            {
                return candidate;
            }
            DWORD attr = GetFileAttributesW(candidate.c_str());
            if (attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY))
            {
                return candidate;
            }
        }

        return L"ffmpeg.exe";
    }

    std::string WindowsErrorMessage(DWORD error)
    {
        LPWSTR buffer = nullptr;
        DWORD size = FormatMessageW(
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
        return ToUtf8(message);
    }

    void StopLocked()
    {
        if (g_processActive && g_processInfo.hProcess)
        {
            DWORD exitCode = 0;
            if (GetExitCodeProcess(g_processInfo.hProcess, &exitCode) && exitCode == kProcessStillActive)
            {
                TerminateProcess(g_processInfo.hProcess, 0);
                WaitForSingleObject(g_processInfo.hProcess, 1500);
            }
        }

        if (g_processInfo.hThread)
        {
            CloseHandle(g_processInfo.hThread);
        }
        if (g_processInfo.hProcess)
        {
            CloseHandle(g_processInfo.hProcess);
        }
        g_processInfo = PROCESS_INFORMATION{};
        g_processActive = false;
    }


    void StopRecordLocked()
    {
        g_recordLastExitCode = kProcessStillActive;
        if (g_recordProcessActive && g_recordProcessInfo.hProcess)
        {
            DWORD exitCode = 0;
            if (GetExitCodeProcess(g_recordProcessInfo.hProcess, &exitCode) && exitCode == kProcessStillActive)
            {
                // MP4 must be finalized gracefully. Ask ffmpeg to quit by writing
                // "q" to stdin; only force-kill after a long timeout.
                if (g_recordStdinWrite)
                {
                    DWORD written = 0;
                    const char quitCommand[] = "q\n";
                    WriteFile(g_recordStdinWrite, quitCommand, static_cast<DWORD>(sizeof(quitCommand) - 1), &written, nullptr);
                    FlushFileBuffers(g_recordStdinWrite);
                    CloseHandle(g_recordStdinWrite);
                    g_recordStdinWrite = nullptr;
                }

                DWORD waitResult = WaitForSingleObject(g_recordProcessInfo.hProcess, 18000);
                if (waitResult == WAIT_TIMEOUT)
                {
                    g_recordLastError = "FFmpeg recorder did not stop after q; force-terminated";
                    TerminateProcess(g_recordProcessInfo.hProcess, 2);
                    WaitForSingleObject(g_recordProcessInfo.hProcess, 3000);
                }
            }

            if (GetExitCodeProcess(g_recordProcessInfo.hProcess, &exitCode))
            {
                g_recordLastExitCode = exitCode;
            }
        }

        if (g_recordStdinWrite)
        {
            CloseHandle(g_recordStdinWrite);
            g_recordStdinWrite = nullptr;
        }
        if (g_recordProcessInfo.hThread)
        {
            CloseHandle(g_recordProcessInfo.hThread);
        }
        if (g_recordProcessInfo.hProcess)
        {
            CloseHandle(g_recordProcessInfo.hProcess);
        }
        g_recordProcessInfo = PROCESS_INFORMATION{};
        g_recordProcessActive = false;
    }

    bool LaunchHiddenProcess(std::wstring const &command, PROCESS_INFORMATION &processInfo)
    {
        STARTUPINFOW si{};
        si.cb = sizeof(si);
        si.dwFlags |= kStartfUseShowWindow;
        si.wShowWindow = kSwHide;

        std::vector<wchar_t> commandLine(command.begin(), command.end());
        commandLine.push_back(L'\0');

        return CreateProcessW(
            nullptr,
            commandLine.data(),
            nullptr,
            nullptr,
            FALSE,
            kCreateNoWindow,
            nullptr,
            nullptr,
            &si,
            &processInfo) == TRUE;
    }

    bool LaunchRecordProcess(std::wstring const &command, PROCESS_INFORMATION &processInfo, HANDLE &stdinWrite)
    {
        stdinWrite = nullptr;

        SECURITY_ATTRIBUTES pipeAttributes{};
        pipeAttributes.nLength = sizeof(pipeAttributes);
        pipeAttributes.bInheritHandle = TRUE;
        pipeAttributes.lpSecurityDescriptor = nullptr;

        HANDLE stdinRead = nullptr;
        HANDLE stderrRead = nullptr;
        HANDLE stderrWrite = nullptr;

        if (!CreatePipe(&stdinRead, &stdinWrite, &pipeAttributes, 0))
        {
            return false;
        }
        SetHandleInformation(stdinWrite, HANDLE_FLAG_INHERIT, 0);

        if (!CreatePipe(&stderrRead, &stderrWrite, &pipeAttributes, 0))
        {
            CloseHandle(stdinRead);
            CloseHandle(stdinWrite);
            stdinRead = nullptr;
            stdinWrite = nullptr;
            return false;
        }
        SetHandleInformation(stderrRead, HANDLE_FLAG_INHERIT, 0);

        STARTUPINFOW si{};
        si.cb = sizeof(si);
        si.dwFlags |= kStartfUseShowWindow | STARTF_USESTDHANDLES;
        si.wShowWindow = kSwHide;
        si.hStdInput = stdinRead;
        si.hStdError = stderrWrite;
        si.hStdOutput = stderrWrite;

        std::vector<wchar_t> commandLine(command.begin(), command.end());
        commandLine.push_back(L'\0');

        BOOL ok = CreateProcessW(
            nullptr,
            commandLine.data(),
            nullptr,
            nullptr,
            TRUE,
            kCreateNoWindow,
            nullptr,
            nullptr,
            &si,
            &processInfo);

        CloseHandle(stdinRead);
        CloseHandle(stderrWrite);

        if (!ok)
        {
            CloseHandle(stdinWrite);
            CloseHandle(stderrRead);
            stdinWrite = nullptr;
            return false;
        }

        StartRecordStderrDrainThread(stderrRead);
        return true;
    }

    std::wstring BuildCommandLine(std::wstring const &ffmpegPath, std::vector<std::wstring> const &args)
    {
        std::wstring command = Quote(ffmpegPath);
        for (auto const &arg : args)
        {
            command += L" ";
            command += Quote(arg);
        }
        return command;
    }

    void FillStatus(JSValueObject &result)
    {
        result["active"] = JSValue(g_processActive);
        result["imagePath"] = JSValue(ToUtf8(g_outputPath));
        result["stderrSummary"] = JSValue(g_stderrSummary);
        result["error"] = JSValue(g_lastError);
    }
}

namespace winrt::billiardsgrade::implementation
{
    void WindowsRtspPreviewModule::Start(JSValueObject payload, ReactPromise<JSValueObject> promise) noexcept
    {
        auto url = StringFromPayload(payload, "url");
        auto transport = StringFromPayload(payload, "transport");
        if (transport != "udp")
        {
            transport = "tcp";
        }
        auto ffmpegPathRequest = StringFromPayload(payload, "ffmpegPath");
        auto fps = std::max(1.0, std::min(10.0, DoubleFromPayload(payload, "fps", 4.0)));
        auto timeoutMs = static_cast<int>(std::max(3000.0, std::min(20000.0, DoubleFromPayload(payload, "timeoutMs", 12000.0))));

        {
            std::lock_guard<std::mutex> previewLock(g_mutex);
            g_previewUrl = url;
            g_previewTransport = transport;
            g_previewFfmpegPathRequest = ffmpegPathRequest;
            g_previewFps = fps;
        }

        std::thread([url, transport, ffmpegPathRequest, fps, timeoutMs, promise]() mutable {
            JSValueObject result;
            try
            {
                if (url.empty())
                {
                    result["status"] = JSValue("error");
                    result["error"] = JSValue("Missing RTSP URL");
                    promise.Resolve(result);
                    return;
                }

                std::unique_lock<std::mutex> lock(g_mutex);
                StopLocked();
                g_lastError.clear();
                g_stderrSummary.clear();

                auto localAppData = GetEnvVar(L"LOCALAPPDATA");
                if (localAppData.empty())
                {
                    localAppData = GetEnvVar(L"TEMP");
                }
                auto previewDir = JoinPath(localAppData, L"AplusScore\\RtspPreview");
                EnsureDirectory(previewDir);
                g_outputPath = JoinPath(previewDir, L"rtsp-preview.jpg");
                DeleteFileW(g_outputPath.c_str());

                auto ffmpegPath = ResolveFfmpeg(ffmpegPathRequest);
                std::vector<std::wstring> args = {
                    L"-hide_banner",
                    L"-loglevel", L"warning",
                    L"-nostdin",
                    L"-y",
                    L"-rtsp_transport", ToWide(transport),
                    L"-i", ToWide(url),
                    L"-an",
                    L"-sn",
                    L"-dn",
                    L"-vf", L"fps=" + std::to_wstring(static_cast<int>(fps)) + L",scale=1280:-2",
                    L"-q:v", L"4",
                    L"-f", L"image2",
                    L"-update", L"1",
                    g_outputPath,
                };

                HANDLE stderrRead = nullptr;
                HANDLE stderrWrite = nullptr;
                SECURITY_ATTRIBUTES pipeAttributes{};
                pipeAttributes.nLength = sizeof(pipeAttributes);
                pipeAttributes.bInheritHandle = TRUE;
                pipeAttributes.lpSecurityDescriptor = nullptr;
                bool stderrPipeReady = false;
                if (CreatePipe(&stderrRead, &stderrWrite, &pipeAttributes, 0))
                {
                    SetHandleInformation(stderrRead, HANDLE_FLAG_INHERIT, 0);
                    stderrPipeReady = true;
                }

                STARTUPINFOW si{};
                si.cb = sizeof(si);
                si.dwFlags |= kStartfUseShowWindow;
                si.wShowWindow = kSwHide;
                if (stderrPipeReady)
                {
                    si.dwFlags |= STARTF_USESTDHANDLES;
                    si.hStdError = stderrWrite;
                    si.hStdOutput = stderrWrite;
                }

                auto command = BuildCommandLine(ffmpegPath, args);
                g_lastCommand = command;
                std::vector<wchar_t> commandLine(command.begin(), command.end());
                commandLine.push_back(L'\0');

                PROCESS_INFORMATION pi{};
                BOOL ok = CreateProcessW(
                    nullptr,
                    commandLine.data(),
                    nullptr,
                    nullptr,
                    stderrPipeReady ? TRUE : FALSE,
                    kCreateNoWindow,
                    nullptr,
                    nullptr,
                    &si,
                    &pi);

                if (stderrWrite)
                {
                    CloseHandle(stderrWrite);
                    stderrWrite = nullptr;
                }

                if (!ok)
                {
                    auto error = "CreateProcess ffmpeg failed: " + WindowsErrorMessage(GetLastError());
                    g_lastError = error;
                    result["status"] = JSValue("error");
                    result["error"] = JSValue(error);
                    result["ffmpegPath"] = JSValue(ToUtf8(ffmpegPath));
                    if (stderrRead)
                    {
                        CloseHandle(stderrRead);
                        stderrRead = nullptr;
                    }
                    promise.Resolve(result);
                    return;
                }

                g_processInfo = pi;
                g_processActive = true;

                lock.unlock();

                auto startedAt = std::chrono::steady_clock::now();
                bool firstFrameReady = false;
                DWORD exitCode = kProcessStillActive;
                while (std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - startedAt).count() < timeoutMs)
                {
                    DrainPipeNonBlocking(stderrRead);
                    if (FileExistsAndHasData(g_outputPath))
                    {
                        firstFrameReady = true;
                        break;
                    }

                    {
                        std::lock_guard<std::mutex> guard(g_mutex);
                        if (g_processInfo.hProcess && GetExitCodeProcess(g_processInfo.hProcess, &exitCode) && exitCode != kProcessStillActive)
                        {
                            break;
                        }
                    }

                    std::this_thread::sleep_for(std::chrono::milliseconds(250));
                }

                DrainPipeNonBlocking(stderrRead);

                lock.lock();
                if (!firstFrameReady)
                {
                    std::string error = "RTSP FFmpeg preview did not produce a video frame";
                    if (!g_stderrSummary.empty())
                    {
                        error += ": " + g_stderrSummary;
                    }
                    g_lastError = error;
                    StopLocked();
                    if (stderrRead)
                    {
                        CloseHandle(stderrRead);
                        stderrRead = nullptr;
                    }
                    result["status"] = JSValue("error");
                    result["error"] = JSValue(error);
                    result["imagePath"] = JSValue(ToUtf8(g_outputPath));
                    result["ffmpegPath"] = JSValue(ToUtf8(ffmpegPath));
                    result["stderrSummary"] = JSValue(g_stderrSummary);
                    promise.Resolve(result);
                    return;
                }

                result["status"] = JSValue("preview");
                result["active"] = JSValue(true);
                result["imagePath"] = JSValue(ToUtf8(g_outputPath));
                result["ffmpegPath"] = JSValue(ToUtf8(ffmpegPath));
                result["stderrSummary"] = JSValue(g_stderrSummary);
                result["transport"] = JSValue(transport);
                result["error"] = JSValue("");
                promise.Resolve(result);
            }
            catch (std::exception const &ex)
            {
                std::lock_guard<std::mutex> lock(g_mutex);
                g_lastError = ex.what();
                StopLocked();
                result["status"] = JSValue("error");
                result["error"] = JSValue(g_lastError);
                promise.Resolve(result);
            }
            catch (...)
            {
                std::lock_guard<std::mutex> lock(g_mutex);
                g_lastError = "Unknown RTSP preview exception";
                StopLocked();
                result["status"] = JSValue("error");
                result["error"] = JSValue(g_lastError);
                promise.Resolve(result);
            }
        }).detach();
    }

    void WindowsRtspPreviewModule::StartRecording(JSValueObject payload, ReactPromise<JSValueObject> promise) noexcept
    {
        auto url = StringFromPayload(payload, "url");
        auto transport = StringFromPayload(payload, "transport");
        if (transport != "udp")
        {
            transport = "tcp";
        }
        auto outputPathRequest = StringFromPayload(payload, "outputPath");
        auto ffmpegPathRequest = StringFromPayload(payload, "ffmpegPath");

        std::thread([url, transport, outputPathRequest, ffmpegPathRequest, promise]() mutable {
            JSValueObject result;
            try
            {
                if (url.empty())
                {
                    result["status"] = JSValue("error");
                    result["error"] = JSValue("Missing RTSP URL");
                    promise.Resolve(result);
                    return;
                }
                if (outputPathRequest.empty())
                {
                    result["status"] = JSValue("error");
                    result["error"] = JSValue("Missing RTSP recording output path");
                    promise.Resolve(result);
                    return;
                }

                std::unique_lock<std::mutex> lock(g_mutex);
                StopRecordLocked();
                g_recordLastError.clear();
                g_recordStderrSummary.clear();
                g_recordLastExitCode = kProcessStillActive;

                auto requestedOutputPath = EnsureMp4Output(ToWide(outputPathRequest));
                // Packaged Windows apps can create/list files in VideosLibrary via
                // StorageFolder APIs, but an app-launched ffmpeg.exe process is not
                // granted the same brokered VideosLibrary permission.  If ffmpeg writes
                // directly to C:\Users\...\Videos it exits with "Permission denied".
                // Therefore ffmpeg records to app-local storage first; JS then commits
                // the finalized MP4 into Videos/Aplus Score through WindowsVideoStorageModule.
                auto outputPath = BuildSafeRtspRecordPath(requestedOutputPath);
                auto parent = ParentDirectory(outputPath);
                if (!parent.empty())
                {
                    EnsureDirectory(parent);
                }
                DeleteFileW(outputPath.c_str());
                g_recordRequestedOutputPath = requestedOutputPath;

                // Replace preview-only ffmpeg with one single RTSP session that writes:
                //   1) preview JPG frames for UI
                //   2) real MP4 video for Replay/History
                // This prevents Imou/Dahua cameras from rejecting a second RTSP session.
                StopLocked();
                if (g_outputPath.empty())
                {
                    auto localAppData = GetEnvVar(L"LOCALAPPDATA");
                    if (localAppData.empty())
                    {
                        localAppData = GetEnvVar(L"TEMP");
                    }
                    auto previewDir = JoinPath(localAppData, L"AplusScore\\RtspPreview");
                    EnsureDirectory(previewDir);
                    g_outputPath = JoinPath(previewDir, L"rtsp-preview.jpg");
                }

                auto ffmpegPath = ResolveFfmpeg(ffmpegPathRequest.empty() ? g_previewFfmpegPathRequest : ffmpegPathRequest);
                auto previewFps = std::max(1.0, std::min(8.0, g_previewFps));
                std::wstringstream filter;
                filter << L"[0:v]split=2[prev][rec];"
                       << L"[prev]fps=" << static_cast<int>(previewFps) << L",scale=1280:-2[prevout];"
                       << L"[rec]scale=1280:-2[recout]";

                std::vector<std::wstring> args = {
                    L"-hide_banner",
                    L"-loglevel", L"warning",
                    L"-nostats",
                    L"-y",
                    L"-rtsp_transport", ToWide(transport),
                    L"-i", ToWide(url),
                    L"-an",
                    L"-sn",
                    L"-dn",
                    L"-filter_complex", filter.str(),
                    // Output #1: low-rate preview frame for React Native Windows UI.
                    L"-map", L"[prevout]",
                    L"-q:v", L"4",
                    L"-f", L"image2",
                    L"-update", L"1",
                    g_outputPath,
                    // Output #2: real MP4 video for Replay/History. Re-encode to avoid
                    // H.265/copy muxing failures on Imou/Dahua streams.
                    L"-map", L"[recout]",
                    L"-c:v", L"libx264",
                    L"-preset", L"ultrafast",
                    L"-tune", L"zerolatency",
                    L"-pix_fmt", L"yuv420p",
                    L"-movflags", L"+faststart",
                    L"-f", L"mp4",
                    outputPath,
                };

                auto command = BuildCommandLine(ffmpegPath, args);
                g_recordCommand = command;
                PROCESS_INFORMATION pi{};
                HANDLE stdinWrite = nullptr;
                if (!LaunchRecordProcess(command, pi, stdinWrite))
                {
                    auto error = "CreateProcess ffmpeg recorder failed: " + WindowsErrorMessage(GetLastError());
                    g_recordLastError = error;
                    result["status"] = JSValue("error");
                    result["error"] = JSValue(error);
                    result["path"] = JSValue(ToUtf8(outputPath));
                    result["ffmpegPath"] = JSValue(ToUtf8(ffmpegPath));
                    result["command"] = JSValue(ToUtf8(command));
                    promise.Resolve(result);
                    return;
                }

                g_recordProcessInfo = pi;
                g_recordStdinWrite = stdinWrite;
                g_recordProcessActive = true;
                g_recordOutputPath = outputPath;
                g_recordStartedAt = std::chrono::steady_clock::now();

                lock.unlock();
                auto startedAt = std::chrono::steady_clock::now();
                bool processExitedEarly = false;
                bool frameOrOutputSeen = false;
                DWORD exitCode = kProcessStillActive;
                while (std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - startedAt).count() < 3500)
                {
                    if (FileExistsAndHasData(g_outputPath) || GetFileAttributesW(outputPath.c_str()) != INVALID_FILE_ATTRIBUTES)
                    {
                        frameOrOutputSeen = true;
                        break;
                    }
                    {
                        std::lock_guard<std::mutex> guard(g_mutex);
                        if (g_recordProcessInfo.hProcess && GetExitCodeProcess(g_recordProcessInfo.hProcess, &exitCode) && exitCode != kProcessStillActive)
                        {
                            processExitedEarly = true;
                            g_recordLastExitCode = exitCode;
                            break;
                        }
                    }
                    std::this_thread::sleep_for(std::chrono::milliseconds(250));
                }

                lock.lock();
                if (processExitedEarly)
                {
                    std::string error = "FFmpeg recorder exited before creating MP4";
                    if (!g_recordStderrSummary.empty())
                    {
                        error += ": " + g_recordStderrSummary;
                    }
                    g_recordLastError = error;
                    StopRecordLocked();
                    result["status"] = JSValue("error");
                    result["error"] = JSValue(error);
                    result["path"] = JSValue(ToUtf8(outputPath));
                    result["outputPath"] = JSValue(ToUtf8(outputPath));
                    result["ffmpegPath"] = JSValue(ToUtf8(ffmpegPath));
                    result["command"] = JSValue(ToUtf8(command));
                    result["exitCode"] = JSValue(static_cast<double>(g_recordLastExitCode));
                    result["stderrSummary"] = JSValue(g_recordStderrSummary);
                    promise.Resolve(result);
                    return;
                }

                result["status"] = JSValue("recording");
                result["path"] = JSValue(ToUtf8(outputPath));
                result["outputPath"] = JSValue(ToUtf8(outputPath));
                result["tempPath"] = JSValue(ToUtf8(outputPath));
                result["backend"] = JSValue("ffmpeg-rtsp-mp4");
                result["transport"] = JSValue(transport);
                result["ffmpegPath"] = JSValue(ToUtf8(ffmpegPath));
                result["command"] = JSValue(ToUtf8(command));
                result["fileExistsOnStart"] = JSValue(GetFileAttributesW(outputPath.c_str()) != INVALID_FILE_ATTRIBUTES);
                result["frameOrOutputSeen"] = JSValue(frameOrOutputSeen);
                result["stderrSummary"] = JSValue(g_recordStderrSummary);
                result["error"] = JSValue("");
                promise.Resolve(result);
            }
            catch (std::exception const &ex)
            {
                std::lock_guard<std::mutex> lock(g_mutex);
                g_recordLastError = ex.what();
                StopRecordLocked();
                result["status"] = JSValue("error");
                result["error"] = JSValue(g_recordLastError);
                promise.Resolve(result);
            }
            catch (...)
            {
                std::lock_guard<std::mutex> lock(g_mutex);
                g_recordLastError = "Unknown RTSP record exception";
                StopRecordLocked();
                result["status"] = JSValue("error");
                result["error"] = JSValue(g_recordLastError);
                promise.Resolve(result);
            }
        }).detach();
    }

    void WindowsRtspPreviewModule::StopRecording(ReactPromise<JSValueObject> promise) noexcept
    {
        std::thread([promise]() mutable {
            JSValueObject result;
            std::lock_guard<std::mutex> lock(g_mutex);
            auto tempOutputPath = g_recordOutputPath;
            auto requestedOutputPath = g_recordRequestedOutputPath.empty() ? tempOutputPath : g_recordRequestedOutputPath;
            auto startedAt = g_recordStartedAt;
            StopRecordLocked();
            auto outputPath = FileExistsAndHasData(requestedOutputPath) ? requestedOutputPath : tempOutputPath;
            auto copiedToRequested = (outputPath == requestedOutputPath) && FileExistsAndHasData(requestedOutputPath);

            // Restore live preview after the recording/replay segment is finalized.
            // JS will keep showing the last frame until this process writes new frames.
            if (!g_previewUrl.empty() && !g_outputPath.empty())
            {
                auto ffmpegPath = ResolveFfmpeg(g_previewFfmpegPathRequest);
                auto previewFps = std::max(1.0, std::min(10.0, g_previewFps));
                std::vector<std::wstring> previewArgs = {
                    L"-hide_banner",
                    L"-loglevel", L"warning",
                    L"-nostdin",
                    L"-y",
                    L"-rtsp_transport", ToWide(g_previewTransport == "udp" ? "udp" : "tcp"),
                    L"-i", ToWide(g_previewUrl),
                    L"-an", L"-sn", L"-dn",
                    L"-vf", L"fps=" + std::to_wstring(static_cast<int>(previewFps)) + L",scale=1280:-2",
                    L"-q:v", L"4",
                    L"-f", L"image2",
                    L"-update", L"1",
                    g_outputPath,
                };
                PROCESS_INFORMATION previewPi{};
                if (LaunchHiddenProcess(BuildCommandLine(ffmpegPath, previewArgs), previewPi))
                {
                    g_processInfo = previewPi;
                    g_processActive = true;
                }
            }
            auto durationMs = startedAt.time_since_epoch().count() == 0
                ? 0
                : static_cast<int64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - startedAt).count());
            auto sizeBytes = FileSizeBytes(outputPath);
            bool fileOk = sizeBytes > 0;
            std::string finalError = g_recordLastError;
            if (!fileOk)
            {
                finalError = "record-failed: FFmpeg did not create a valid MP4 file";
                if (!g_recordStderrSummary.empty())
                {
                    finalError += ": " + g_recordStderrSummary;
                }
            }
            result["status"] = JSValue(fileOk ? "stopped" : "error");
            result["active"] = JSValue(false);
            result["path"] = JSValue(ToUtf8(outputPath));
            result["outputPath"] = JSValue(ToUtf8(outputPath));
            result["tempPath"] = JSValue(ToUtf8(tempOutputPath));
            result["requestedPath"] = JSValue(ToUtf8(requestedOutputPath));
            result["copiedToRequestedPath"] = JSValue(copiedToRequested);
            result["fileExists"] = JSValue(GetFileAttributesW(outputPath.c_str()) != INVALID_FILE_ATTRIBUTES);
            result["fileSize"] = JSValue(static_cast<double>(sizeBytes));
            result["durationSeconds"] = JSValue(static_cast<double>(durationMs) / 1000.0);
            result["backend"] = JSValue("ffmpeg-rtsp-mp4");
            result["exitCode"] = JSValue(static_cast<double>(g_recordLastExitCode));
            result["command"] = JSValue(ToUtf8(g_recordCommand));
            result["stderrSummary"] = JSValue(g_recordStderrSummary);
            result["error"] = JSValue(finalError);
            promise.Resolve(result);
        }).detach();
    }

    void WindowsRtspPreviewModule::Stop(ReactPromise<JSValueObject> promise) noexcept
    {
        std::thread([promise]() mutable {
            JSValueObject result;
            std::lock_guard<std::mutex> lock(g_mutex);
            StopLocked();
            result["status"] = JSValue("stopped");
            result["active"] = JSValue(false);
            result["imagePath"] = JSValue(ToUtf8(g_outputPath));
            promise.Resolve(result);
        }).detach();
    }

    void WindowsRtspPreviewModule::Status(ReactPromise<JSValueObject> promise) noexcept
    {
        std::thread([promise]() mutable {
            JSValueObject result;
            std::lock_guard<std::mutex> lock(g_mutex);
            if (g_processActive && g_processInfo.hProcess)
            {
                DWORD exitCode = kProcessStillActive;
                if (GetExitCodeProcess(g_processInfo.hProcess, &exitCode) && exitCode != kProcessStillActive)
                {
                    StopLocked();
                    g_lastError = "RTSP preview process exited";
                }
            }
            FillStatus(result);
            promise.Resolve(result);
        }).detach();
    }
}
