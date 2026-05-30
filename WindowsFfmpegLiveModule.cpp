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
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <thread>
#include <vector>

#include <winrt/Windows.Devices.Enumeration.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Media.Capture.h>
#include <winrt/Windows.Media.Capture.Frames.h>
#include <winrt/Windows.Media.MediaProperties.h>
#include <winrt/Windows.Storage.Streams.h>


// WinRT memory access helper without <robuffer.h>.
// v50d uses SoftwareBitmap::LockBuffer instead of SoftwareBitmap::CopyToBuffer
// because CopyToBuffer can throw on some camera frame buffers inside RNW packaged
// apps. LockBuffer gives us the raw plane pointer and stride so we can write rows
// into FFmpeg's rawvideo stdin safely.
struct __declspec(uuid("5B0D3235-4DBA-4D44-865E-8F1D0E4FD04D")) IMemoryBufferByteAccess : public ::IUnknown
{
    virtual HRESULT __stdcall GetBuffer(BYTE **value, uint32_t *capacity) = 0;
};

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

#ifndef CREATE_NEW_CONSOLE
#define CREATE_NEW_CONSOLE 0x00000010
#endif

#ifndef DETACHED_PROCESS
#define DETACHED_PROCESS 0x00000008
#endif

#ifndef CREATE_BREAKAWAY_FROM_JOB
#define CREATE_BREAKAWAY_FROM_JOB 0x01000000
#endif

#ifndef BELOW_NORMAL_PRIORITY_CLASS
#define BELOW_NORMAL_PRIORITY_CLASS 0x00004000
#endif

#ifndef STD_INPUT_HANDLE
#define STD_INPUT_HANDLE ((DWORD)-10)
#endif


#ifndef SW_SHOWNORMAL
#define SW_SHOWNORMAL 1
#endif

