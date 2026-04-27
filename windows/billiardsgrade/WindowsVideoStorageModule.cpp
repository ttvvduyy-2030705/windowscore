#include "pch.h"
#include "WindowsVideoStorageModule.h"

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>

#include <winrt/Windows.Storage.h>

using namespace winrt::Microsoft::ReactNative;

namespace
{
    std::string JsonEscape(std::string const &value)
    {
        std::ostringstream escaped;
        for (char ch : value)
        {
            switch (ch)
            {
            case '\\':
                escaped << "\\\\";
                break;
            case '"':
                escaped << "\\\"";
                break;
            case '\b':
                escaped << "\\b";
                break;
            case '\f':
                escaped << "\\f";
                break;
            case '\n':
                escaped << "\\n";
                break;
            case '\r':
                escaped << "\\r";
                break;
            case '\t':
                escaped << "\\t";
                break;
            default:
                if (static_cast<unsigned char>(ch) < 0x20)
                {
                    escaped << "\\u00";
                    constexpr char hex[] = "0123456789abcdef";
                    escaped << hex[(ch >> 4) & 0x0F] << hex[ch & 0x0F];
                }
                else
                {
                    escaped << ch;
                }
                break;
            }
        }
        return escaped.str();
    }

    std::string PercentDecode(std::string value)
    {
        std::string result;
        result.reserve(value.size());

        for (size_t index = 0; index < value.size(); ++index)
        {
            if (value[index] == '%' && index + 2 < value.size())
            {
                auto hex = value.substr(index + 1, 2);
                char *end = nullptr;
                auto decoded = std::strtol(hex.c_str(), &end, 16);
                if (end && *end == '\0')
                {
                    result.push_back(static_cast<char>(decoded));
                    index += 2;
                    continue;
                }
            }

            result.push_back(value[index]);
        }

        return result;
    }

    std::filesystem::path ToPath(std::string const &input)
    {
        std::string value = input;
        auto lower = value;
        std::transform(lower.begin(), lower.end(), lower.begin(), [](char ch) {
            return static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
        });

        if (lower.rfind("file:///", 0) == 0)
        {
            value = value.substr(8);
        }
        else if (lower.rfind("file://", 0) == 0)
        {
            value = value.substr(7);
        }

        value = PercentDecode(value);
        std::replace(value.begin(), value.end(), '/', '\\');

        return std::filesystem::path(std::wstring(winrt::to_hstring(value).c_str()));
    }

    std::string ToUtf8(std::filesystem::path const &path)
    {
        auto value = winrt::to_string(winrt::hstring(path.wstring()));
        std::replace(value.begin(), value.end(), '\\', '/');
        return value;
    }

