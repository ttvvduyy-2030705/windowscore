#include "pch.h"
#include "WindowsFfmpegLiveModule.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cctype>
#include <mutex>
#include <sstream>
#include <string>
#include <cwctype>
#include <cstdio>
#include <cstdint>
#include <climits>
#include <cstring>
#include <ctime>
#include <thread>
#include <vector>

#include <winrt/Windows.Devices.Enumeration.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Media.Capture.h>
#include <winrt/Windows.Media.Capture.Frames.h>
#include <winrt/Windows.Media.MediaProperties.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.UI.Xaml.h>
#include <winrt/Windows.UI.Xaml.Media.Imaging.h>
#include <winrt/Windows.Storage.h>


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

    // v65 microphone fix: FFmpeg is launched by the packaged app. On this user's
    // machine, manual PowerShell FFmpeg can list DirectShow microphones, but the
    // app-launched FFmpeg cannot until the packaged app has explicitly requested
    // microphone consent from Windows. Prime that consent with a tiny WinRT
    // MediaCapture(Audio) init before probing/starting FFmpeg audio.
    std::atomic<bool> g_microphoneAccessPrimed{false};
    std::string g_microphoneAccessSummary;

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

    // v68b: Forward declaration used by mic-bridge readiness guard below.
    // The implementation stays with the overlay helpers later in this file.
    std::string ReadSmallTextFileUtf8(std::wstring const &path, DWORD maxBytes);
    std::string PreviewText(std::string text);

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

    std::wstring GetFfmpegMicBridgeScriptPath()
    {
        auto dir = GetAplusScoreDebugDirectory();
        return dir.empty() ? L"" : dir + L"\\start-youtube-mic-bridge.cmd";
    }

    std::wstring GetFfmpegMicBridgeLogPath()
    {
        auto dir = GetAplusScoreDebugDirectory();
        return dir.empty() ? L"" : dir + L"\\ffmpeg-mic-bridge.log";
    }

    std::string LowerCopy(std::string value)
    {
        std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        return value;
    }

    bool IsDirectShowAudioInputArgument(std::string const &value)
    {
        auto lower = LowerCopy(value);
        return lower.rfind("audio=", 0) == 0;
    }

    std::string ExtractDirectShowAudioDeviceName(std::string const &value)
    {
        if (value.size() <= 6)
        {
            return "";
        }
        return value.substr(6);
    }

    std::string ExtractFirstDirectShowAudioDeviceName(std::vector<std::string> const &args)
    {
        for (size_t i = 0; i + 3 < args.size(); ++i)
        {
            if (LowerCopy(args[i]) == "-f" && LowerCopy(args[i + 1]) == "dshow" && LowerCopy(args[i + 2]) == "-i" && IsDirectShowAudioInputArgument(args[i + 3]))
            {
                return ExtractDirectShowAudioDeviceName(args[i + 3]);
            }
        }
        return "";
    }

    std::vector<std::string> RemoveDirectShowAudioInputs(std::vector<std::string> const &args, bool &removed)
    {
        removed = false;
        std::vector<std::string> out;
        for (size_t i = 0; i < args.size();)
        {
            // Remove the common audio block:
            //   -thread_queue_size 512 -f dshow -i audio=...
            if (i + 5 < args.size() &&
                LowerCopy(args[i]) == "-thread_queue_size" &&
                LowerCopy(args[i + 2]) == "-f" &&
                LowerCopy(args[i + 3]) == "dshow" &&
                LowerCopy(args[i + 4]) == "-i" &&
                IsDirectShowAudioInputArgument(args[i + 5]))
            {
                removed = true;
                i += 6;
                continue;
            }

            // Remove a bare DirectShow audio block:
            //   -f dshow -i audio=...
            if (i + 3 < args.size() &&
                LowerCopy(args[i]) == "-f" &&
                LowerCopy(args[i + 1]) == "dshow" &&
                LowerCopy(args[i + 2]) == "-i" &&
                IsDirectShowAudioInputArgument(args[i + 3]))
            {
                removed = true;
                i += 4;
                continue;
            }

            out.push_back(args[i]);
            ++i;
        }
        return out;
    }

    void AppendUdpMicInput(std::vector<std::string> &out, int port)
    {
        out.push_back("-thread_queue_size");
        out.push_back("512");
        out.push_back("-f");
        out.push_back("s16le");
        out.push_back("-ar");
        out.push_back("44100");
        out.push_back("-ac");
        out.push_back("2");
        out.push_back("-i");
        out.push_back("udp://127.0.0.1:" + std::to_string(port) + "?fifo_size=1000000&overrun_nonfatal=1");
    }

    std::vector<std::string> ReplaceDirectShowAudioInputsWithUdp(std::vector<std::string> const &args, int port, bool &replaced)
    {
        replaced = false;
        std::vector<std::string> out;
        for (size_t i = 0; i < args.size();)
        {
            // Replace, at the original input position, the common audio block:
            //   -thread_queue_size 512 -f dshow -i audio=...
            // with the localhost PCM bridge input.  This must stay before -map
            // and before output options; appending it at the end makes FFmpeg
            // treat the input as an output option and silently loses the mic.
            if (i + 5 < args.size() &&
                LowerCopy(args[i]) == "-thread_queue_size" &&
                LowerCopy(args[i + 2]) == "-f" &&
                LowerCopy(args[i + 3]) == "dshow" &&
                LowerCopy(args[i + 4]) == "-i" &&
                IsDirectShowAudioInputArgument(args[i + 5]))
            {
                if (!replaced)
                {
                    AppendUdpMicInput(out, port);
                    replaced = true;
                }
                i += 6;
                continue;
            }

            // Replace a bare DirectShow audio block:
            //   -f dshow -i audio=...
            if (i + 3 < args.size() &&
                LowerCopy(args[i]) == "-f" &&
                LowerCopy(args[i + 1]) == "dshow" &&
                LowerCopy(args[i + 2]) == "-i" &&
                IsDirectShowAudioInputArgument(args[i + 3]))
            {
                if (!replaced)
                {
                    AppendUdpMicInput(out, port);
                    replaced = true;
                }
                i += 4;
                continue;
            }

            out.push_back(args[i]);
            ++i;
        }
        return out;
    }

    std::vector<std::string> ReplaceDirectShowAudioInputsWithSilent(std::vector<std::string> const &args, bool &replaced)
    {
        replaced = false;
        std::vector<std::string> out;
        for (size_t i = 0; i < args.size();)
        {
            // Replace DirectShow audio with a silent lavfi source at the same
            // input index. This keeps the main YouTube ingest alive if the
            // external/user-context microphone bridge cannot be started.
            if (i + 5 < args.size() &&
                LowerCopy(args[i]) == "-thread_queue_size" &&
                LowerCopy(args[i + 2]) == "-f" &&
                LowerCopy(args[i + 3]) == "dshow" &&
                LowerCopy(args[i + 4]) == "-i" &&
                IsDirectShowAudioInputArgument(args[i + 5]))
            {
                if (!replaced)
                {
                    out.push_back("-f");
                    out.push_back("lavfi");
                    out.push_back("-i");
                    out.push_back("anullsrc=channel_layout=stereo:sample_rate=44100");
                    replaced = true;
                }
                i += 6;
                continue;
            }

            if (i + 3 < args.size() &&
                LowerCopy(args[i]) == "-f" &&
                LowerCopy(args[i + 1]) == "dshow" &&
                LowerCopy(args[i + 2]) == "-i" &&
                IsDirectShowAudioInputArgument(args[i + 3]))
            {
                if (!replaced)
                {
                    out.push_back("-f");
                    out.push_back("lavfi");
                    out.push_back("-i");
                    out.push_back("anullsrc=channel_layout=stereo:sample_rate=44100");
                    replaced = true;
                }
                i += 4;
                continue;
            }

            out.push_back(args[i]);
            ++i;
        }
        return out;
    }

    int PickMicBridgeUdpPort()
    {
        return 19000 + static_cast<int>(GetTickCount64() % 10000);
    }

    std::string BuildMicBridgeBatchFile(std::wstring const &ffmpegPath, std::string const &audioDeviceName, int port, std::wstring const &logPath)
    {
        const std::string log = ToUtf8(logPath);
        std::string content;
        content += "@echo off\r\n";
        content += "setlocal EnableExtensions\r\n";
        content += "echo ==== APLUS FFmpeg mic bridge %DATE% %TIME% ==== > " + QuoteBatchArg(log) + "\r\n";
        content += "echo AudioDevice=" + EscapeBatchText(audioDeviceName) + " >> " + QuoteBatchArg(log) + "\r\n";
        content += QuoteBatchArg(ToUtf8(ffmpegPath));
        content += " -hide_banner -loglevel info -nostdin -fflags nobuffer -flags low_delay";
        content += " -thread_queue_size 512 -f dshow -i " + QuoteBatchArg("audio=" + audioDeviceName);
        content += " -vn -ac 2 -ar 44100 -acodec pcm_s16le -f s16le ";
        content += QuoteBatchArg("udp://127.0.0.1:" + std::to_string(port) + "?pkt_size=1316");
        content += " >> " + QuoteBatchArg(log) + " 2>&1\r\n";
        content += "set APLUS_MIC_EXIT=%ERRORLEVEL%\r\n";
        content += "echo ==== APLUS mic bridge exited %APLUS_MIC_EXIT% %DATE% %TIME% ==== >> " + QuoteBatchArg(log) + "\r\n";
        content += "exit /b %APLUS_MIC_EXIT%\r\n";
        return content;
    }

    std::string FutureTaskStartTimeHHMM()
    {
        auto now = std::chrono::system_clock::now() + std::chrono::minutes(1);
        std::time_t t = std::chrono::system_clock::to_time_t(now);
        std::tm local{};
        localtime_s(&local, &t);
        char buf[16] = {};
        std::snprintf(buf, sizeof(buf), "%02d:%02d", local.tm_hour, local.tm_min);
        return std::string(buf);
    }

    void StopMicBridgeScheduledTaskBestEffort()
    {
        auto schtasksPath = GetSchtasksPath();
        RunProcessAndCapture(schtasksPath, {"/End", "/TN", "AplusScoreLiveMicBridge"}, 2000);
        RunProcessAndCapture(schtasksPath, {"/Delete", "/TN", "AplusScoreLiveMicBridge", "/F"}, 2000);
    }

    bool StartMicBridgeScheduledTask(std::wstring const &ffmpegPath, std::string const &audioDeviceName, int port, std::string &error)
    {
        error.clear();
        if (audioDeviceName.empty())
        {
            error = "empty audio device name";
            return false;
        }

        const auto scriptPath = GetFfmpegMicBridgeScriptPath();
        const auto logPath = GetFfmpegMicBridgeLogPath();
        if (scriptPath.empty() || logPath.empty())
        {
            error = "cannot resolve mic bridge script/log path";
            return false;
        }

        StopMicBridgeScheduledTaskBestEffort();
        WriteUtf8TextFile(logPath, "==== APLUS mic bridge preparing ====\r\n");
        if (!WriteUtf8TextFile(scriptPath, BuildMicBridgeBatchFile(ffmpegPath, audioDeviceName, port, logPath)))
        {
            error = "cannot write mic bridge cmd file";
            return false;
        }

        const auto schtasksPath = GetSchtasksPath();
        const auto runCommand = ToUtf8(BuildCmdBatchLauncherCommandLine(scriptPath));
        auto create = RunProcessAndCapture(
            schtasksPath,
            {"/Create", "/TN", "AplusScoreLiveMicBridge", "/SC", "ONCE", "/ST", FutureTaskStartTimeHHMM(), "/TR", runCommand, "/F", "/IT"},
            6000);

        if (!create.started || create.timedOut || (create.output.find("ERROR") != std::string::npos && create.output.find("SUCCESS") == std::string::npos))
        {
            // Some Windows editions reject /IT from app-launched schtasks. Retry
            // without it; running as the current logged-in user is still enough on
            // most machines to expose DirectShow microphone devices.
            create = RunProcessAndCapture(
                schtasksPath,
                {"/Create", "/TN", "AplusScoreLiveMicBridge", "/SC", "ONCE", "/ST", FutureTaskStartTimeHHMM(), "/TR", runCommand, "/F"},
                6000);
        }

        if (!create.started || create.timedOut || create.output.find("ERROR") != std::string::npos)
        {
            error = "schtasks create failed: " + (create.error.empty() ? create.output : create.error + " " + create.output);
            StopMicBridgeScheduledTaskBestEffort();
            return false;
        }

        auto run = RunProcessAndCapture(schtasksPath, {"/Run", "/TN", "AplusScoreLiveMicBridge"}, 5000);
        if (!run.started || run.timedOut || run.output.find("ERROR") != std::string::npos)
        {
            error = "schtasks run failed: " + (run.error.empty() ? run.output : run.error + " " + run.output);
            StopMicBridgeScheduledTaskBestEffort();
            return false;
        }

        // v68: Do not blindly switch the main YouTube FFmpeg to UDP audio.
        // If the bridge task was created but FFmpeg did not actually open the
        // microphone yet, the main FFmpeg can block on the UDP audio input and
        // YouTube stays at "upcoming/ready".  Wait for the bridge log to prove
        // that the external FFmpeg reached its output stage.  Otherwise report
        // failure so the caller replaces audio with stable silent fallback.
        bool bridgeReady = false;
        std::string bridgeLog;
        for (int i = 0; i < 12; ++i)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
            bridgeLog = ReadSmallTextFileUtf8(logPath, 64 * 1024);
            auto lower = LowerCopy(bridgeLog);
            const bool hasFatal =
                lower.find("error opening input") != std::string::npos ||
                lower.find("could not find audio") != std::string::npos ||
                lower.find("could not enumerate audio") != std::string::npos ||
                lower.find("unable to bindtoobject") != std::string::npos ||
                lower.find("exited") != std::string::npos;
            const bool hasOutput =
                lower.find("output #0") != std::string::npos ||
                lower.find("stream mapping") != std::string::npos ||
                lower.find("size=") != std::string::npos;
            if (hasFatal)
            {
                error = "mic bridge FFmpeg failed: " + PreviewText(bridgeLog);
                StopMicBridgeScheduledTaskBestEffort();
                return false;
            }
            if (hasOutput)
            {
                bridgeReady = true;
                break;
            }
        }

        if (!bridgeReady)
        {
            error = "mic bridge did not become ready; log=" + PreviewText(bridgeLog);
            StopMicBridgeScheduledTaskBestEffort();
            return false;
        }

        return true;
    }

    bool ReplaceDshowAudioWithMicBridge(std::wstring const &ffmpegPath, std::vector<std::string> &pipeArgs, std::string &summary)
    {
        summary.clear();
        const auto audioDeviceName = ExtractFirstDirectShowAudioDeviceName(pipeArgs);
        if (audioDeviceName.empty())
        {
            return false;
        }

        std::string bridgeError;
        const int port = PickMicBridgeUdpPort();
        if (!StartMicBridgeScheduledTask(ffmpegPath, audioDeviceName, port, bridgeError))
        {
            bool silentReplaced = false;
            auto silentArgs = ReplaceDirectShowAudioInputsWithSilent(pipeArgs, silentReplaced);
            if (silentReplaced)
            {
                pipeArgs = std::move(silentArgs);
                summary = "Mic bridge not started for " + audioDeviceName + ": " + bridgeError + "; replaced audio input with silent fallback so YouTube ingest can still go live";
            }
            else
            {
                summary = "Mic bridge not started for " + audioDeviceName + ": " + bridgeError;
            }
            return false;
        }

        bool replaced = false;
        auto transformed = ReplaceDirectShowAudioInputsWithUdp(pipeArgs, port, replaced);
        if (!replaced)
        {
            StopMicBridgeScheduledTaskBestEffort();
            summary = "Mic bridge started but no DirectShow audio input was replaced";
            return false;
        }

        pipeArgs = std::move(transformed);
        g_externalScheduledLive = true;
        summary = "Mic bridge scheduled for " + audioDeviceName + " on udp://127.0.0.1:" + std::to_string(port);
        return true;
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
            "-flags",
            "low_delay",
            "-probesize",
            "32",
            "-analyzeduration",
            "0",
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


    std::wstring Utf8ToWideLoose(std::string const &value)
    {
        if (value.empty()) return L"";
        int required = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
        if (required <= 0) return std::wstring(value.begin(), value.end());
        std::wstring result(static_cast<size_t>(required), L'\0');
        MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), required);
        return result;
    }

    std::wstring GetProcessTempDirectory()
    {
        std::wstring temp(32768, L'\0');
        DWORD len = GetTempPathW(static_cast<DWORD>(temp.size()), temp.data());
        if (len > 0 && len < temp.size())
        {
            temp.resize(len);
            while (!temp.empty() && (temp.back() == L'\\' || temp.back() == L'/'))
            {
                temp.pop_back();
            }
            return temp;
        }
        return L"";
    }

    std::string ReadSmallTextFileUtf8(std::wstring const &path, DWORD maxBytes = 256 * 1024)
    {
        // v53b: Avoid CreateFileW here. In this RNW/UWP-style build, CreateFileW can
        // be hidden by the selected Windows API family and fails to compile, while the
        // CRT file APIs are available and enough for reading the small overlay.json.
        FILE *file = nullptr;
        if (_wfopen_s(&file, path.c_str(), L"rb") != 0 || !file)
        {
            return "";
        }

        if (fseek(file, 0, SEEK_END) != 0)
        {
            fclose(file);
            return "";
        }
        long size = ftell(file);
        if (size <= 0 || size > static_cast<long>(maxBytes))
        {
            fclose(file);
            return "";
        }
        rewind(file);

        std::string data(static_cast<size_t>(size), '\0');
        size_t read = fread(data.data(), 1, data.size(), file);
        fclose(file);
        if (read == 0)
        {
            return "";
        }
        data.resize(read);
        return data;
    }

    std::string JsonStringValue(std::string const &json, std::string const &key, size_t from = 0, size_t *endPos = nullptr)
    {
        auto keyText = std::string("\"") + key + "\"";
        auto pos = json.find(keyText, from);
        if (pos == std::string::npos) return "";
        pos = json.find(':', pos + keyText.size());
        if (pos == std::string::npos) return "";
        pos = json.find('"', pos + 1);
        if (pos == std::string::npos) return "";
        ++pos;
        std::string value;
        bool escape = false;
        for (size_t i = pos; i < json.size(); ++i)
        {
            char ch = json[i];
            if (escape)
            {
                if (ch == 'n') value.push_back('\n');
                else if (ch == 'r') value.push_back('\r');
                else if (ch == 't') value.push_back('\t');
                else value.push_back(ch);
                escape = false;
                continue;
            }
            if (ch == '\\') { escape = true; continue; }
            if (ch == '"') { if (endPos) *endPos = i + 1; return value; }
            value.push_back(ch);
        }
        return value;
    }

    int64_t JsonInt64Value(std::string const &json, std::string const &key, size_t from = 0)
    {
        auto keyText = std::string("\"") + key + "\"";
        auto pos = json.find(keyText, from);
        if (pos == std::string::npos) return 0;
        pos = json.find(':', pos + keyText.size());
        if (pos == std::string::npos) return 0;
        ++pos;
        while (pos < json.size() && std::isspace(static_cast<unsigned char>(json[pos]))) ++pos;
        bool neg = false;
        if (pos < json.size() && json[pos] == '-') { neg = true; ++pos; }
        int64_t value = 0;
        bool any = false;
        while (pos < json.size() && std::isdigit(static_cast<unsigned char>(json[pos])))
        {
            any = true;
            value = value * 10 + static_cast<int64_t>(json[pos] - '0');
            ++pos;
        }
        if (!any) return 0;
        return neg ? -value : value;
    }

    int JsonIntValue(std::string const &json, std::string const &key, size_t from = 0)
    {
        auto value = JsonInt64Value(json, key, from);
        if (value > INT_MAX) return INT_MAX;
        if (value < INT_MIN) return INT_MIN;
        return static_cast<int>(value);
    }

    int64_t CurrentUnixTimeMs() noexcept
    {
        try
        {
            return std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
        }
        catch (...) { return 0; }
    }

    struct NativeLiveOverlayState
    {
        bool visible = false;
        bool carom = false;
        bool useSnapshot = false;
        std::wstring snapshotPath;
        std::wstring leftName = L"Nguoi choi 1";
        std::wstring rightName = L"Nguoi choi 2";
        int leftScore = 0;
        int rightScore = 0;
        int goal = 0;
        int turns = 0;
        int timer = 0;
    };

    struct NativeOverlayBitmap
    {
        bool valid = false;
        std::wstring path;
        uint64_t fileToken = 0;
        uint32_t width = 0;
        uint32_t height = 0;
        std::vector<BYTE> bgra;
    };

    std::mutex g_nativeOverlayMutex;
    NativeLiveOverlayState g_nativeOverlayState{};
    ULONGLONG g_nativeOverlayLastLoadTick = 0;
    int64_t g_nativeOverlaySessionStartedAtMs = 0;
    std::mutex g_nativeOverlayBitmapMutex;
    NativeOverlayBitmap g_nativeOverlayBitmap{};

    void ResetNativeLiveOverlayStateForNewSession() noexcept
    {
        g_nativeOverlaySessionStartedAtMs = CurrentUnixTimeMs();
        g_nativeOverlayLastLoadTick = 0;
        {
            std::lock_guard<std::mutex> lock(g_nativeOverlayMutex);
            g_nativeOverlayState = NativeLiveOverlayState{};
        }
        {
            std::lock_guard<std::mutex> lock(g_nativeOverlayBitmapMutex);
            g_nativeOverlayBitmap = NativeOverlayBitmap{};
        }
        // Do not call AppendStderrSummary here: Start() holds g_processMutex
        // when resetting overlay state, and AppendStderrSummary also locks it.
        // Calling it here deadlocked native start and left the app stuck at
        // "Đang tạo phiên live" / LiveState=starting.
    }

    uint64_t FileTokenForPath(std::wstring const &path) noexcept
    {
        try
        {
            WIN32_FILE_ATTRIBUTE_DATA data{};
            if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &data))
            {
                return 0;
            }
            ULARGE_INTEGER size{};
            size.HighPart = data.nFileSizeHigh;
            size.LowPart = data.nFileSizeLow;
            ULARGE_INTEGER write{};
            write.HighPart = data.ftLastWriteTime.dwHighDateTime;
            write.LowPart = data.ftLastWriteTime.dwLowDateTime;
            return size.QuadPart ^ write.QuadPart;
        }
        catch (...) { return 0; }
    }

    bool ParseJsonBoolValue(std::string const &json, std::string const &key, bool fallback = false)
    {
        auto pos = json.find("\"" + key + "\"");
        if (pos == std::string::npos) return fallback;
        pos = json.find(':', pos);
        if (pos == std::string::npos) return fallback;
        auto start = json.find_first_not_of(" \t\r\n", pos + 1);
        if (start == std::string::npos) return fallback;
        if (json.compare(start, 4, "true") == 0) return true;
        if (json.compare(start, 5, "false") == 0) return false;
        return fallback;
    }

    std::wstring NormalizeOverlaySnapshotPath(std::wstring path)
    {
        std::replace(path.begin(), path.end(), L'/', L'\\');
        return path;
    }

    bool LoadOverlaySnapshotBitmap(std::wstring const &path) noexcept
    {
        try
        {
            if (path.empty()) return false;
            auto normalizedPath = NormalizeOverlaySnapshotPath(path);
            uint64_t token = FileTokenForPath(normalizedPath);
            if (token == 0)
            {
                static ULONGLONG lastMissingLogTick = 0;
                auto now = GetTickCount64();
                if (now - lastMissingLogTick > 2500)
                {
                    lastMissingLogTick = now;
                    AppendStderrSummary("\n[LiveOverlaySnapshot v62] png not found: " + ToUtf8(normalizedPath));
                }
                return false;
            }
            {
                std::lock_guard<std::mutex> lock(g_nativeOverlayBitmapMutex);
                if (g_nativeOverlayBitmap.valid && g_nativeOverlayBitmap.path == normalizedPath && g_nativeOverlayBitmap.fileToken == token)
                {
                    return true;
                }
            }

            auto file = winrt::Windows::Storage::StorageFile::GetFileFromPathAsync(normalizedPath).get();
            auto stream = file.OpenReadAsync().get();
            auto decoder = winrt::Windows::Graphics::Imaging::BitmapDecoder::CreateAsync(stream).get();
            auto softwareBitmap = decoder.GetSoftwareBitmapAsync(
                winrt::Windows::Graphics::Imaging::BitmapPixelFormat::Bgra8,
                winrt::Windows::Graphics::Imaging::BitmapAlphaMode::Premultiplied).get();
            auto buffer = softwareBitmap.LockBuffer(winrt::Windows::Graphics::Imaging::BitmapBufferAccessMode::Read);
            auto reference = buffer.CreateReference();
            BYTE *planeBytes = nullptr;
            uint32_t capacity = 0;
            auto access = reference.as<IMemoryBufferByteAccess>();
            HRESULT hr = access->GetBuffer(&planeBytes, &capacity);
            if (FAILED(hr) || planeBytes == nullptr || capacity == 0)
            {
                return false;
            }
            auto plane = buffer.GetPlaneDescription(0);
            const uint32_t width = static_cast<uint32_t>(softwareBitmap.PixelWidth());
            const uint32_t height = static_cast<uint32_t>(softwareBitmap.PixelHeight());
            const uint32_t rowBytes = width * 4;
            std::vector<BYTE> contiguous(static_cast<size_t>(rowBytes) * height);
            for (uint32_t row = 0; row < height; ++row)
            {
                const uint64_t srcOffset = static_cast<uint64_t>(plane.StartIndex) + static_cast<uint64_t>(row) * static_cast<uint32_t>(plane.Stride);
                if (srcOffset + rowBytes > capacity)
                {
                    return false;
                }
                std::memcpy(contiguous.data() + static_cast<size_t>(row) * rowBytes, planeBytes + srcOffset, rowBytes);
            }

            std::lock_guard<std::mutex> lock(g_nativeOverlayBitmapMutex);
            g_nativeOverlayBitmap.valid = true;
            g_nativeOverlayBitmap.path = normalizedPath;
            g_nativeOverlayBitmap.fileToken = token;
            g_nativeOverlayBitmap.width = width;
            g_nativeOverlayBitmap.height = height;
            g_nativeOverlayBitmap.bgra = std::move(contiguous);
            return true;
        }
        catch (winrt::hresult_error const &ex)
        {
            static ULONGLONG lastDecodeLogTick = 0;
            auto now = GetTickCount64();
            if (now - lastDecodeLogTick > 2500)
            {
                lastDecodeLogTick = now;
                AppendStderrSummary("\n[LiveOverlaySnapshot v62] decode failed: " + winrt::to_string(ex.message()) + " hr=" + std::to_string(static_cast<long>(ex.code())) + " path=" + ToUtf8(NormalizeOverlaySnapshotPath(path)));
            }
            return false;
        }
        catch (std::exception const &ex)
        {
            AppendStderrSummary(std::string("\n[LiveOverlaySnapshot v62] decode exception: ") + ex.what());
            return false;
        }
        catch (...) { AppendStderrSummary("\n[LiveOverlaySnapshot v62] decode exception: unknown"); return false; }
    }

    bool ApplyOverlaySnapshotBitmapToFrame(std::vector<BYTE> &frame, uint32_t width, uint32_t height) noexcept
    {
        NativeOverlayBitmap bitmap;
        {
            std::lock_guard<std::mutex> lock(g_nativeOverlayBitmapMutex);
            if (!g_nativeOverlayBitmap.valid || g_nativeOverlayBitmap.bgra.empty()) return false;
            bitmap = g_nativeOverlayBitmap;
        }

        if (bitmap.width == 0 || bitmap.height == 0) return false;

        for (uint32_t y = 0; y < height; ++y)
        {
            uint32_t sy = bitmap.height == height ? y : static_cast<uint32_t>((static_cast<uint64_t>(y) * bitmap.height) / std::max<uint32_t>(1, height));
            if (sy >= bitmap.height) sy = bitmap.height - 1;
            for (uint32_t x = 0; x < width; ++x)
            {
                uint32_t sx = bitmap.width == width ? x : static_cast<uint32_t>((static_cast<uint64_t>(x) * bitmap.width) / std::max<uint32_t>(1, width));
                if (sx >= bitmap.width) sx = bitmap.width - 1;
                size_t srcIndex = (static_cast<size_t>(sy) * bitmap.width + sx) * 4;
                if (srcIndex + 3 >= bitmap.bgra.size()) continue;
                const BYTE b = bitmap.bgra[srcIndex + 0];
                const BYTE g = bitmap.bgra[srcIndex + 1];
                const BYTE r = bitmap.bgra[srcIndex + 2];
                const BYTE a = bitmap.bgra[srcIndex + 3];
                if (a == 0) continue;
                size_t dstIndex = (static_cast<size_t>(y) * width + x) * 4;
                if (dstIndex + 3 >= frame.size()) continue;
                // Source pixels are premultiplied BGRA.
                frame[dstIndex + 0] = static_cast<BYTE>(std::min<int>(255, static_cast<int>(b) + (static_cast<int>(frame[dstIndex + 0]) * (255 - a)) / 255));
                frame[dstIndex + 1] = static_cast<BYTE>(std::min<int>(255, static_cast<int>(g) + (static_cast<int>(frame[dstIndex + 1]) * (255 - a)) / 255));
                frame[dstIndex + 2] = static_cast<BYTE>(std::min<int>(255, static_cast<int>(r) + (static_cast<int>(frame[dstIndex + 2]) * (255 - a)) / 255));
                frame[dstIndex + 3] = 255;
            }
        }
        return true;
    }

    void RefreshNativeLiveOverlayStateIfNeeded() noexcept
    {
        ULONGLONG now = GetTickCount64();
        if (now - g_nativeOverlayLastLoadTick < 16) return;
        g_nativeOverlayLastLoadTick = now;

        std::vector<std::wstring> snapshotMetaCandidates;
        std::vector<std::wstring> snapshotPngCandidates;
        std::vector<std::wstring> overlayCandidates;
        try
        {
            auto appTemp = std::wstring(winrt::Windows::Storage::ApplicationData::Current().TemporaryFolder().Path().c_str());
            if (!appTemp.empty())
            {
                snapshotMetaCandidates.push_back(JoinPath(appTemp, L"AplusScoreLiveOverlay\\overlay-snapshot.json"));
                snapshotPngCandidates.push_back(JoinPath(appTemp, L"AplusScoreLiveOverlay\\react-fullscreen-overlay.png"));
                snapshotPngCandidates.push_back(JoinPath(appTemp, L"AplusScoreLiveOverlay\\overlay-snapshot.png"));
                overlayCandidates.push_back(JoinPath(appTemp, L"AplusScoreLiveOverlay\\overlay.json"));
            }
        }
        catch (...) {}
        auto temp = GetProcessTempDirectory();
        if (!temp.empty())
        {
            overlayCandidates.push_back(JoinPath(temp, L"AplusScoreLiveOverlay\\overlay.json"));
            snapshotMetaCandidates.push_back(JoinPath(temp, L"AplusScoreLiveOverlay\\overlay-snapshot.json"));
            snapshotPngCandidates.push_back(JoinPath(temp, L"AplusScoreLiveOverlay\\overlay-snapshot.png"));
        }
        auto profile = GetRealUserProfileDirectory();
        if (!profile.empty())
        {
            overlayCandidates.push_back(JoinPath(profile, L"Videos\\Aplus Score\\External\\LiveOverlay\\overlay.json"));
            overlayCandidates.push_back(JoinPath(profile, L"Videos\\Aplus Score\\LiveOverlay\\overlay.json"));
            snapshotMetaCandidates.push_back(JoinPath(profile, L"Videos\\Aplus Score\\External\\LiveOverlay\\overlay-snapshot.json"));
            snapshotMetaCandidates.push_back(JoinPath(profile, L"Videos\\Aplus Score\\LiveOverlay\\overlay-snapshot.json"));
            snapshotPngCandidates.push_back(JoinPath(profile, L"Videos\\Aplus Score\\External\\LiveOverlay\\overlay-snapshot.png"));
            snapshotPngCandidates.push_back(JoinPath(profile, L"Videos\\Aplus Score\\LiveOverlay\\overlay-snapshot.png"));
        }
        auto localAppData = GetRealLocalAppDataDirectory();
        if (!localAppData.empty())
        {
            overlayCandidates.push_back(JoinPath(localAppData, L"AplusScore\\LiveOverlay\\overlay.json"));
            snapshotMetaCandidates.push_back(JoinPath(localAppData, L"AplusScore\\LiveOverlay\\overlay-snapshot.json"));
            snapshotPngCandidates.push_back(JoinPath(localAppData, L"AplusScore\\LiveOverlay\\overlay-snapshot.png"));
        }

        NativeLiveOverlayState next;
        std::string snapshotMetaJson;
        std::wstring snapshotPngPath;
        for (size_t index = 0; index < snapshotMetaCandidates.size(); ++index)
        {
            snapshotMetaJson = ReadSmallTextFileUtf8(snapshotMetaCandidates[index]);
            if (!snapshotMetaJson.empty())
            {
                if (index < snapshotPngCandidates.size())
                {
                    snapshotPngPath = snapshotPngCandidates[index];
                }
                break;
            }
        }
        if (!snapshotMetaJson.empty() && ParseJsonBoolValue(snapshotMetaJson, "visible", false))
        {
            const int64_t metaUpdatedAt = JsonInt64Value(snapshotMetaJson, "updatedAt");
            const int64_t sessionStartedAt = g_nativeOverlaySessionStartedAtMs;
            if (sessionStartedAt > 0 && metaUpdatedAt > 0 && metaUpdatedAt + 1000 < sessionStartedAt)
            {
                std::lock_guard<std::mutex> lock(g_nativeOverlayMutex);
                g_nativeOverlayState = next;
                return;
            }
            if (sessionStartedAt > 0 && metaUpdatedAt <= 0)
            {
                std::lock_guard<std::mutex> lock(g_nativeOverlayMutex);
                g_nativeOverlayState = next;
                return;
            }

            auto variant = JsonStringValue(snapshotMetaJson, "variant");
            std::transform(variant.begin(), variant.end(), variant.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
            next.carom = variant.find("carom") != std::string::npos || variant.find("libre") != std::string::npos;

            auto snapshotPathFromMeta = JsonStringValue(snapshotMetaJson, "snapshotPath");
            if (!snapshotPathFromMeta.empty())
            {
                snapshotPngPath = NormalizeOverlaySnapshotPath(Utf8ToWideLoose(snapshotPathFromMeta));
            }

            if (!snapshotPngPath.empty())
            {
                next.useSnapshot = LoadOverlaySnapshotBitmap(snapshotPngPath);
                if (next.useSnapshot)
                {
                    next.visible = true;
                    next.snapshotPath = snapshotPngPath;
                }
                else
                {
                    // Keep the last good React snapshot instead of flashing to the
                    // temporary hand-drawn JSON overlay while React is rewriting the PNG.
                    // This prevents live overlay blinking during score/timer updates.
                    std::lock_guard<std::mutex> lock(g_nativeOverlayMutex);
                    if (g_nativeOverlayState.visible && g_nativeOverlayState.useSnapshot)
                    {
                        return;
                    }
                }
            }
        }

        std::string json;
        for (auto const &candidate : overlayCandidates)
        {
            json = ReadSmallTextFileUtf8(candidate);
            if (!json.empty())
            {
                break;
            }
        }

        // v57: only the captured React fullscreen overlay is allowed.
        // Do not fall back to the old hand-drawn native overlay.
        if (json.empty())
        {
            std::lock_guard<std::mutex> lock(g_nativeOverlayMutex);
            g_nativeOverlayState = next;
            return;
        }
        auto category = JsonStringValue(json, "category");
        auto mode = JsonStringValue(json, "mode");
        std::transform(category.begin(), category.end(), category.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        std::transform(mode.begin(), mode.end(), mode.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        next.carom = category.find("carom") != std::string::npos || mode.find("carom") != std::string::npos || mode.find("libre") != std::string::npos;
        next.goal = JsonIntValue(json, "goal");
        next.turns = JsonIntValue(json, "totalTurns");
        next.timer = JsonIntValue(json, "countdownTime");

        size_t playersPos = json.find("\"players\"");
        if (playersPos != std::string::npos)
        {
            size_t firstEnd = playersPos;
            auto leftName = JsonStringValue(json, "name", playersPos, &firstEnd);
            auto leftScore = JsonIntValue(json, "score", playersPos);
            size_t secondStart = json.find("\"name\"", firstEnd);
            auto rightName = secondStart == std::string::npos ? std::string("Nguoi choi 2") : JsonStringValue(json, "name", secondStart);
            auto rightScore = secondStart == std::string::npos ? 0 : JsonIntValue(json, "score", secondStart);
            if (!leftName.empty()) next.leftName = Utf8ToWideLoose(leftName);
            if (!rightName.empty()) next.rightName = Utf8ToWideLoose(rightName);
            next.leftScore = leftScore;
            next.rightScore = rightScore;
        }

        std::lock_guard<std::mutex> lock(g_nativeOverlayMutex);
        g_nativeOverlayState = next;
    }

    struct OverlayBox
    {
        int left = 0;
        int top = 0;
        int right = 0;
        int bottom = 0;
    };

    struct OverlayColor
    {
        BYTE r = 0;
        BYTE g = 0;
        BYTE b = 0;
        BYTE a = 255;
    };

    int ClampInt(int value, int minValue, int maxValue)
    {
        return std::max(minValue, std::min(value, maxValue));
    }

    void BlendPixelBgra(std::vector<BYTE> &frame, uint32_t width, uint32_t height, int x, int y, OverlayColor color) noexcept
    {
        if (x < 0 || y < 0 || x >= static_cast<int>(width) || y >= static_cast<int>(height) || frame.empty()) return;
        size_t index = (static_cast<size_t>(y) * static_cast<size_t>(width) + static_cast<size_t>(x)) * 4;
        if (index + 3 >= frame.size()) return;
        const int alpha = static_cast<int>(color.a);
        frame[index + 0] = static_cast<BYTE>((static_cast<int>(color.b) * alpha + static_cast<int>(frame[index + 0]) * (255 - alpha)) / 255);
        frame[index + 1] = static_cast<BYTE>((static_cast<int>(color.g) * alpha + static_cast<int>(frame[index + 1]) * (255 - alpha)) / 255);
        frame[index + 2] = static_cast<BYTE>((static_cast<int>(color.r) * alpha + static_cast<int>(frame[index + 2]) * (255 - alpha)) / 255);
        frame[index + 3] = 255;
    }

    void FillRectBgra(std::vector<BYTE> &frame, uint32_t width, uint32_t height, OverlayBox box, OverlayColor color) noexcept
    {
        int left = ClampInt(std::min(box.left, box.right), 0, static_cast<int>(width));
        int right = ClampInt(std::max(box.left, box.right), 0, static_cast<int>(width));
        int top = ClampInt(std::min(box.top, box.bottom), 0, static_cast<int>(height));
        int bottom = ClampInt(std::max(box.top, box.bottom), 0, static_cast<int>(height));
        for (int y = top; y < bottom; ++y)
        {
            for (int x = left; x < right; ++x)
            {
                BlendPixelBgra(frame, width, height, x, y, color);
            }
        }
    }

    std::array<const char *, 7> Glyph5x7(char ch) noexcept
    {
        switch (ch)
        {
        case '0': return {"01110","10001","10011","10101","11001","10001","01110"};
        case '1': return {"00100","01100","00100","00100","00100","00100","01110"};
        case '2': return {"01110","10001","00001","00010","00100","01000","11111"};
        case '3': return {"11110","00001","00001","01110","00001","00001","11110"};
        case '4': return {"00010","00110","01010","10010","11111","00010","00010"};
        case '5': return {"11111","10000","10000","11110","00001","00001","11110"};
        case '6': return {"01110","10000","10000","11110","10001","10001","01110"};
        case '7': return {"11111","00001","00010","00100","01000","01000","01000"};
        case '8': return {"01110","10001","10001","01110","10001","10001","01110"};
        case '9': return {"01110","10001","10001","01111","00001","00001","01110"};
        case 'A': return {"01110","10001","10001","11111","10001","10001","10001"};
        case 'B': return {"11110","10001","10001","11110","10001","10001","11110"};
        case 'C': return {"01110","10001","10000","10000","10000","10001","01110"};
        case 'D': return {"11110","10001","10001","10001","10001","10001","11110"};
        case 'E': return {"11111","10000","10000","11110","10000","10000","11111"};
        case 'F': return {"11111","10000","10000","11110","10000","10000","10000"};
        case 'G': return {"01110","10001","10000","10111","10001","10001","01110"};
        case 'H': return {"10001","10001","10001","11111","10001","10001","10001"};
        case 'I': return {"01110","00100","00100","00100","00100","00100","01110"};
        case 'J': return {"00111","00010","00010","00010","00010","10010","01100"};
        case 'K': return {"10001","10010","10100","11000","10100","10010","10001"};
        case 'L': return {"10000","10000","10000","10000","10000","10000","11111"};
        case 'M': return {"10001","11011","10101","10101","10001","10001","10001"};
        case 'N': return {"10001","11001","10101","10011","10001","10001","10001"};
        case 'O': return {"01110","10001","10001","10001","10001","10001","01110"};
        case 'P': return {"11110","10001","10001","11110","10000","10000","10000"};
        case 'Q': return {"01110","10001","10001","10001","10101","10010","01101"};
        case 'R': return {"11110","10001","10001","11110","10100","10010","10001"};
        case 'S': return {"01111","10000","10000","01110","00001","00001","11110"};
        case 'T': return {"11111","00100","00100","00100","00100","00100","00100"};
        case 'U': return {"10001","10001","10001","10001","10001","10001","01110"};
        case 'V': return {"10001","10001","10001","10001","10001","01010","00100"};
        case 'W': return {"10001","10001","10001","10101","10101","10101","01010"};
        case 'X': return {"10001","10001","01010","00100","01010","10001","10001"};
        case 'Y': return {"10001","10001","01010","00100","00100","00100","00100"};
        case 'Z': return {"11111","00001","00010","00100","01000","10000","11111"};
        case '+': return {"00000","00100","00100","11111","00100","00100","00000"};
        case '-': return {"00000","00000","00000","11111","00000","00000","00000"};
        case ':': return {"00000","00100","00100","00000","00100","00100","00000"};
        case '.': return {"00000","00000","00000","00000","00000","01100","01100"};
        case '/': return {"00001","00010","00010","00100","01000","01000","10000"};
        case '[': return {"01110","01000","01000","01000","01000","01000","01110"};
        case ']': return {"01110","00010","00010","00010","00010","00010","01110"};
        default: return {"00000","00000","00000","00000","00000","00000","00000"};
        }
    }

    char NormalizeOverlayChar(wchar_t ch) noexcept
    {
        if (ch >= L'a' && ch <= L'z') return static_cast<char>(ch - L'a' + L'A');
        if (ch >= L'A' && ch <= L'Z') return static_cast<char>(ch);
        if (ch >= L'0' && ch <= L'9') return static_cast<char>(ch);

        // v53d: use numeric Unicode code points instead of Vietnamese character
        // literals. Some MSVC project/codepage combinations compile literals like
        // accented literals as duplicated byte values and fail with C2196 "case value already
        // used". Numeric constants avoid source-encoding ambiguity.
        switch (static_cast<unsigned int>(ch))
        {
        // A/a family
        case 0x00C0: case 0x00C1: case 0x1EA2: case 0x00C3: case 0x1EA0:
        case 0x0102: case 0x1EB0: case 0x1EAE: case 0x1EB2: case 0x1EB4: case 0x1EB6:
        case 0x00C2: case 0x1EA6: case 0x1EA4: case 0x1EA8: case 0x1EAA: case 0x1EAC:
        case 0x00E0: case 0x00E1: case 0x1EA3: case 0x00E3: case 0x1EA1:
        case 0x0103: case 0x1EB1: case 0x1EAF: case 0x1EB3: case 0x1EB5: case 0x1EB7:
        case 0x00E2: case 0x1EA7: case 0x1EA5: case 0x1EA9: case 0x1EAB: case 0x1EAD:
            return 'A';

        // E/e family
        case 0x00C8: case 0x00C9: case 0x1EBA: case 0x1EBC: case 0x1EB8:
        case 0x00CA: case 0x1EC0: case 0x1EBE: case 0x1EC2: case 0x1EC4: case 0x1EC6:
        case 0x00E8: case 0x00E9: case 0x1EBB: case 0x1EBD: case 0x1EB9:
        case 0x00EA: case 0x1EC1: case 0x1EBF: case 0x1EC3: case 0x1EC5: case 0x1EC7:
            return 'E';

        // I/i family
        case 0x00CC: case 0x00CD: case 0x1EC8: case 0x0128: case 0x1ECA:
        case 0x00EC: case 0x00ED: case 0x1EC9: case 0x0129: case 0x1ECB:
            return 'I';

        // O/o family
        case 0x00D2: case 0x00D3: case 0x1ECE: case 0x00D5: case 0x1ECC:
        case 0x00D4: case 0x1ED2: case 0x1ED0: case 0x1ED4: case 0x1ED6: case 0x1ED8:
        case 0x01A0: case 0x1EDC: case 0x1EDA: case 0x1EDE: case 0x1EE0: case 0x1EE2:
        case 0x00F2: case 0x00F3: case 0x1ECF: case 0x00F5: case 0x1ECD:
        case 0x00F4: case 0x1ED3: case 0x1ED1: case 0x1ED5: case 0x1ED7: case 0x1ED9:
        case 0x01A1: case 0x1EDD: case 0x1EDB: case 0x1EDF: case 0x1EE1: case 0x1EE3:
            return 'O';

        // U/u family
        case 0x00D9: case 0x00DA: case 0x1EE6: case 0x0168: case 0x1EE4:
        case 0x01AF: case 0x1EEA: case 0x1EE8: case 0x1EEC: case 0x1EEE: case 0x1EF0:
        case 0x00F9: case 0x00FA: case 0x1EE7: case 0x0169: case 0x1EE5:
        case 0x01B0: case 0x1EEB: case 0x1EE9: case 0x1EED: case 0x1EEF: case 0x1EF1:
            return 'U';

        // Y/y family
        case 0x1EF2: case 0x00DD: case 0x1EF6: case 0x1EF8: case 0x1EF4:
        case 0x1EF3: case 0x00FD: case 0x1EF7: case 0x1EF9: case 0x1EF5:
            return 'Y';

        // D/d family
        case 0x0110: case 0x0111:
            return 'D';

        case '+': case '-': case ':': case '.': case '/': case '[': case ']':
            return static_cast<char>(ch);

        default:
            return ' ';
        }
    }

    std::string NormalizeOverlayText(std::wstring const &text, size_t maxChars = 32)
    {
        std::string out;
        out.reserve(std::min(maxChars, text.size()));
        bool lastSpace = false;
        for (auto ch : text)
        {
            char normalized = NormalizeOverlayChar(ch);
            if (normalized == ' ')
            {
                if (!lastSpace && !out.empty())
                {
                    out.push_back(' ');
                    lastSpace = true;
                }
            }
            else
            {
                out.push_back(normalized);
                lastSpace = false;
            }
            if (out.size() >= maxChars) break;
        }
        while (!out.empty() && out.back() == ' ') out.pop_back();
        return out;
    }

    int MeasureOverlayTextWidth(std::string const &text, int scale) noexcept
    {
        if (text.empty()) return 0;
        int charWidth = 5 * scale;
        int gap = std::max(1, scale);
        return static_cast<int>(text.size()) * (charWidth + gap) - gap;
    }

    void DrawOverlayText(std::vector<BYTE> &frame, uint32_t width, uint32_t height, std::string text, OverlayBox box, int scale, OverlayColor color, int align = 0) noexcept
    {
        if (scale <= 0 || box.right <= box.left || box.bottom <= box.top) return;
        int available = box.right - box.left;
        while (!text.empty() && MeasureOverlayTextWidth(text, scale) > available)
        {
            text.pop_back();
        }
        int textWidth = MeasureOverlayTextWidth(text, scale);
        int x = box.left;
        if (align == 1) x = box.left + std::max(0, (available - textWidth) / 2);
        if (align == 2) x = box.right - textWidth;
        int y = box.top + std::max(0, ((box.bottom - box.top) - (7 * scale)) / 2);
        for (char ch : text)
        {
            if (ch == ' ')
            {
                x += 4 * scale;
                continue;
            }
            auto glyph = Glyph5x7(ch);
            for (int gy = 0; gy < 7; ++gy)
            {
                for (int gx = 0; gx < 5; ++gx)
                {
                    if (glyph[gy][gx] == '1')
                    {
                        FillRectBgra(frame, width, height, OverlayBox{x + gx * scale, y + gy * scale, x + (gx + 1) * scale, y + (gy + 1) * scale}, color);
                    }
                }
            }
            x += 6 * scale;
            if (x > box.right) break;
        }
    }

    void ApplyNativeLiveOverlayToBgraFrame(std::vector<BYTE> &frame, uint32_t width, uint32_t height) noexcept
    {
        try
        {
            RefreshNativeLiveOverlayStateIfNeeded();
            NativeLiveOverlayState state;
            {
                std::lock_guard<std::mutex> lock(g_nativeOverlayMutex);
                state = g_nativeOverlayState;
            }
            if (!state.visible || frame.empty() || width < 240 || height < 180) return;
            if (state.useSnapshot)
            {
                ApplyOverlaySnapshotBitmapToFrame(frame, width, height);
                return;
            }

            // v64: do not draw the old/native fallback overlay at all. It caused
            // visible flicker between the React overlay PNG and the hand-drawn
            // placeholder during live updates. If no React snapshot is available,
            // send the clean camera frame until the next valid snapshot arrives.
            return;

            const int w = static_cast<int>(width);
            const int h = static_cast<int>(height);
            const OverlayColor red{209, 29, 36, 235};
            const OverlayColor dark{8, 8, 10, 218};
            const OverlayColor darker{0, 0, 0, 205};
            const OverlayColor white{255, 255, 255, 255};
            const OverlayColor softWhite{245, 245, 245, 245};
            const OverlayColor yellow{245, 205, 44, 245};

            OverlayBox logoBg{std::max(8, w / 80), std::max(8, h / 80), std::max(132, w / 4), std::max(46, h / 10)};
            FillRectBgra(frame, width, height, logoBg, darker);
            DrawOverlayText(frame, width, height, "A+PLUS", OverlayBox{logoBg.left + 12, logoBg.top + 4, logoBg.right - 8, logoBg.bottom - 4}, std::max(2, h / 70), red, 0);

            if (state.carom)
            {
                const int panelW = std::max(250, w * 50 / 100);
                const int panelH = std::max(108, h * 24 / 100);
                const int x = std::max(12, w * 3 / 100);
                const int y = h - panelH - std::max(14, h * 4 / 100);
                FillRectBgra(frame, width, height, OverlayBox{x, y, x + panelW, y + panelH}, dark);
                FillRectBgra(frame, width, height, OverlayBox{x, y, x + std::max(6, w / 110), y + panelH}, red);
                FillRectBgra(frame, width, height, OverlayBox{x + 12, y + panelH / 2 - 1, x + panelW - 12, y + panelH / 2 + 1}, softWhite);

                int nameScale = std::max(2, h / 95);
                int scoreScale = std::max(4, h / 50);
                DrawOverlayText(frame, width, height, NormalizeOverlayText(state.leftName, 18), OverlayBox{x + 18, y + 8, x + panelW - 120, y + panelH / 2 - 4}, nameScale, white, 0);
                DrawOverlayText(frame, width, height, std::to_string(state.leftScore), OverlayBox{x + panelW - 108, y + 4, x + panelW - 16, y + panelH / 2 - 4}, scoreScale, yellow, 2);
                DrawOverlayText(frame, width, height, NormalizeOverlayText(state.rightName, 18), OverlayBox{x + 18, y + panelH / 2 + 6, x + panelW - 120, y + panelH - 28}, nameScale, white, 0);
                DrawOverlayText(frame, width, height, std::to_string(state.rightScore), OverlayBox{x + panelW - 108, y + panelH / 2 + 3, x + panelW - 16, y + panelH - 28}, scoreScale, yellow, 2);
                DrawOverlayText(frame, width, height, "GOAL " + std::to_string(state.goal) + "  INN " + std::to_string(state.turns) + "  " + std::to_string(state.timer) + "S", OverlayBox{x + 18, y + panelH - 26, x + panelW - 18, y + panelH - 3}, std::max(1, h / 130), white, 0);
            }
            else
            {
                const int barH = std::max(64, h * 15 / 100);
                const int barX = std::max(18, w * 5 / 100);
                const int barW = w - barX * 2;
                const int barY = h - barH - std::max(14, h * 5 / 100);
                FillRectBgra(frame, width, height, OverlayBox{barX, barY, barX + barW, barY + barH}, red);
                FillRectBgra(frame, width, height, OverlayBox{barX, barY + barH - 6, barX + barW, barY + barH}, softWhite);
                const int scoreBoxW = std::max(110, barW / 5);
                DrawOverlayText(frame, width, height, NormalizeOverlayText(state.leftName, 20), OverlayBox{barX + 18, barY + 6, barX + (barW - scoreBoxW) / 2 - 10, barY + barH - 8}, std::max(2, h / 90), white, 0);
                DrawOverlayText(frame, width, height, std::to_string(state.leftScore) + "-" + std::to_string(state.rightScore), OverlayBox{barX + (barW - scoreBoxW) / 2, barY + 2, barX + (barW + scoreBoxW) / 2, barY + barH - 10}, std::max(4, h / 45), white, 1);
                DrawOverlayText(frame, width, height, NormalizeOverlayText(state.rightName, 20), OverlayBox{barX + (barW + scoreBoxW) / 2 + 10, barY + 6, barX + barW - 18, barY + barH - 8}, std::max(2, h / 90), white, 2);
                DrawOverlayText(frame, width, height, "RACE " + std::to_string(state.goal) + "  INN " + std::to_string(state.turns) + "  " + std::to_string(state.timer) + "S", OverlayBox{barX, barY + barH + 3, barX + barW, std::min(h, barY + barH + 30)}, std::max(1, h / 130), white, 1);
            }
        }
        catch (...) {}
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
            // v53: burn the latest fullscreen-style logo/scoreboard overlay into
            // the raw BGRA camera frame before FFmpeg encodes the YouTube stream.
            std::vector<BYTE> contiguous(frameSize);
            if (static_cast<uint32_t>(stride) == rowBytes && static_cast<uint32_t>(startIndex) + frameSize <= capacity)
            {
                std::memcpy(contiguous.data(), sourceStart, frameSize);
            }
            else
            {
                // Some camera frames have padded rows. FFmpeg rawvideo expects contiguous
                // tightly packed BGRA rows, so collapse stride padding before writing.
                for (uint32_t row = 0; row < height; ++row)
                {
                    const uint64_t srcOffset = static_cast<uint64_t>(startIndex) + static_cast<uint64_t>(row) * static_cast<uint32_t>(stride);
                    if (srcOffset + rowBytes > capacity)
                    {
                        AppendStderrSummary("\n[MediaCapturePipe v53e] plane capacity too small row=" + std::to_string(row) +
                            " stride=" + std::to_string(stride) + " capacity=" + std::to_string(capacity));
                        g_pipeFrameWriteBusy = false;
                        return false;
                    }
                    std::memcpy(contiguous.data() + static_cast<size_t>(row) * rowBytes, planeBytes + srcOffset, rowBytes);
                }
            }
            ApplyNativeLiveOverlayToBgraFrame(contiguous, width, height);
            success = WriteAllToFfmpegStdin(contiguous.data(), frameSize);

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


    winrt::Windows::Foundation::IAsyncAction PrimeMicrophoneAccessAsync()
    {
        using namespace winrt::Windows::Devices::Enumeration;
        using namespace winrt::Windows::Media::Capture;

        try
        {
            auto devices = co_await DeviceInformation::FindAllAsync(DeviceClass::AudioCapture);
            if (devices.Size() == 0)
            {
                g_microphoneAccessSummary = "no Windows audio capture device found";
                co_return;
            }

            auto selected = devices.GetAt(0);
            MediaCaptureInitializationSettings settings;
            settings.StreamingCaptureMode(StreamingCaptureMode::Audio);
            settings.AudioDeviceId(selected.Id());

            MediaCapture mediaCapture;
            co_await mediaCapture.InitializeAsync(settings);
            try { mediaCapture.Close(); } catch (...) {}

            g_microphoneAccessSummary = "ok: " + winrt::to_string(selected.Name());
            co_return;
        }
        catch (winrt::hresult_error const &ex)
        {
            g_microphoneAccessSummary = "failed: " + winrt::to_string(ex.message()) + " hr=" + std::to_string(static_cast<long>(ex.code()));
            co_return;
        }
        catch (std::exception const &ex)
        {
            g_microphoneAccessSummary = std::string("failed: ") + ex.what();
            co_return;
        }
        catch (...)
        {
            g_microphoneAccessSummary = "failed: unknown";
            co_return;
        }
    }

    void PrimeMicrophoneAccessBlocking()
    {
        if (g_microphoneAccessPrimed.exchange(true))
        {
            return;
        }
        try { winrt::init_apartment(winrt::apartment_type::multi_threaded); } catch (...) {}
        try
        {
            PrimeMicrophoneAccessAsync().get();
        }
        catch (winrt::hresult_error const &ex)
        {
            g_microphoneAccessSummary = "failed blocking: " + winrt::to_string(ex.message()) + " hr=" + std::to_string(static_cast<long>(ex.code()));
        }
        catch (std::exception const &ex)
        {
            g_microphoneAccessSummary = std::string("failed blocking: ") + ex.what();
        }
        catch (...)
        {
            g_microphoneAccessSummary = "failed blocking: unknown";
        }
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


    winrt::fire_and_forget CaptureOverlayViewOnUIThread(
        winrt::Microsoft::ReactNative::ReactContext reactContext,
        int64_t nativeTag,
        int32_t requestedWidth,
        int32_t requestedHeight,
        winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept
    {
        try
        {
            auto uiService = winrt::Microsoft::ReactNative::XamlUIService::FromContext(reactContext.Handle());
            auto dependencyObject = uiService.ElementFromReactTag(nativeTag);
            auto element = dependencyObject.try_as<winrt::Windows::UI::Xaml::UIElement>();
            if (!element)
            {
                promise.Resolve("");
                co_return;
            }

            const int32_t width = std::max<int32_t>(320, requestedWidth);
            const int32_t height = std::max<int32_t>(180, requestedHeight);
            auto renderTarget = winrt::Windows::UI::Xaml::Media::Imaging::RenderTargetBitmap();
            co_await renderTarget.RenderAsync(element, width, height);
            auto pixelBuffer = co_await renderTarget.GetPixelsAsync();
            const uint32_t pixelLength = pixelBuffer.Length();
            if (pixelLength == 0)
            {
                promise.Resolve("");
                co_return;
            }

            std::vector<uint8_t> pixels(pixelLength);
            auto reader = winrt::Windows::Storage::Streams::DataReader::FromBuffer(pixelBuffer);
            reader.ReadBytes(pixels);

            auto tempFolder = winrt::Windows::Storage::ApplicationData::Current().TemporaryFolder();
            auto overlayFolder = co_await tempFolder.CreateFolderAsync(
                L"AplusScoreLiveOverlay",
                winrt::Windows::Storage::CreationCollisionOption::OpenIfExists);
            auto file = co_await overlayFolder.CreateFileAsync(
                L"react-fullscreen-overlay.png",
                winrt::Windows::Storage::CreationCollisionOption::ReplaceExisting);
            auto stream = co_await file.OpenAsync(winrt::Windows::Storage::FileAccessMode::ReadWrite);
            auto encoder = co_await winrt::Windows::Graphics::Imaging::BitmapEncoder::CreateAsync(
                winrt::Windows::Graphics::Imaging::BitmapEncoder::PngEncoderId(),
                stream);
            encoder.SetPixelData(
                winrt::Windows::Graphics::Imaging::BitmapPixelFormat::Bgra8,
                winrt::Windows::Graphics::Imaging::BitmapAlphaMode::Premultiplied,
                static_cast<uint32_t>(renderTarget.PixelWidth()),
                static_cast<uint32_t>(renderTarget.PixelHeight()),
                96.0,
                96.0,
                pixels);
            co_await encoder.FlushAsync();
            promise.Resolve(winrt::to_string(file.Path()));
        }
        catch (...)
        {
            promise.Resolve("");
        }
    }

namespace winrt::billiardsgrade::implementation
{
    void WindowsFfmpegLiveModule::Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept
    {
        m_reactContext = reactContext;
    }

    void WindowsFfmpegLiveModule::CaptureOverlayView(int64_t nativeTag, int32_t width, int32_t height, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept
    {
        try
        {
            if (!m_reactContext)
            {
                promise.Resolve("");
                return;
            }
            auto reactContext = m_reactContext;
            reactContext.UIDispatcher().Post([reactContext, nativeTag, width, height, promise]() mutable {
                CaptureOverlayViewOnUIThread(reactContext, nativeTag, width, height, promise);
            });
        }
        catch (...)
        {
            promise.Resolve("");
        }
    }

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
                PrimeMicrophoneAccessBlocking();

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
                result["microphoneAccessPrimed"] = JSValue(g_microphoneAccessPrimed.load());
                result["microphoneAccessSummary"] = JSValue(g_microphoneAccessSummary);
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
                PrimeMicrophoneAccessBlocking();

                std::unique_lock<std::mutex> lock(g_processMutex);
                if (g_processActive && g_processInfo.hProcess)
                {
                    DWORD exitCode = 0;
                    if (GetExitCodeProcess(g_processInfo.hProcess, &exitCode) && exitCode == STILL_ACTIVE)
                    {
                        result["status"] = JSValue("live");
                        result["pid"] = JSValue(static_cast<double>(g_processInfo.dwProcessId));
                        result["alreadyRunning"] = JSValue(true);
                        result["error"] = JSValue("");
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

                ResetNativeLiveOverlayStateForNewSession();

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

                    auto pipeArgs = BuildMediaCapturePipeArgs(args, g_pipeFrameWidth, g_pipeFrameHeight);
                    // v71 stable live first: microphone is fully disabled in the live startup path.
                    // Keep YouTube ingest stable with the anullsrc audio input generated by TypeScript.
                    // If an older DirectShow audio argument is still present, replace it with anullsrc.
                    std::string micBridgeSummary;
                    bool micBridgeActive = false;
                    bool silentReplaced = false;
                    auto silentArgs = ReplaceDirectShowAudioInputsWithSilent(pipeArgs, silentReplaced);
                    if (silentReplaced)
                    {
                        pipeArgs = std::move(silentArgs);
                        micBridgeSummary = "Microphone disabled; replaced DirectShow audio with stable anullsrc fallback";
                    }

                    lock.lock();

                    if (!micBridgeSummary.empty())
                    {
                        g_stderrSummary += "\n[LiveAudio] " + micBridgeSummary;
                        if (g_stderrSummary.size() > 4096)
                        {
                            g_stderrSummary.erase(0, g_stderrSummary.size() - 4096);
                        }
                    }

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

                    auto command = BuildCommandLine(ffmpegPath, pipeArgs);
                    std::vector<wchar_t> commandLine(command.begin(), command.end());
                    commandLine.push_back(L'\0');

                    PROCESS_INFORMATION pi{};
                    // Near-parallel v2: do not launch FFmpeg below normal priority.
                    // Encoding plus RTMPS upload is latency-sensitive; BELOW_NORMAL can add
                    // avoidable buffering on busy Windows machines.
                    DWORD launchFlags = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | NORMAL_PRIORITY_CLASS;
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
                        if (micBridgeActive)
                        {
                            StopMicBridgeScheduledTaskBestEffort();
                            g_externalScheduledLive = false;
                        }
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
                    g_stderrSummary = "FFmpeg started with MediaCapture raw BGRA pipe v73 stable-overlay-throttle-anullsrc-no-mic (" + std::to_string(g_pipeFrameWidth) + "x" + std::to_string(g_pipeFrameHeight) + ").";
                    if (!micBridgeSummary.empty())
                    {
                        g_stderrSummary += "\n[LiveAudio] " + micBridgeSummary;
                    }
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
                        if (micBridgeActive)
                        {
                            StopMicBridgeScheduledTaskBestEffort();
                            g_externalScheduledLive = false;
                        }
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
                        if (micBridgeActive)
                        {
                            StopMicBridgeScheduledTaskBestEffort();
                            g_externalScheduledLive = false;
                        }
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
                        if (micBridgeActive)
                        {
                            StopMicBridgeScheduledTaskBestEffort();
                            g_externalScheduledLive = false;
                        }
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
                    result["captureSource"] = JSValue("mediacapture-rawvideo-pipe-v73-stable-overlay-throttle-anullsrc-no-mic");
                    result["micBridgeDisabled"] = JSValue(micBridgeActive);
                    result["micBridgeSummary"] = JSValue(micBridgeSummary);
                    result["width"] = JSValue(static_cast<double>(g_pipeFrameWidth));
                    result["height"] = JSValue(static_cast<double>(g_pipeFrameHeight));
                    result["microphoneAccessPrimed"] = JSValue(g_microphoneAccessPrimed.load());
                    result["microphoneAccessSummary"] = JSValue(g_microphoneAccessSummary);
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
                // to mark the stream live anyway and YouTube stayed "Sap dien ra".
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
                    StopMicBridgeScheduledTaskBestEffort();
                    RunProcessAndCapture(L"C:\\Windows\\System32\\taskkill.exe", {"/IM", "ffmpeg.exe", "/F", "/T"}, 4000);
                    g_externalScheduledLive = false;
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