#ifndef SW_MINIMIZE
#define SW_MINIMIZE 6
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
    std::atomic<bool> g_externalScheduledLive{false};
    std::string g_stderrSummary;

    // v50d: MediaCapture -> raw BGRA pipe -> FFmpeg.  This avoids FFmpeg/DirectShow
    // opening the webcam at all.  DirectShow worked from manual PowerShell, but failed
    // when launched by the packaged RNW app.  The app's own MediaCapture path is the
    // path that already works for preview/local recording, so live now uses it too.
    winrt::Windows::Media::Capture::MediaCapture g_pipeMediaCapture{nullptr};
    winrt::Windows::Media::Capture::Frames::MediaFrameReader g_pipeFrameReader{nullptr};
    winrt::event_token g_pipeFrameArrivedToken{};
    std::atomic<bool> g_pipeFramePumpActive{false};
    std::atomic<bool> g_pipeFrameWriteBusy{false};
    int g_pipeFrameWidth = 640;
    int g_pipeFrameHeight = 480;

    std::wstring ToWide(std::string const &value)
    {
        return std::wstring(winrt::to_hstring(value).c_str());
    }

    std::string ToUtf8(std::wstring const &value)
    {
        return winrt::to_string(winrt::hstring(value));
    }

    std::string FirstLine(std::string const &text)
    {
        auto pos = text.find_first_of("\r\n");
        if (pos == std::string::npos)
        {
            return text;
        }
        return text.substr(0, pos);
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

    std::wstring GetEnvPath(std::wstring const &name);

    bool EnsureDirectoryRecursive(std::wstring const &dir)
    {
        if (dir.empty())
        {
            return false;
        }
        if (GetFileAttributesW(dir.c_str()) != INVALID_FILE_ATTRIBUTES)
        {
            return true;
        }

        auto parent = GetDirectoryName(dir);
        if (!parent.empty() && parent != dir)
        {
            EnsureDirectoryRecursive(parent);
        }

        if (CreateDirectoryW(dir.c_str(), nullptr))
        {
            return true;
        }

        DWORD error = GetLastError();
        return error == ERROR_ALREADY_EXISTS;
    }

    std::wstring GetRealUserProfileDirectory()
    {
        auto profile = GetEnvPath(L"USERPROFILE");
        auto lowerProfile = profile;
        std::transform(lowerProfile.begin(), lowerProfile.end(), lowerProfile.begin(), [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });

        // In MSIX/RNW builds, LOCALAPPDATA often points to:
        //   C:\Users\...\AppData\Local\Packages\<package>\AC
        // FFmpeg launched from there can enumerate DirectShow devices but fail
        // BindToObject when opening the webcam. Prefer the real desktop user
        // profile so FFmpeg runs from a normal desktop-app path.
        if (!profile.empty() && lowerProfile.find(L"\\packages\\") == std::wstring::npos)
        {
            return profile;
        }

        auto drive = GetEnvPath(L"HOMEDRIVE");
        auto homePath = GetEnvPath(L"HOMEPATH");
        if (!drive.empty() && !homePath.empty())
        {
            return drive + homePath;
        }

        auto userName = GetEnvPath(L"USERNAME");
        if (!userName.empty())
        {
            return L"C:\\Users\\" + userName;
        }

        return L"C:\\Users\\Administrator";
    }

    std::wstring GetRealLocalAppDataDirectory()
    {
        auto profile = GetRealUserProfileDirectory();
        if (!profile.empty())
        {
            return profile + L"\\AppData\\Local";
        }
        return GetEnvPath(L"LOCALAPPDATA");
    }

    std::wstring PrepareWritableBundledFfmpegCopy(std::wstring const &moduleDir)
    {
        if (moduleDir.empty())
        {
            return L"";
        }

        auto source = moduleDir + L"\\Assets\\ffmpeg\\ffmpeg.exe";
        if (!FileExists(source))
        {
            return L"";
        }

        auto localAppData = GetRealLocalAppDataDirectory();
        if (localAppData.empty())
        {
            localAppData = GetEnvPath(L"LOCALAPPDATA");
        }
        if (localAppData.empty())
        {
            return L"";
        }

        auto targetDir = localAppData + L"\\AplusScore\\ffmpeg";
        auto target = targetDir + L"\\ffmpeg.exe";

        if (!EnsureDirectoryRecursive(targetDir))
        {
            return L"";
        }

        // v40 camera-only fix: copy the bundled FFmpeg to the real desktop user's
        // LocalAppData (not the MSIX package AC folder). On the user's machine,
        // FFmpeg inside the package AC path could list "2K Web Camera" but failed
        // DirectShow BindToObject when opening it. Launching from a normal desktop
        // path gives FFmpeg the same camera access model as running it manually.
        CopyFileW(source.c_str(), target.c_str(), FALSE);

        return FileExists(target) ? target : L"";
    }

    std::wstring GetAplusScoreDebugDirectory()
    {
        // v46: Write the FFmpeg debug script/log to the process TEMP folder, not
        // Videos or manually reconstructed LocalAppData. On the user's machine
        // the app can write match videos via WinRT, but raw C++ _wfopen could not
        // create C:\Users\Administrator\Videos\Aplus Score\LiveDebug\*.cmd.
        // TEMP is the safest raw Win32 writable location for the packaged RNW
        // process, while still being easy to open from PowerShell.
        std::wstring temp(32768, L'\0');
        DWORD len = GetTempPathW(static_cast<DWORD>(temp.size()), temp.data());
        if (len > 0 && len < temp.size())
        {
            temp.resize(len);
            while (!temp.empty() && (temp.back() == L'\\' || temp.back() == L'/'))
            {
                temp.pop_back();
            }
            auto dir = temp + L"\\AplusScoreLiveDebug";
            if (EnsureDirectoryRecursive(dir))
            {
                return dir;
            }
        }

        auto localAppData = GetEnvPath(L"LOCALAPPDATA");
        if (!localAppData.empty())
        {
            auto dir = localAppData + L"\\AplusScoreLiveDebug";
            if (EnsureDirectoryRecursive(dir))
            {
                return dir;
            }
        }

        return L"";
    }

    std::wstring GetFfmpegLiveLogPath()
    {
        auto dir = GetAplusScoreDebugDirectory();
        return dir.empty() ? L"" : dir + L"\\ffmpeg-live.log";
    }

    std::wstring GetFfmpegLiveScriptPath()
    {
        auto dir = GetAplusScoreDebugDirectory();
        return dir.empty() ? L"" : dir + L"\\start-youtube-live.cmd";
    }

    bool WriteUtf8TextFile(std::wstring const &path, std::string const &text)
    {
        if (path.empty())
        {
            return false;
        }
        auto parent = GetDirectoryName(path);
        if (!parent.empty())
        {
            EnsureDirectoryRecursive(parent);
        }
        FILE *file = nullptr;
        if (_wfopen_s(&file, path.c_str(), L"wb") != 0 || file == nullptr)
        {
            return false;
        }
        fwrite(text.data(), 1, text.size(), file);
        fclose(file);
        return true;
    }

    void AppendTextToFile(std::wstring const &path, std::string const &text)
    {
        if (path.empty())
        {
            return;
        }
        auto parent = GetDirectoryName(path);
        if (!parent.empty())
        {
            EnsureDirectoryRecursive(parent);
        }
        FILE *file = nullptr;
        if (_wfopen_s(&file, path.c_str(), L"ab") != 0 || file == nullptr)
        {
            return;
        }
        fwrite(text.data(), 1, text.size(), file);
        fclose(file);
    }

    HANDLE OpenInheritedAppendFile(std::wstring const &)
    {
        return INVALID_HANDLE_VALUE;
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

    bool LooksLikePackagedOrBuildFfmpeg(std::wstring const &path)
    {
        auto lower = path;
        std::transform(lower.begin(), lower.end(), lower.begin(), [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });
        return
            lower.find(L"\\appx\\assets\\ffmpeg\\ffmpeg.exe") != std::wstring::npos ||
            (lower.find(L"\\windows\\x64\\") != std::wstring::npos && lower.find(L"\\appx\\assets\\ffmpeg\\ffmpeg.exe") != std::wstring::npos) ||
            lower.find(L"\\appdata\\local\\packages\\") != std::wstring::npos ||
            lower.find(L"\\ac\\aplusscore\\ffmpeg\\ffmpeg.exe") != std::wstring::npos;
    }

    std::wstring NormalizeFfmpegPath(std::string const &value)
    {
        auto requested = Trim(ToWide(value));
        std::replace(requested.begin(), requested.end(), L'/', L'\\');

        auto lower = requested;
        std::transform(lower.begin(), lower.end(), lower.begin(), [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });

        const bool wantsAuto = requested.empty() || lower == L"ffmpeg" || lower == L"ffmpeg.exe" || lower == L"path:ffmpeg";
        const bool requestedIsPackagedOrBuildAsset = LooksLikePackagedOrBuildFfmpeg(requested);
        const auto moduleDir = GetModuleDirectory();

        std::vector<std::wstring> candidates;

        // v41 camera-only fix: a saved/debug path like
        // windows\x64\Debug\...\AppX\Assets\ffmpeg\ffmpeg.exe can enumerate
        // DirectShow devices but then fail BindToObject when opening the webcam.
        // Prefer a normal desktop-user copy first. Only honor a requested path
        // first when it is a real user supplied desktop path.
        if (!wantsAuto && !requestedIsPackagedOrBuildAsset)
        {
            candidates.push_back(requested);
            if (!IsAbsolutePath(requested) && !moduleDir.empty())
            {
                candidates.push_back(moduleDir + L"\\" + requested);
            }
        }

        if (!moduleDir.empty())
        {
            auto writableBundled = PrepareWritableBundledFfmpegCopy(moduleDir);
            if (!writableBundled.empty())
            {
                candidates.push_back(writableBundled);
            }
        }

        auto userProfile = GetRealUserProfileDirectory();
        if (!userProfile.empty())
        {
            candidates.push_back(userProfile + L"\\AppData\\Local\\AplusScore\\ffmpeg\\ffmpeg.exe");
            candidates.push_back(userProfile + L"\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe");
        }

        auto userName = GetEnvPath(L"USERNAME");
        if (!userName.empty())
        {
            candidates.push_back(L"C:\\Users\\" + userName + L"\\AppData\\Local\\AplusScore\\ffmpeg\\ffmpeg.exe");
            candidates.push_back(L"C:\\Users\\" + userName + L"\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe");
        }
        candidates.push_back(L"C:\\Users\\Administrator\\AppData\\Local\\AplusScore\\ffmpeg\\ffmpeg.exe");
        candidates.push_back(L"C:\\Users\\Administrator\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe");

        candidates.push_back(L"C:\\ffmpeg\\bin\\ffmpeg.exe");

        auto localAppData = GetRealLocalAppDataDirectory();
        if (!localAppData.empty())
        {
            candidates.push_back(localAppData + L"\\AplusScore\\ffmpeg\\ffmpeg.exe");
            candidates.push_back(localAppData + L"\\Microsoft\\WinGet\\Links\\ffmpeg.exe");
        }

        auto searched = SearchPathForExecutable(L"ffmpeg.exe");
        if (!searched.empty())
        {
            candidates.push_back(searched);
        }

        if (!wantsAuto && requestedIsPackagedOrBuildAsset)
        {
            // Keep the packaged path only as a last-resort fallback. If this is
            // used, logs will show it clearly and the user can run the desktop
            // camera access test below.
            candidates.push_back(requested);
        }

        if (!moduleDir.empty())
        {
            candidates.push_back(moduleDir + L"\\Assets\\ffmpeg\\ffmpeg.exe");
            candidates.push_back(moduleDir + L"\\ffmpeg.exe");
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

    void PushUniquePath(std::vector<std::wstring> &paths, std::wstring const &path)
    {
        if (path.empty() || !FileExists(path))
        {
            return;
        }
        for (auto const &existing : paths)
        {
            auto left = existing;
            auto right = path;
            std::transform(left.begin(), left.end(), left.begin(), [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });
            std::transform(right.begin(), right.end(), right.begin(), [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });
            if (left == right)
            {
                return;
            }
        }
        paths.push_back(path);
    }

    std::vector<std::wstring> GetDeviceProbeFfmpegCandidates(std::string const &requestedValue)
    {
        std::vector<std::wstring> paths;

        // First try whatever the app resolved. If this is the package-local copy
        // and it cannot enumerate DirectShow devices, we will then try normal
        // desktop FFmpeg locations that PowerShell can see.
        PushUniquePath(paths, NormalizeFfmpegPath(requestedValue));

        PushUniquePath(paths, L"C:\\ffmpeg\\bin\\ffmpeg.exe");

        auto localAppData = GetRealLocalAppDataDirectory();
        if (!localAppData.empty())
        {
            PushUniquePath(paths, localAppData + L"\\AplusScore\\ffmpeg\\ffmpeg.exe");
            PushUniquePath(paths, localAppData + L"\\Microsoft\\WinGet\\Links\\ffmpeg.exe");
        }

        auto userProfile = GetRealUserProfileDirectory();
        if (!userProfile.empty())
        {
            PushUniquePath(paths, userProfile + L"\\AppData\\Local\\AplusScore\\ffmpeg\\ffmpeg.exe");
            PushUniquePath(paths, userProfile + L"\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe");
        }

        auto userName = GetEnvPath(L"USERNAME");
        if (!userName.empty())
        {
            PushUniquePath(paths, L"C:\\Users\\" + userName + L"\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe");
        }
        PushUniquePath(paths, L"C:\\Users\\Administrator\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe");

        PushUniquePath(paths, SearchPathForExecutable(L"ffmpeg.exe"));

        const auto moduleDir = GetModuleDirectory();
        if (!moduleDir.empty())
        {
            PushUniquePath(paths, moduleDir + L"\\Assets\\ffmpeg\\ffmpeg.exe");
            auto writableBundled = PrepareWritableBundledFfmpegCopy(moduleDir);
            PushUniquePath(paths, writableBundled);
        }

        return paths;
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

    std::wstring BuildCmdWrappedCommandLine(std::wstring const &ffmpegPath, std::vector<std::string> const &args, std::wstring const &logPath)
    {
        // v44: Run the DirectShow live command through cmd.exe, matching the
        // user's successful manual PowerShell/cmd launch more closely than a
        // raw hidden CreateProcess call. Redirection is done by cmd, so native
        // code does not need inherited stderr pipes, which previously changed
        // DirectShow behavior.
        auto cmdExe = GetEnvPath(L"ComSpec");
        if (cmdExe.empty())
        {
            cmdExe = L"C:\\Windows\\System32\\cmd.exe";
        }

        std::wstring inner = Quote(ffmpegPath);
        for (auto const &arg : args)
        {
            inner += L" ";
            inner += Quote(ToWide(arg));
        }
        if (!logPath.empty())
        {
            inner += L" >> ";
            inner += Quote(logPath);
            inner += L" 2>&1";
        }

        // cmd.exe /d /s /c ""C:\...\ffmpeg.exe" "-arg" ... >> "log" 2>&1"
        std::wstring command = Quote(cmdExe);
        command += L" /d /s /c \"";
        command += inner;
        command += L"\"";
        return command;
    }

    std::string EscapeBatchText(std::string value)
    {
        // Redirection/meta characters are not expected in normal FFmpeg args, but
        // escape the common dangerous ones for the generated .cmd diagnostic file.
        std::string out;
        out.reserve(value.size());
        for (char ch : value)
        {
            if (ch == '^' || ch == '&' || ch == '|' || ch == '<' || ch == '>')
            {
                out.push_back('^');
            }
            out.push_back(ch);
        }
        return out;
    }

    std::string QuoteBatchArg(std::string const &value)
    {
        std::string out = "\"";
        for (char ch : value)
        {
            if (ch == '"')
            {
                out += "\\\"";
            }
            else
            {
                out.push_back(ch);
            }
        }
        out += "\"";
        return out;
    }

    std::string BuildFfmpegBatchFile(std::wstring const &ffmpegPath, std::vector<std::string> const &args, std::wstring const &logPath)
    {
        std::string log = ToUtf8(logPath);
        std::string content;
        content += "@echo off\r\n";
        content += "setlocal EnableExtensions\r\n";
        content += "echo ==== APLUS FFmpeg live start %DATE% %TIME% ==== > " + QuoteBatchArg(log) + "\r\n";
        content += "echo WorkingDir=%CD% >> " + QuoteBatchArg(log) + "\r\n";
        content += "echo Command= >> " + QuoteBatchArg(log) + "\r\n";
        content += QuoteBatchArg(ToUtf8(ffmpegPath));
        for (auto const &arg : args)
        {
            content += " ";
            content += QuoteBatchArg(EscapeBatchText(arg));
        }
        content += " >> " + QuoteBatchArg(log) + " 2>&1\r\n";
        content += "set APLUS_FFMPEG_EXIT=%ERRORLEVEL%\r\n";
        content += "echo ==== APLUS FFmpeg exited %APLUS_FFMPEG_EXIT% %DATE% %TIME% ==== >> " + QuoteBatchArg(log) + "\r\n";
        content += "exit /b %APLUS_FFMPEG_EXIT%\r\n";
        return content;
    }

    std::wstring BuildCmdBatchLauncherCommandLine(std::wstring const &scriptPath)
    {
        auto cmdExe = GetEnvPath(L"ComSpec");
        if (cmdExe.empty())
        {
            cmdExe = L"C:\\Windows\\System32\\cmd.exe";
        }

        // v47: Do not use cmd /S here. On the user's Windows 10 box,
        // CreateProcess succeeded but cmd exited before the .cmd body ran.
        // The safest batch invocation is the plain command interpreter form:
        //   cmd.exe /d /c call "C:\path\script.cmd"
        // `call` forces cmd to execute the batch file in the current command
        // context and avoids cmd /S quote-stripping edge cases.
        std::wstring command = Quote(cmdExe);
        command += L" /d /c call ";
        command += Quote(scriptPath);
        return command;
    }


    std::wstring GetSchtasksPath()
    {
        auto systemRoot = GetEnvPath(L"SystemRoot");
        if (!systemRoot.empty())
        {
            auto path = systemRoot + L"\\System32\\schtasks.exe";
            if (FileExists(path))
            {
                return path;
            }
        }
        return L"C:\\Windows\\System32\\schtasks.exe";
    }

    void KillProcessTree(DWORD pid)
    {
        if (!pid)
        {
            return;
        }
        std::wstring command = L"taskkill.exe /PID " + std::to_wstring(pid) + L" /T /F";
        std::vector<wchar_t> commandLine(command.begin(), command.end());
        commandLine.push_back(L'\0');

        STARTUPINFOW si{};
        si.cb = sizeof(si);
        PROCESS_INFORMATION pi{};
        BOOL ok = CreateProcessW(
            nullptr,
            commandLine.data(),
            nullptr,
            nullptr,
            FALSE,
            CREATE_NO_WINDOW,
            nullptr,
            nullptr,
            &si,
            &pi);
        if (ok)
        {
            WaitForSingleObject(pi.hProcess, 2500);
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
        }
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

    std::string PreviewText(std::string text)
    {
        // v32: keep enough DirectShow output for JS/native diagnostics. The first
        // line alone hides the "Alternative name" that FFmpeg can use when the
        // friendly camera name fails to BindToObject from the RNW child process.
        if (text.size() > 4096)
        {
            text = text.substr(0, 4096);
        }
        return text;
    }

    bool PushUniqueString(std::vector<std::string> &items, std::string const &value)
    {
        if (value.empty())
        {
            return false;
        }
        for (auto const &item : items)
        {
            if (item == value)
            {
                return false;
            }
        }
        items.push_back(value);
        return true;
    }

    JSValueArray ParseDshowDevices(std::string const &output, bool wantVideo)
    {
        // v32 CAMERA FIX:
        // The app can enumerate a friendly name like "2K Web Camera", but launching
        // FFmpeg from the RNW/MSIX process can then fail with:
        //   Unable to BindToObject for 2K Web Camera
        // DirectShow also prints an Alternative name (@device_pnp_.../ @device_cm_...),
        // and FFmpeg accepts that stable moniker in video=... / audio=.... Prefer
        // the alternative moniker for the actual command; fall back to friendly name
        // only when no alternative exists.
        std::vector<std::string> alternativeDevices;
        std::vector<std::string> friendlyDevices;
        bool inVideo = false;
        bool inAudio = false;
        bool lastDeviceWasWantedType = false;
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
                lastDeviceWasWantedType = false;
                continue;
            }
            if (lower.find("directshow audio devices") != std::string::npos)
            {
                inVideo = false;
                inAudio = true;
                lastDeviceWasWantedType = false;
                continue;
            }

            auto firstQuote = line.find('"');
            auto secondQuote = firstQuote == std::string::npos ? std::string::npos : line.find('"', firstQuote + 1);
            if (firstQuote == std::string::npos || secondQuote == std::string::npos || secondQuote <= firstQuote + 1)
            {
                continue;
            }

            auto name = line.substr(firstQuote + 1, secondQuote - firstQuote - 1);
            const bool isAlternativeName =
                lower.find("alternative name") != std::string::npos ||
                name.rfind("@device_", 0) == 0 ||
                name.rfind("@device", 0) == 0;

            if (isAlternativeName)
            {
                if (lastDeviceWasWantedType)
                {
                    PushUniqueString(alternativeDevices, name);
                }
                continue;
            }

            const bool nameLooksAudio =
                lower.find("microphone") != std::string::npos ||
                lower.find("audio") != std::string::npos ||
                lower.find("realtek") != std::string::npos ||
                lower.find("speaker") != std::string::npos ||
                lower.find("stereo mix") != std::string::npos;

            const bool lineSaysVideo =
                lower.find("(video)") != std::string::npos ||
                // Some FFmpeg 8.x builds print camera lines as "2K Web Camera" (none).
                // Treat a compact non-audio quoted line as video.
                (lower.find("(none)") != std::string::npos && !nameLooksAudio) ||
                (!inAudio && !nameLooksAudio && lower.find("(audio)") == std::string::npos && lower.find("microphone") == std::string::npos);
            const bool lineSaysAudio = lower.find("(audio)") != std::string::npos || nameLooksAudio;
            const bool matchesWantedType = wantVideo
                ? (lineSaysVideo || (inVideo && !lineSaysAudio))
                : (lineSaysAudio || (inAudio && !lineSaysVideo));

            lastDeviceWasWantedType = matchesWantedType;
            if (!matchesWantedType)
            {
                continue;
            }

            PushUniqueString(friendlyDevices, name);
        }

        JSValueArray devices;
        // v34: Return friendly names first. The alternative @device_pnp moniker is
        // useful for diagnostics, but this app log shows FFmpeg fails to start with
        // `Unable to BindToObject` when the moniker is passed as video=... from RNW.
        // The friendly name "2K Web Camera" is what successfully recorded camtest.mp4.
        for (auto const &name : friendlyDevices)
        {
            devices.push_back(JSValue(name));
        }
        for (auto const &name : alternativeDevices)
        {
            devices.push_back(JSValue(name));
        }

        return devices;
    }


    void AppendStderrSummary(std::string const &text);

    bool IsVideoInputArgument(std::string const &value)
    {
        auto lower = value;
        std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        return lower.rfind("video=", 0) == 0;
    }

    std::vector<std::string> ArgsAfterDirectShowVideoInput(std::vector<std::string> const &args)
    {
        bool sawDshow = false;
        for (size_t index = 0; index < args.size(); ++index)
        {
            auto lower = args[index];
            std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
            if (lower == "dshow")
            {
                sawDshow = true;
                continue;
            }
            if (sawDshow && lower == "-i" && index + 1 < args.size() && IsVideoInputArgument(args[index + 1]))
            {
                return std::vector<std::string>(args.begin() + static_cast<std::ptrdiff_t>(index + 2), args.end());
            }
        }
        return {};
    }

    std::vector<std::string> BuildMediaCapturePipeArgs(std::vector<std::string> const &originalArgs, int width, int height)
    {
        std::vector<std::string> pipeArgs{
            "-hide_banner",
            "-loglevel",
            "info",
            "-fflags",
            "nobuffer",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgra",
            "-video_size",
            std::to_string(width) + "x" + std::to_string(height),
            "-framerate",
            "30",
            "-i",
            "pipe:0",
        };

        auto tail = ArgsAfterDirectShowVideoInput(originalArgs);
        if (!tail.empty())
        {
            pipeArgs.insert(pipeArgs.end(), tail.begin(), tail.end());
        }
        return pipeArgs;
    }

    bool WriteAllToFfmpegStdin(BYTE const *data, uint32_t totalBytes) noexcept
    {
        if (!data || totalBytes == 0 || !g_stdinWrite)
        {
            return false;
        }

        uint32_t totalWritten = 0;
        while (totalWritten < totalBytes)
        {
            const uint32_t remaining = totalBytes - totalWritten;
            const DWORD chunk = static_cast<DWORD>(std::min<uint32_t>(remaining, 1024 * 1024));
            DWORD written = 0;
            BOOL ok = WriteFile(g_stdinWrite, data + totalWritten, chunk, &written, nullptr);
            if (!ok || written == 0)
            {
                DWORD error = GetLastError();
                AppendStderrSummary("\n[MediaCapturePipe v50d] WriteFile to FFmpeg stdin failed: " + WindowsErrorMessage(error));
                g_pipeFramePumpActive = false;
                return false;
            }
            totalWritten += written;
        }
        return true;
    }

    bool WriteSoftwareBitmapToFfmpeg(winrt::Windows::Graphics::Imaging::SoftwareBitmap const &inputBitmap) noexcept
    {
        try
        {
            using namespace winrt::Windows::Graphics::Imaging;

            if (!g_pipeFramePumpActive || !g_stdinWrite || !inputBitmap)
            {
                return false;
            }

            bool expected = false;
            if (!g_pipeFrameWriteBusy.compare_exchange_strong(expected, true))
            {
                // Drop frames rather than blocking the camera callback. FFmpeg receives
                // the latest realtime frames and the stream stays responsive.
                return false;
            }

            winrt::Windows::Graphics::Imaging::SoftwareBitmap bitmap = inputBitmap;
            winrt::Windows::Graphics::Imaging::SoftwareBitmap converted{nullptr};
            if (bitmap.BitmapPixelFormat() != BitmapPixelFormat::Bgra8)
            {
                converted = SoftwareBitmap::Convert(
                    bitmap,
                    BitmapPixelFormat::Bgra8,
                    BitmapAlphaMode::Ignore);
                bitmap = converted;
            }

            const uint32_t width = static_cast<uint32_t>(bitmap.PixelWidth());
            const uint32_t height = static_cast<uint32_t>(bitmap.PixelHeight());
            const uint32_t bytesPerPixel = 4;
            const uint32_t rowBytes = width * bytesPerPixel;
            const uint32_t frameSize = rowBytes * height;
            if (frameSize == 0 || static_cast<int>(width) != g_pipeFrameWidth || static_cast<int>(height) != g_pipeFrameHeight)
            {
                AppendStderrSummary("\n[MediaCapturePipe v50d] frame size mismatch actual=" +
                    std::to_string(width) + "x" + std::to_string(height) +
                    " expected=" + std::to_string(g_pipeFrameWidth) + "x" + std::to_string(g_pipeFrameHeight));
                g_pipeFrameWriteBusy = false;
                return false;
            }

            auto bitmapBuffer = bitmap.LockBuffer(BitmapBufferAccessMode::Read);
            auto reference = bitmapBuffer.CreateReference();
            BYTE *planeBytes = nullptr;
            uint32_t capacity = 0;
            auto access = reference.as<IMemoryBufferByteAccess>();
            HRESULT hr = access->GetBuffer(&planeBytes, &capacity);
            if (FAILED(hr) || planeBytes == nullptr || capacity == 0)
            {
                AppendStderrSummary("\n[MediaCapturePipe v50d] IMemoryBufferByteAccess::GetBuffer failed hr=" + std::to_string(static_cast<long>(hr)));
                g_pipeFrameWriteBusy = false;
                return false;
            }

            auto plane = bitmapBuffer.GetPlaneDescription(0);
            const int32_t stride = plane.Stride;
            const int32_t startIndex = plane.StartIndex;
            if (stride <= 0 || startIndex < 0 || static_cast<uint32_t>(startIndex) >= capacity)
            {
                AppendStderrSummary("\n[MediaCapturePipe v50d] invalid plane description stride=" + std::to_string(stride) +
                    " start=" + std::to_string(startIndex) + " capacity=" + std::to_string(capacity));
                g_pipeFrameWriteBusy = false;
                return false;
            }

            const BYTE *sourceStart = planeBytes + startIndex;
            bool success = false;
            if (static_cast<uint32_t>(stride) == rowBytes && static_cast<uint32_t>(startIndex) + frameSize <= capacity)
            {
                success = WriteAllToFfmpegStdin(sourceStart, frameSize);
            }
            else
            {
                // Some camera frames have padded rows. FFmpeg rawvideo expects contiguous
                // tightly packed BGRA rows, so collapse stride padding before writing.
                std::vector<BYTE> contiguous(frameSize);
                for (uint32_t row = 0; row < height; ++row)
                {
                    const uint64_t srcOffset = static_cast<uint64_t>(startIndex) + static_cast<uint64_t>(row) * static_cast<uint32_t>(stride);
                    if (srcOffset + rowBytes > capacity)
                    {
                        AppendStderrSummary("\n[MediaCapturePipe v50d] plane capacity too small row=" + std::to_string(row) +
                            " stride=" + std::to_string(stride) + " capacity=" + std::to_string(capacity));
                        g_pipeFrameWriteBusy = false;
                        return false;
                    }
                    std::memcpy(contiguous.data() + static_cast<size_t>(row) * rowBytes, planeBytes + srcOffset, rowBytes);
                }
                success = WriteAllToFfmpegStdin(contiguous.data(), frameSize);
            }

            g_pipeFrameWriteBusy = false;
            return success;
        }
        catch (winrt::hresult_error const &ex)
        {
            AppendStderrSummary("\n[MediaCapturePipe v50d] frame write hresult exception: " +
                winrt::to_string(ex.message()) + " hr=" + std::to_string(static_cast<long>(ex.code())));
            g_pipeFrameWriteBusy = false;
            return false;
        }
        catch (std::exception const &ex)
        {
            AppendStderrSummary(std::string("\n[MediaCapturePipe v50d] frame write exception: ") + ex.what());
            g_pipeFrameWriteBusy = false;
            return false;
        }
        catch (...)
        {
            AppendStderrSummary("\n[MediaCapturePipe v50d] frame write exception: unknown");
            g_pipeFrameWriteBusy = false;
            return false;
        }
    }

    winrt::Windows::Foundation::IAsyncAction StopMediaCapturePipeLiveAsync()
    {
        g_pipeFramePumpActive = false;
        g_pipeFrameWriteBusy = false;

        auto reader = g_pipeFrameReader;
        if (reader)
        {
            try
            {
                if (g_pipeFrameArrivedToken.value != 0)
                {
                    reader.FrameArrived(g_pipeFrameArrivedToken);
                    g_pipeFrameArrivedToken = {};
                }
            }
            catch (...) {}
            try
            {
                co_await reader.StopAsync();
            }
            catch (...) {}
            try
            {
                reader.Close();
            }
            catch (...) {}
        }
        g_pipeFrameReader = nullptr;

        auto media = g_pipeMediaCapture;
        if (media)
        {
            try
            {
                media.Close();
            }
            catch (...) {}
        }
        g_pipeMediaCapture = nullptr;
    }

    winrt::Windows::Foundation::IAsyncAction PrepareMediaCapturePipeLiveAsync(std::string const &preferredVideoDeviceNameUtf8)
    {
        using namespace winrt::Windows::Devices::Enumeration;
        using namespace winrt::Windows::Graphics::Imaging;
        using namespace winrt::Windows::Media::Capture;
        using namespace winrt::Windows::Media::Capture::Frames;
        using namespace winrt::Windows::Media::MediaProperties;

        co_await StopMediaCapturePipeLiveAsync();

        auto devices = co_await DeviceInformation::FindAllAsync(DeviceClass::VideoCapture);
        if (devices.Size() == 0)
        {
            throw winrt::hresult_error(E_FAIL, L"MediaCapture pipe live: no video capture device found");
        }

        DeviceInformation selected = devices.GetAt(0);
        auto preferredVideoDeviceName = Trim(ToWide(preferredVideoDeviceNameUtf8));
        auto lowerPreferredVideoDeviceName = preferredVideoDeviceName;
        std::transform(lowerPreferredVideoDeviceName.begin(), lowerPreferredVideoDeviceName.end(), lowerPreferredVideoDeviceName.begin(), [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });

        bool matchedPreferredDevice = false;
        for (auto const &device : devices)
        {
            auto name = std::wstring(device.Name().c_str());
            auto id = std::wstring(device.Id().c_str());
            auto lowerName = name;
            auto lowerId = id;
            std::transform(lowerName.begin(), lowerName.end(), lowerName.begin(), [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });
            std::transform(lowerId.begin(), lowerId.end(), lowerId.begin(), [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });

            if (!lowerPreferredVideoDeviceName.empty() &&
                (lowerName == lowerPreferredVideoDeviceName || lowerName.find(lowerPreferredVideoDeviceName) != std::wstring::npos ||
                 lowerId == lowerPreferredVideoDeviceName || lowerId.find(lowerPreferredVideoDeviceName) != std::wstring::npos))
            {
                selected = device;
                matchedPreferredDevice = true;
                break;
            }

            if (!matchedPreferredDevice &&
                (lowerName.find(L"2k web camera") != std::wstring::npos ||
                 lowerName.find(L"webcam") != std::wstring::npos ||
                 lowerName.find(L"usb") != std::wstring::npos ||
                 lowerId.find(L"usb") != std::wstring::npos ||
                 lowerId.find(L"vid_") != std::wstring::npos))
            {
                selected = device;
            }
        }

        MediaCaptureInitializationSettings settings;
        settings.StreamingCaptureMode(StreamingCaptureMode::Video);
        settings.VideoDeviceId(selected.Id());
        // v51: keep the live reader in shared-read mode so the app preview can stay open
        // while FFmpeg is pushing the same camera to YouTube.
        settings.SharingMode(MediaCaptureSharingMode::SharedReadOnly);
        settings.MemoryPreference(MediaCaptureMemoryPreference::Cpu);

        MediaCapture mediaCapture;
        co_await mediaCapture.InitializeAsync(settings);

        MediaFrameSource selectedSource{nullptr};
        for (auto const &pair : mediaCapture.FrameSources())
        {
            auto source = pair.Value();
            if (source && source.Info().SourceKind() == MediaFrameSourceKind::Color)
            {
                selectedSource = source;
                break;
            }
        }

        if (!selectedSource)
        {
            throw winrt::hresult_error(E_FAIL, L"MediaCapture pipe live: no color frame source found");
        }

        MediaFrameFormat chosenFormat{nullptr};
        MediaFrameFormat fallbackFormat{nullptr};
        for (auto const &format : selectedSource.SupportedFormats())
        {
            auto videoFormat = format.VideoFormat();
            if (!videoFormat)
            {
                continue;
            }
            const uint32_t width = videoFormat.Width();
            const uint32_t height = videoFormat.Height();
            if (!fallbackFormat && width > 0 && height > 0 && width <= 1280 && height <= 720)
            {
                fallbackFormat = format;
            }
            if (width == 640 && height == 480)
            {
                chosenFormat = format;
                break;
            }
        }
        if (!chosenFormat)
        {
            chosenFormat = fallbackFormat;
        }
        if (chosenFormat)
        {
            try
            {
                co_await selectedSource.SetFormatAsync(chosenFormat);
            }
            catch (...) {}
        }

        auto currentFormat = selectedSource.CurrentFormat();
        auto currentVideo = currentFormat ? currentFormat.VideoFormat() : nullptr;
        g_pipeFrameWidth = currentVideo ? static_cast<int>(currentVideo.Width()) : 640;
        g_pipeFrameHeight = currentVideo ? static_cast<int>(currentVideo.Height()) : 480;
        if (g_pipeFrameWidth <= 0 || g_pipeFrameHeight <= 0)
        {
            g_pipeFrameWidth = 640;
            g_pipeFrameHeight = 480;
        }

        auto reader = co_await mediaCapture.CreateFrameReaderAsync(selectedSource, MediaEncodingSubtypes::Bgra8());
        reader.AcquisitionMode(MediaFrameReaderAcquisitionMode::Realtime);

        g_pipeMediaCapture = mediaCapture;
        g_pipeFrameReader = reader;
    }

    winrt::Windows::Foundation::IAsyncAction StartMediaCapturePipeFrameReaderAsync()
    {
        using namespace winrt::Windows::Media::Capture::Frames;
        using namespace winrt::Windows::Graphics::Imaging;

        auto reader = g_pipeFrameReader;
        if (!reader)
        {
            throw winrt::hresult_error(E_FAIL, L"MediaCapture pipe live: frame reader was not prepared");
        }

        g_pipeFramePumpActive = true;
        g_pipeFrameArrivedToken = reader.FrameArrived([](MediaFrameReader const &sender, MediaFrameArrivedEventArgs const &) {
            if (!g_pipeFramePumpActive)
            {
                return;
            }
            try
            {
                auto frame = sender.TryAcquireLatestFrame();
                if (!frame)
                {
                    return;
                }
                auto videoFrame = frame.VideoMediaFrame();
                if (!videoFrame)
                {
                    return;
                }
                auto bitmap = videoFrame.SoftwareBitmap();
                if (!bitmap)
                {
                    return;
                }
                WriteSoftwareBitmapToFfmpeg(bitmap);
            }
            catch (...) {}
        });

        auto status = co_await reader.StartAsync();
        if (status != MediaFrameReaderStartStatus::Success)
        {
            g_pipeFramePumpActive = false;
            throw winrt::hresult_error(E_FAIL, L"MediaCapture pipe live: frame reader did not start");
        }
    }

    void StopMediaCapturePipeLiveBestEffort() noexcept
    {
        try
        {
            try { winrt::init_apartment(winrt::apartment_type::multi_threaded); } catch (...) {}
            StopMediaCapturePipeLiveAsync().get();
        }
        catch (...) {}
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
        // v31: stderr pipe is owned/closed by the background reader thread.
        // Closing it here can race with ReadFile and hide the real FFmpeg error.
        g_stderrRead = nullptr;
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

    bool ArgsContainDirectShowVideoInput(std::vector<std::string> const &args)
    {
        bool sawDshow = false;
        for (auto const &arg : args)
        {
            auto lower = arg;
            std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
            if (lower == "dshow")
            {
                sawDshow = true;
                continue;
            }
            if (sawDshow && lower.rfind("video=", 0) == 0)
            {
                return true;
            }
        }
        return false;
    }

    std::string ExtractDirectShowVideoDeviceName(std::vector<std::string> const &args)
    {
        bool sawDshow = false;
        for (size_t index = 0; index < args.size(); ++index)
        {
            auto lower = args[index];
            std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
            if (lower == "dshow")
            {
                sawDshow = true;
                continue;
            }
            if (sawDshow && lower == "-i" && index + 1 < args.size() && IsVideoInputArgument(args[index + 1]))
            {
                auto const &value = args[index + 1];
                if (value.size() > 6)
                {
                    return value.substr(6);
                }
                return "";
            }
        }
        return "";
    }
}

namespace winrt::billiardsgrade::implementation
{
    winrt::Windows::Foundation::IAsyncOperation<bool> WindowsCameraReleaseForExternalUseAsync();
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
                JSValueArray bestVideoDevices;
                JSValueArray bestAudioDevices;
                std::string bestError;
                std::string bestPath;
                std::string bestPreview;

                auto candidates = GetDeviceProbeFfmpegCandidates(ffmpegPath);
                for (auto const &path : candidates)
                {
                    auto output = RunProcessAndCapture(path, {"-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"}, 9000);
                    auto videoDevices = ParseDshowDevices(output.output, true);
                    auto audioDevices = ParseDshowDevices(output.output, false);
                    bestError = output.error.empty() ? (output.timedOut ? "ffmpeg dshow device list timed out" : "") : output.error;
                    bestPath = ToUtf8(path);
                    bestPreview = PreviewText(output.output);

                    // Device listing exits non-zero because input "dummy" is not real.
                    // That is expected. The only success criterion is whether the device
                    // names were printed and parsed.
                    if (!videoDevices.empty() || !audioDevices.empty())
                    {
                        // JSValueArray is move-only in React Native Windows, so do not
                        // copy-assign it here. Move the parsed arrays into the result
                        // buffers to keep the DirectShow multi-path probe buildable.
                        bestVideoDevices = std::move(videoDevices);
                        bestAudioDevices = std::move(audioDevices);
                        break;
                    }
                }

                result["videoDevices"] = JSValue(std::move(bestVideoDevices));
                result["audioDevices"] = JSValue(std::move(bestAudioDevices));
                result["ffmpegPath"] = JSValue(bestPath);
                result["error"] = JSValue(bestError);
                result["outputPreview"] = JSValue(bestPreview);
                promise.Resolve(result);
            }
            catch (std::exception const &ex)
            {
                result["videoDevices"] = JSValue(JSValueArray{});
                result["audioDevices"] = JSValue(JSValueArray{});
                result["ffmpegPath"] = JSValue(NormalizeFfmpegPathForResult(ffmpegPath));
                result["error"] = JSValue(ex.what());
                result["outputPreview"] = JSValue("");
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
                std::unique_lock<std::mutex> lock(g_processMutex);
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

                const bool isDirectShowVideoLive = ArgsContainDirectShowVideoInput(args);

                if (isDirectShowVideoLive)
                {
                    // v50: Do not let FFmpeg open the webcam through DirectShow anymore.
                    // The user's manual PowerShell test proved FFmpeg itself works, but every
                    // app/package-launched DirectShow attempt failed BindToObject.  Use the
                    // app's working Windows MediaCapture path and feed raw BGRA frames into
                    // FFmpeg stdin. FFmpeg now only encodes and pushes RTMPS to YouTube.
                    lock.unlock();
                    try { winrt::init_apartment(winrt::apartment_type::multi_threaded); } catch (...) {}
                    auto preferredVideoDeviceName = ExtractDirectShowVideoDeviceName(args);

                    try
                    {
                        PrepareMediaCapturePipeLiveAsync(preferredVideoDeviceName).get();
                    }
                    catch (winrt::hresult_error const &ex)
                    {
                        StopMediaCapturePipeLiveBestEffort();
                        lock.lock();
                        result["status"] = JSValue("error");
                        result["pid"] = JSValue(0.0);
                        result["error"] = JSValue("MediaCapture pipe live prepare failed: " + winrt::to_string(ex.message()));
                        promise.Resolve(result);
                        return;
                    }
                    catch (std::exception const &ex)
                    {
                        StopMediaCapturePipeLiveBestEffort();
                        lock.lock();
                        result["status"] = JSValue("error");
                        result["pid"] = JSValue(0.0);
                        result["error"] = JSValue(std::string("MediaCapture pipe live prepare failed: ") + ex.what());
                        promise.Resolve(result);
                        return;
                    }
                    catch (...)
                    {
                        StopMediaCapturePipeLiveBestEffort();
                        lock.lock();
                        result["status"] = JSValue("error");
                        result["pid"] = JSValue(0.0);
                        result["error"] = JSValue("MediaCapture pipe live prepare failed: unknown");
                        promise.Resolve(result);
                        return;
                    }

                    lock.lock();

                    SECURITY_ATTRIBUTES sa{};
                    sa.nLength = sizeof(SECURITY_ATTRIBUTES);
                    sa.bInheritHandle = TRUE;
                    sa.lpSecurityDescriptor = nullptr;

                    HANDLE stdinRead = nullptr;
                    HANDLE stdinWrite = nullptr;
                    HANDLE readPipe = nullptr;
                    HANDLE writePipe = nullptr;
                    if (!CreatePipe(&stdinRead, &stdinWrite, &sa, 0))
                    {
                        StopMediaCapturePipeLiveBestEffort();
                        result["status"] = JSValue("error");
                        result["pid"] = JSValue(0.0);
                        result["error"] = JSValue("CreatePipe stdin failed: " + WindowsErrorMessage(GetLastError()));
                        promise.Resolve(result);
                        return;
                    }
                    SetHandleInformation(stdinWrite, HANDLE_FLAG_INHERIT, 0);

                    if (!CreatePipe(&readPipe, &writePipe, &sa, 0))
                    {
                        CloseHandle(stdinRead);
                        CloseHandle(stdinWrite);
                        StopMediaCapturePipeLiveBestEffort();
                        result["status"] = JSValue("error");
                        result["pid"] = JSValue(0.0);
                        result["error"] = JSValue("CreatePipe stderr failed: " + WindowsErrorMessage(GetLastError()));
                        promise.Resolve(result);
                        return;
                    }
                    SetHandleInformation(readPipe, HANDLE_FLAG_INHERIT, 0);

                    STARTUPINFOW pipeSi{};
                    pipeSi.cb = sizeof(pipeSi);
                    pipeSi.dwFlags |= STARTF_USESTDHANDLES;
                    pipeSi.hStdInput = stdinRead;
                    pipeSi.hStdOutput = writePipe;
                    pipeSi.hStdError = writePipe;

                    auto pipeArgs = BuildMediaCapturePipeArgs(args, g_pipeFrameWidth, g_pipeFrameHeight);
                    auto command = BuildCommandLine(ffmpegPath, pipeArgs);
                    std::vector<wchar_t> commandLine(command.begin(), command.end());
                    commandLine.push_back(L'\0');

                    PROCESS_INFORMATION pi{};
                    DWORD launchFlags = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | BELOW_NORMAL_PRIORITY_CLASS;
                    BOOL ok = CreateProcessW(
                        nullptr,
                        commandLine.data(),
                        nullptr,
                        nullptr,
                        TRUE,
                        launchFlags,
                        nullptr,
                        nullptr,
                        &pipeSi,
                        &pi);

                    CloseHandle(stdinRead);
                    CloseHandle(writePipe);

                    if (!ok)
                    {
                        CloseHandle(stdinWrite);
                        CloseHandle(readPipe);
                        StopMediaCapturePipeLiveBestEffort();
                        result["status"] = JSValue("error");
                        result["pid"] = JSValue(0.0);
                        result["error"] = JSValue("CreateProcessW FFmpeg raw pipe failed: " + WindowsErrorMessage(GetLastError()));
                        promise.Resolve(result);
                        return;
                    }

                    g_processInfo = pi;
                    g_stdinWrite = stdinWrite;
                    g_stderrRead = nullptr;
                    g_stderrSummary = "FFmpeg started with MediaCapture raw BGRA pipe v51 shared-preview (" + std::to_string(g_pipeFrameWidth) + "x" + std::to_string(g_pipeFrameHeight) + ").";
                    g_processActive = true;
                    g_externalScheduledLive = false;

                    std::thread([readPipe]() {
                        std::string output;
                        char buffer[2048];
                        DWORD bytesRead = 0;
                        while (ReadFile(readPipe, buffer, sizeof(buffer), &bytesRead, nullptr) && bytesRead > 0)
                        {
                            output.append(buffer, buffer + bytesRead);
                            if (output.size() > 8000)
                            {
                                output.erase(0, output.size() - 8000);
                            }
                            {
                                std::lock_guard<std::mutex> summaryLock(g_processMutex);
                                g_stderrSummary = output;
                            }
                        }
                        CloseHandle(readPipe);
                        if (!output.empty())
                        {
                            std::lock_guard<std::mutex> summaryLock(g_processMutex);
                            g_stderrSummary = output;
                        }
                    }).detach();

                    lock.unlock();
                    try
                    {
                        StartMediaCapturePipeFrameReaderAsync().get();
                    }
                    catch (winrt::hresult_error const &ex)
                    {
                        StopMediaCapturePipeLiveBestEffort();
                        {
                            std::lock_guard<std::mutex> cleanupLock(g_processMutex);
                            if (g_stdinWrite)
                            {
                                CloseHandle(g_stdinWrite);
                                g_stdinWrite = nullptr;
                            }
                            if (g_processInfo.hProcess)
                            {
                                TerminateProcess(g_processInfo.hProcess, 1);
                                WaitForSingleObject(g_processInfo.hProcess, 1000);
                            }
                            ResetActiveProcessHandles();
                        }
                        lock.lock();
                        result["status"] = JSValue("error");
                        result["pid"] = JSValue(0.0);
                        result["error"] = JSValue("MediaCapture pipe frame reader failed: " + winrt::to_string(ex.message()));
                        promise.Resolve(result);
                        return;
                    }
                    catch (...)
                    {
                        StopMediaCapturePipeLiveBestEffort();
                        {
                            std::lock_guard<std::mutex> cleanupLock(g_processMutex);
                            if (g_stdinWrite)
                            {
                                CloseHandle(g_stdinWrite);
                                g_stdinWrite = nullptr;
                            }
                            if (g_processInfo.hProcess)
                            {
                                TerminateProcess(g_processInfo.hProcess, 1);
                                WaitForSingleObject(g_processInfo.hProcess, 1000);
                            }
                            ResetActiveProcessHandles();
                        }
                        lock.lock();
                        result["status"] = JSValue("error");
                        result["pid"] = JSValue(0.0);
                        result["error"] = JSValue("MediaCapture pipe frame reader failed: unknown");
                        promise.Resolve(result);
                        return;
                    }

                    std::this_thread::sleep_for(std::chrono::milliseconds(2200));
                    lock.lock();
                    DWORD earlyExitCode = 0;
                    if (g_processInfo.hProcess && GetExitCodeProcess(g_processInfo.hProcess, &earlyExitCode) && earlyExitCode != STILL_ACTIVE)
                    {
                        std::string summary = g_stderrSummary.empty() ? "FFmpeg raw pipe exited immediately." : g_stderrSummary;
                        StopMediaCapturePipeLiveBestEffort();
                        ResetActiveProcessHandles();
                        result["status"] = JSValue("error");
                        result["pid"] = JSValue(0.0);
                        result["exitCode"] = JSValue(static_cast<double>(earlyExitCode));
                        result["error"] = JSValue(summary);
                        promise.Resolve(result);
                        return;
                    }

                    result["status"] = JSValue("live");
                    result["pid"] = JSValue(static_cast<double>(g_processInfo.dwProcessId));
                    result["error"] = JSValue("");
                    result["captureSource"] = JSValue("mediacapture-rawvideo-pipe-v51-shared-preview");
                    result["width"] = JSValue(static_cast<double>(g_pipeFrameWidth));
                    result["height"] = JSValue(static_cast<double>(g_pipeFrameHeight));
                    promise.Resolve(result);
                    return;
                }

                STARTUPINFOW si{};
                si.cb = sizeof(si);

                // v31: capture FFmpeg stderr/stdout into an in-memory summary.
                // The previous fire-and-forget launch made the app say "status=live" even
                // when FFmpeg immediately failed to open DirectShow/RTMPS, so YouTube stayed
                // at streamStatus=ready with no useful error. A background reader thread is
                // isolated from React Native and only keeps the last few KB for diagnostics.
                SECURITY_ATTRIBUTES sa{};
                sa.nLength = sizeof(SECURITY_ATTRIBUTES);
                sa.bInheritHandle = TRUE;
                sa.lpSecurityDescriptor = nullptr;
                HANDLE readPipe = nullptr;
                HANDLE writePipe = nullptr;
                if (!CreatePipe(&readPipe, &writePipe, &sa, 0))
                {
                    result["status"] = JSValue("error");
                    result["pid"] = JSValue(0.0);
                    result["error"] = JSValue("CreatePipe failed: " + WindowsErrorMessage(GetLastError()));
                    promise.Resolve(result);
                    return;
                }
                SetHandleInformation(readPipe, HANDLE_FLAG_INHERIT, 0);

                si.dwFlags |= STARTF_USESTDHANDLES;
                si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
                si.hStdOutput = writePipe;
                si.hStdError = writePipe;

                PROCESS_INFORMATION pi{};
                auto command = BuildCommandLine(ffmpegPath, args);
                std::vector<wchar_t> commandLine(command.begin(), command.end());
                commandLine.push_back(L'\0');

                // Keep the long-running FFmpeg process in the same desktop/session
                // style as the successful DirectShow device probe. The old DETACHED/
                // BREAKAWAY launch could enumerate the webcam first, then fail
                // BindToObject at the real live start, leaving YouTube stuck at ready.
                DWORD launchFlags =
                    CREATE_NO_WINDOW |
                    CREATE_NEW_PROCESS_GROUP |
                    BELOW_NORMAL_PRIORITY_CLASS;

                BOOL ok = CreateProcessW(
                    nullptr,
                    commandLine.data(),
                    nullptr,
                    nullptr,
                    TRUE,
                    launchFlags,
                    nullptr,
                    nullptr,
                    &si,
                    &pi);

                if (!ok)
                {
                    DWORD firstError = GetLastError();
                    launchFlags =
                        CREATE_NO_WINDOW |
                        CREATE_NEW_PROCESS_GROUP |
                        BELOW_NORMAL_PRIORITY_CLASS;
                    ok = CreateProcessW(
                        nullptr,
                        commandLine.data(),
                        nullptr,
                        nullptr,
                        TRUE,
                        launchFlags,
                        nullptr,
                        nullptr,
                        &si,
                        &pi);

                    if (!ok)
                    {
                        CloseHandle(readPipe);
                        CloseHandle(writePipe);
                        result["status"] = JSValue("error");
                        result["pid"] = JSValue(0.0);
                        result["error"] = JSValue("CreateProcessW failed: " + WindowsErrorMessage(GetLastError()) + "; first attempt: " + WindowsErrorMessage(firstError));
                        promise.Resolve(result);
                        return;
                    }
                }

                CloseHandle(writePipe);

                g_processInfo = pi;
                g_stdinWrite = nullptr;
                g_stderrRead = nullptr;
                g_stderrSummary = "FFmpeg started; waiting for stderr/ingest diagnostics.";
                g_processActive = true;
                lock.unlock();

                std::thread([readPipe]() {
                    std::string output;
                    char buffer[2048];
                    DWORD bytesRead = 0;
                    while (ReadFile(readPipe, buffer, sizeof(buffer), &bytesRead, nullptr) && bytesRead > 0)
                    {
                        output.append(buffer, buffer + bytesRead);
                        if (output.size() > 6000)
                        {
                            output.erase(0, output.size() - 6000);
                        }
                        {
                            std::lock_guard<std::mutex> summaryLock(g_processMutex);
                            g_stderrSummary = output;
                        }
                    }
                    CloseHandle(readPipe);
                    if (!output.empty())
                    {
                        std::lock_guard<std::mutex> summaryLock(g_processMutex);
                        g_stderrSummary = output;
                    }
                }).detach();

                // Synchronous sanity check: CreateProcessW succeeding is not enough.
                // If FFmpeg cannot open DirectShow/RTMPS it exits immediately; JS used
                // to mark the stream live anyway and YouTube stayed "Sắp diễn ra".
                auto earlyWait = WaitForSingleObject(pi.hProcess, 1800);
                if (earlyWait == WAIT_OBJECT_0)
                {
                    DWORD earlyExitCode = 0;
                    GetExitCodeProcess(pi.hProcess, &earlyExitCode);
                    std::this_thread::sleep_for(std::chrono::milliseconds(200));

                    std::string summary;
                    {
                        std::lock_guard<std::mutex> summaryLock(g_processMutex);
                        summary = g_stderrSummary;
                    }
                    if (summary.empty())
                    {
                        summary = "FFmpeg exited immediately before YouTube ingest became active.";
                    }

                    {
                        std::lock_guard<std::mutex> activeLock(g_processMutex);
                        ResetActiveProcessHandles();
                    }
                    result["status"] = JSValue("error");
                    result["pid"] = JSValue(0.0);
                    result["exitCode"] = JSValue(static_cast<double>(earlyExitCode));
                    result["error"] = JSValue(summary);
                    promise.Resolve(result);
                    return;
                }

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

    winrt::fire_and_forget WindowsFfmpegLiveModule::ReleaseCameraForExternalUse(ReactPromise<bool> promise) noexcept
    {
        auto capturedPromise = promise;
        try
        {
            const bool released = co_await WindowsCameraReleaseForExternalUseAsync();
            capturedPromise.Resolve(released);
        }
        catch (winrt::hresult_error const &ex)
        {
            auto error = ReactError();
            error.Message = winrt::to_string(ex.message());
            capturedPromise.Reject(error);
        }
        catch (std::exception const &ex)
        {
            auto error = ReactError();
            error.Message = ex.what();
            capturedPromise.Reject(error);
        }
        catch (...)
        {
            auto error = ReactError();
            error.Message = "Windows camera release for external live failed";
            capturedPromise.Reject(error);
        }
    }

    void WindowsFfmpegLiveModule::Stop(ReactPromise<JSValueObject> promise) noexcept
    {
        std::thread([promise]() mutable {
            JSValueObject result;
            StopMediaCapturePipeLiveBestEffort();
            std::lock_guard<std::mutex> lock(g_processMutex);
            try
            {
                DWORD exitCode = 0;
                if (g_processActive && g_processInfo.hProcess)
                {
                    if (GetExitCodeProcess(g_processInfo.hProcess, &exitCode) && exitCode == STILL_ACTIVE)
                    {
                        // v44: DirectShow live may be running under cmd.exe with
                        // FFmpeg as a child. Kill the whole tree so RTMP ingest
                        // cannot continue after the user presses Stop/End match.
                        KillProcessTree(g_processInfo.dwProcessId);
                        TerminateProcess(g_processInfo.hProcess, 0);
                        WaitForSingleObject(g_processInfo.hProcess, 2000);
                    }
                    GetExitCodeProcess(g_processInfo.hProcess, &exitCode);
                }
                // v49 external shell launcher: there is no native process handle to the real FFmpeg process,
                // so kill FFmpeg as a fallback on stop/end match.
                if (g_externalScheduledLive)
                {
                    auto schtasksPath = GetSchtasksPath();
                    RunProcessAndCapture(schtasksPath, {"/End", "/TN", "AplusScoreLiveFfmpeg"}, 4000);
                    RunProcessAndCapture(schtasksPath, {"/Delete", "/TN", "AplusScoreLiveFfmpeg", "/F"}, 4000);
                    RunProcessAndCapture(L"C:\\Windows\\System32\\taskkill.exe", {"/IM", "ffmpeg.exe", "/F", "/T"}, 4000);
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
        bool active = g_externalScheduledLive || (g_processActive && g_processInfo.hProcess && GetExitCodeProcess(g_processInfo.hProcess, &exitCode) && exitCode == STILL_ACTIVE);
        result["status"] = JSValue(active ? "live" : "stopped");
        result["pid"] = JSValue(static_cast<double>((g_processActive && g_processInfo.hProcess) ? g_processInfo.dwProcessId : 0));
        result["stderrSummary"] = JSValue(g_stderrSummary);
        result["error"] = JSValue("");
        promise.Resolve(result);
    }
}