    int64_t LastWriteTimeMs(std::filesystem::path const &path)
    {
        std::error_code ec;
        auto fileTime = std::filesystem::last_write_time(path, ec);
        if (ec)
        {
            return 0;
        }

        auto systemTime = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
            fileTime - std::filesystem::file_time_type::clock::now() + std::chrono::system_clock::now());
        return std::chrono::duration_cast<std::chrono::milliseconds>(systemTime.time_since_epoch()).count();
    }

    uintmax_t FileSizeSafe(std::filesystem::path const &path)
    {
        std::error_code ec;
        if (!std::filesystem::is_regular_file(path, ec) || ec)
        {
            return 0;
        }

        auto size = std::filesystem::file_size(path, ec);
        return ec ? 0 : size;
    }

    std::string ItemJson(std::filesystem::path const &path)
    {
        std::error_code ec;
        auto isDirectory = std::filesystem::is_directory(path, ec);
        auto name = winrt::to_string(winrt::hstring(path.filename().wstring()));
        auto fullPath = ToUtf8(path);
        auto size = isDirectory ? 0 : FileSizeSafe(path);
        auto mtime = LastWriteTimeMs(path);

        std::ostringstream json;
        json << "{";
        json << "\"name\":\"" << JsonEscape(name) << "\",";
        json << "\"path\":\"" << JsonEscape(fullPath) << "\",";
        json << "\"size\":" << static_cast<unsigned long long>(size) << ",";
        json << "\"mtime\":" << mtime << ",";
        json << "\"ctime\":" << mtime << ",";
        json << "\"type\":\"" << (isDirectory ? "directory" : "file") << "\",";
        json << "\"isDirectory\":" << (isDirectory ? "true" : "false");
        json << "}";
        return json.str();
    }

    void Reject(ReactError const &error, ReactPromise<bool> const &promise) noexcept
    {
        promise.Reject(error);
    }

    template <typename TPromise>
    void RejectWithMessage(TPromise const &promise, std::string const &message) noexcept
    {
        auto error = ReactError();
        error.Message = message;
        promise.Reject(error);
    }

    void EnsureParent(std::filesystem::path const &path)
    {
        auto parent = path.parent_path();
        if (!parent.empty())
        {
            std::error_code ec;
            std::filesystem::create_directories(parent, ec);
            if (ec)
            {
                throw std::runtime_error(ec.message());
            }
        }
    }

    std::filesystem::path FallbackBasePath()
    {
        // In a packaged React Native Windows/UWP app, arbitrary paths such as
        // C:\\video or C:\\Users\\<User>\\Videos can still be denied by the
        // app container unless the OS grants broad file-system access.
        // ApplicationData.LocalFolder is always writable and persistent, so it
        // is the final safe fallback for history/replay videos when C:\\video is
        // blocked.
        try
        {
            auto localFolder = winrt::Windows::Storage::ApplicationData::Current().LocalFolder();
            return std::filesystem::path(std::wstring(localFolder.Path().c_str())) / L"aplus score";
        }
        catch (...)
        {
            wchar_t *localAppData = nullptr;
            size_t len = 0;
            std::wstring base = L"C:\\Users\\Public\\AppData\\Local";

            if (_wdupenv_s(&localAppData, &len, L"LOCALAPPDATA") == 0 && localAppData && len > 0)
            {
                base = localAppData;
            }

            if (localAppData)
            {
                free(localAppData);
            }

            return std::filesystem::path(base) / L"billiardsgrade" / L"aplus score";
        }
    }

}

namespace winrt::billiardsgrade::implementation
{
    void WindowsVideoStorageModule::GetFallbackBaseDir(ReactPromise<std::string> promise) noexcept
    {
        try
        {
            promise.Resolve(ToUtf8(FallbackBasePath()));
        }
        catch (std::exception const &ex)
        {
            RejectWithMessage(promise, ex.what());
        }
    }

    void WindowsVideoStorageModule::Exists(std::string path, ReactPromise<bool> promise) noexcept
    {
        try
        {
            std::error_code ec;
            auto exists = std::filesystem::exists(ToPath(path), ec);
            promise.Resolve(!ec && exists);
        }
        catch (std::exception const &ex)
        {
            RejectWithMessage(promise, ex.what());
        }
    }

    void WindowsVideoStorageModule::Mkdir(std::string path, ReactPromise<bool> promise) noexcept
    {
        try
        {
            std::error_code ec;
            std::filesystem::create_directories(ToPath(path), ec);
            if (ec)
            {
                throw std::runtime_error(ec.message());
            }

            promise.Resolve(true);
        }
        catch (std::exception const &ex)
        {
            RejectWithMessage(promise, ex.what());
        }
    }

    void WindowsVideoStorageModule::ReadDir(std::string path, ReactPromise<std::string> promise) noexcept
    {
        try
        {
            auto folder = ToPath(path);
            if (!std::filesystem::exists(folder) || !std::filesystem::is_directory(folder))
            {
                promise.Resolve("[]");
                return;
            }

            std::ostringstream json;
            json << "[";
            bool first = true;

            for (auto const &entry : std::filesystem::directory_iterator(folder))
            {
                if (!first)
                {
                    json << ",";
                }

                json << ItemJson(entry.path());
                first = false;
            }

            json << "]";
            promise.Resolve(json.str());
        }
        catch (std::exception const &ex)
        {
            RejectWithMessage(promise, ex.what());
        }
    }

    void WindowsVideoStorageModule::Stat(std::string path, ReactPromise<std::string> promise) noexcept
    {
        try
        {
            auto target = ToPath(path);
            if (!std::filesystem::exists(target))
            {
                throw std::runtime_error("Path does not exist");
            }

            promise.Resolve(ItemJson(target));
        }
        catch (std::exception const &ex)
        {
            RejectWithMessage(promise, ex.what());
        }
    }

    void WindowsVideoStorageModule::ReadFile(std::string path, ReactPromise<std::string> promise) noexcept
    {
        try
        {
            std::ifstream file(ToPath(path), std::ios::in | std::ios::binary);
            if (!file)
            {
                throw std::runtime_error("Cannot open file for reading");
            }

            std::ostringstream contents;
            contents << file.rdbuf();
            promise.Resolve(contents.str());
        }
        catch (std::exception const &ex)
        {
            RejectWithMessage(promise, ex.what());
        }
    }

    void WindowsVideoStorageModule::WriteFile(std::string path, std::string content, ReactPromise<bool> promise) noexcept
    {
        try
        {
            auto target = ToPath(path);
            EnsureParent(target);

            std::ofstream file(target, std::ios::out | std::ios::binary | std::ios::trunc);
            if (!file)
            {
                throw std::runtime_error("Cannot open file for writing");
            }

            file << content;
            promise.Resolve(true);
        }
        catch (std::exception const &ex)
        {
            RejectWithMessage(promise, ex.what());
        }
    }

    void WindowsVideoStorageModule::AppendFile(std::string path, std::string content, ReactPromise<bool> promise) noexcept
    {
        try
        {
            auto target = ToPath(path);
            EnsureParent(target);

            std::ofstream file(target, std::ios::out | std::ios::binary | std::ios::app);
            if (!file)
            {
                throw std::runtime_error("Cannot open file for append");
            }

            file << content;
            promise.Resolve(true);
        }
        catch (std::exception const &ex)
        {
            RejectWithMessage(promise, ex.what());
        }
    }

    void WindowsVideoStorageModule::Unlink(std::string path, ReactPromise<bool> promise) noexcept
    {
        try
        {
            auto target = ToPath(path);
            std::error_code ec;

            if (std::filesystem::is_directory(target, ec))
            {
                std::filesystem::remove_all(target, ec);
            }
            else
            {
                std::filesystem::remove(target, ec);
            }

            if (ec)
            {
                throw std::runtime_error(ec.message());
            }

            promise.Resolve(true);
        }
        catch (std::exception const &ex)
        {
            RejectWithMessage(promise, ex.what());
        }
    }

    void WindowsVideoStorageModule::CopyFile(std::string from, std::string to, ReactPromise<bool> promise) noexcept
    {
        try
        {
            auto source = ToPath(from);
            auto target = ToPath(to);
            EnsureParent(target);

            std::error_code ec;
            std::filesystem::copy_file(source, target, std::filesystem::copy_options::overwrite_existing, ec);
            if (ec)
            {
                throw std::runtime_error(ec.message());
            }

            promise.Resolve(true);
        }
        catch (std::exception const &ex)
        {
            RejectWithMessage(promise, ex.what());
        }
    }

    void WindowsVideoStorageModule::MoveFile(std::string from, std::string to, ReactPromise<bool> promise) noexcept
    {
        try
        {
            auto source = ToPath(from);
            auto target = ToPath(to);
            EnsureParent(target);

            std::error_code ec;
            std::filesystem::rename(source, target, ec);
            if (ec)
            {
                ec.clear();
                std::filesystem::copy_file(source, target, std::filesystem::copy_options::overwrite_existing, ec);
                if (ec)
                {
                    throw std::runtime_error(ec.message());
                }

                std::filesystem::remove(source, ec);
            }

            promise.Resolve(true);
        }
        catch (std::exception const &ex)
        {
            RejectWithMessage(promise, ex.what());
        }
    }
}
