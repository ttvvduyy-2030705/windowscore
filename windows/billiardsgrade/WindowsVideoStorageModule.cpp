#include "pch.h"
#include "WindowsVideoStorageModule.h"

#include <algorithm>
#include <chrono>
#include <cwctype>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.FileProperties.h>

using namespace winrt::Microsoft::ReactNative;
using namespace winrt::Windows::Storage;
using namespace winrt::Windows::Storage::FileProperties;

namespace
{
    constexpr wchar_t const *AplusFolderName = L"Aplus Score";
    constexpr wchar_t const *ReplayFolderName = L"Replay";
    constexpr wchar_t const *HistoryFolderName = L"History";

    std::string JsonEscape(std::string const &value)
    {
        std::ostringstream escaped;
        for (char ch : value)
        {
            switch (ch)
            {
            case '\\': escaped << "\\\\"; break;
            case '"': escaped << "\\\""; break;
            case '\b': escaped << "\\b"; break;
            case '\f': escaped << "\\f"; break;
            case '\n': escaped << "\\n"; break;
            case '\r': escaped << "\\r"; break;
            case '\t': escaped << "\\t"; break;
            default:
                if (static_cast<unsigned char>(ch) < 0x20)
                {
                    constexpr char hex[] = "0123456789abcdef";
                    escaped << "\\u00" << hex[(ch >> 4) & 0x0F] << hex[ch & 0x0F];
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

    std::wstring NormalizePathString(std::string const &input)
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
        return std::wstring(winrt::to_hstring(value).c_str());
    }

    std::filesystem::path ToPath(std::string const &input)
    {
        return std::filesystem::path(NormalizePathString(input));
    }

    std::string ToUtf8(std::filesystem::path const &path)
    {
        auto value = winrt::to_string(winrt::hstring(path.wstring()));
        std::replace(value.begin(), value.end(), '\\', '/');
        return value;
    }

    std::string HStringToUtf8(winrt::hstring const &value)
    {
        auto text = winrt::to_string(value);
        std::replace(text.begin(), text.end(), '\\', '/');
        return text;
    }

    std::wstring ToLower(std::wstring value)
    {
        std::transform(value.begin(), value.end(), value.begin(), [](wchar_t ch) {
            return static_cast<wchar_t>(std::towlower(ch));
        });
        return value;
    }

    std::vector<std::wstring> SplitPath(std::wstring const &value)
    {
        std::vector<std::wstring> parts;
        std::wstring current;
        for (auto ch : value)
        {
            if (ch == L'\\' || ch == L'/')
            {
                if (!current.empty())
                {
                    parts.push_back(current);
                    current.clear();
                }
                continue;
            }
            current.push_back(ch);
        }
        if (!current.empty())
        {
            parts.push_back(current);
        }
        return parts;
    }

    std::optional<std::vector<std::wstring>> AplusRelativeSegments(std::string const &path)
    {
        auto normalized = NormalizePathString(path);
        auto parts = SplitPath(normalized);
        for (size_t index = 0; index < parts.size(); ++index)
        {
            if (ToLower(parts[index]) == L"aplus score")
            {
                return std::vector<std::wstring>(parts.begin() + static_cast<std::ptrdiff_t>(index + 1), parts.end());
            }
        }
        return std::nullopt;
    }

    bool IsAplusPath(std::string const &path)
    {
        return AplusRelativeSegments(path).has_value();
    }

    StorageFolder VideosLibraryFolder()
    {
        try
        {
            return KnownFolders::VideosLibrary();
        }
        catch (winrt::hresult_error const &ex)
        {
            throw std::runtime_error("videosLibrary access failed: " + winrt::to_string(ex.message()));
        }
    }

    StorageFolder EnsureAplusRootFolder()
    {
        auto videos = VideosLibraryFolder();
        try
        {
            return videos.CreateFolderAsync(AplusFolderName, CreationCollisionOption::OpenIfExists).get();
        }
        catch (winrt::hresult_error const &ex)
        {
            throw std::runtime_error("Cannot create Aplus Score under Windows Videos library: " + winrt::to_string(ex.message()));
        }
    }

    StorageFolder EnsureStandardFolders()
    {
        auto root = EnsureAplusRootFolder();
        root.CreateFolderAsync(ReplayFolderName, CreationCollisionOption::OpenIfExists).get();
        root.CreateFolderAsync(HistoryFolderName, CreationCollisionOption::OpenIfExists).get();
        return root;
    }

    StorageFolder EnsureFolderSegments(std::vector<std::wstring> const &segments)
    {
        auto folder = EnsureAplusRootFolder();
        for (auto const &segment : segments)
        {
            if (segment.empty())
            {
                continue;
            }
            folder = folder.CreateFolderAsync(winrt::hstring(segment), CreationCollisionOption::OpenIfExists).get();
        }
        return folder;
    }

    StorageFolder TryGetFolderSegments(std::vector<std::wstring> const &segments)
    {
        try
        {
            auto folder = EnsureAplusRootFolder();
            for (auto const &segment : segments)
            {
                if (segment.empty())
                {
                    continue;
                }
                folder = folder.GetFolderAsync(winrt::hstring(segment)).get();
            }
            return folder;
        }
        catch (...)
        {
            return nullptr;
        }
    }

    StorageFolder EnsureParentFolder(std::vector<std::wstring> const &segments)
    {
        if (segments.empty())
        {
            return EnsureAplusRootFolder();
        }
        return EnsureFolderSegments(std::vector<std::wstring>(segments.begin(), segments.end() - 1));
    }

    StorageFile CreateFileForSegments(std::vector<std::wstring> const &segments, CreationCollisionOption option)
    {
        if (segments.empty())
        {
            throw std::runtime_error("Missing file name");
        }
        auto parent = EnsureParentFolder(segments);
        return parent.CreateFileAsync(winrt::hstring(segments.back()), option).get();
    }

    StorageFile GetFileForSegments(std::vector<std::wstring> const &segments)
    {
        if (segments.empty())
        {
            throw std::runtime_error("Missing file name");
        }
        auto parent = TryGetFolderSegments(std::vector<std::wstring>(segments.begin(), segments.end() - 1));
        if (!parent)
        {
            throw std::runtime_error("Parent folder does not exist");
        }
        return parent.GetFileAsync(winrt::hstring(segments.back())).get();
    }

    winrt::Windows::Storage::IStorageItem TryGetItemForSegments(std::vector<std::wstring> const &segments)
    {
        try
        {
            if (segments.empty())
            {
                return EnsureAplusRootFolder();
            }
            auto parent = TryGetFolderSegments(std::vector<std::wstring>(segments.begin(), segments.end() - 1));
            if (!parent)
            {
                return nullptr;
            }
            return parent.TryGetItemAsync(winrt::hstring(segments.back())).get();
        }
        catch (...)
        {
            return nullptr;
        }
    }

    std::filesystem::path EnvPath(wchar_t const *name)
    {
        wchar_t *value = nullptr;
        size_t len = 0;
        std::wstring result;
        if (_wdupenv_s(&value, &len, name) == 0 && value && len > 0)
        {
            result = value;
        }
        if (value)
        {
            free(value);
        }
        return std::filesystem::path(result);
    }

    std::filesystem::path UserProfileVideosPath()
    {
        auto userProfile = EnvPath(L"USERPROFILE");
        if (!userProfile.empty())
        {
            return userProfile / L"Videos" / AplusFolderName;
        }
        auto homeDrive = EnvPath(L"HOMEDRIVE");
        auto homePath = EnvPath(L"HOMEPATH");
        if (!homeDrive.empty() && !homePath.empty())
        {
            return std::filesystem::path(homeDrive.wstring() + homePath.wstring()) / L"Videos" / AplusFolderName;
        }
        return std::filesystem::path(L"Videos") / AplusFolderName;
    }

    std::string AplusRootPathString(StorageFolder const &root)
    {
        auto path = HStringToUtf8(root.Path());
        if (!path.empty())
        {
            return path;
        }
        return ToUtf8(UserProfileVideosPath());
    }

    int64_t DateTimeToMs(winrt::Windows::Foundation::DateTime const &value)
    {
        try
        {
            auto systemTime = winrt::clock::to_sys(value);
            return std::chrono::duration_cast<std::chrono::milliseconds>(systemTime.time_since_epoch()).count();
        }
        catch (...)
        {
            return 0;
        }
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

    std::string ItemJson(winrt::Windows::Storage::IStorageItem const &item)
    {
        auto isDirectory = item.IsOfType(StorageItemTypes::Folder);
        uint64_t size = 0;
        int64_t mtime = DateTimeToMs(item.DateCreated());

        if (!isDirectory)
        {
            try
            {
                auto file = item.as<StorageFile>();
                auto properties = file.GetBasicPropertiesAsync().get();
                size = properties.Size();
                mtime = DateTimeToMs(properties.DateModified());
            }
            catch (...) {}
        }

        std::ostringstream json;
        json << "{";
        json << "\"name\":\"" << JsonEscape(winrt::to_string(item.Name())) << "\",";
        json << "\"path\":\"" << JsonEscape(HStringToUtf8(item.Path())) << "\",";
        json << "\"size\":" << static_cast<unsigned long long>(size) << ",";
        json << "\"mtime\":" << mtime << ",";
        json << "\"ctime\":" << DateTimeToMs(item.DateCreated()) << ",";
        json << "\"type\":\"" << (isDirectory ? "directory" : "file") << "\",";
        json << "\"isDirectory\":" << (isDirectory ? "true" : "false");
        json << "}";
        return json.str();
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
}

namespace winrt::billiardsgrade::implementation
{
    void WindowsVideoStorageModule::GetVideosBaseDir(ReactPromise<std::string> promise) noexcept
    {
        try
        {
            auto root = EnsureStandardFolders();
            promise.Resolve(AplusRootPathString(root));
        }
        catch (std::exception const &ex)
        {
            RejectWithMessage(promise, ex.what());
        }
    }

    void WindowsVideoStorageModule::GetFallbackBaseDir(ReactPromise<std::string> promise) noexcept
    {
        try
        {
            auto root = EnsureStandardFolders();
            promise.Resolve(AplusRootPathString(root));
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
            auto segments = AplusRelativeSegments(path);
            if (segments)
            {
                auto item = TryGetItemForSegments(*segments);
                promise.Resolve(item != nullptr);
                return;
            }

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
            auto segments = AplusRelativeSegments(path);
            if (segments)
            {
                EnsureFolderSegments(*segments);
                promise.Resolve(true);
                return;
            }

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
            auto segments = AplusRelativeSegments(path);
            if (segments)
            {
                auto folder = TryGetFolderSegments(*segments);
                if (!folder)
                {
                    promise.Resolve("[]");
                    return;
                }

                std::ostringstream json;
                json << "[";
                bool first = true;
                auto items = folder.GetItemsAsync().get();
                for (auto const &item : items)
                {
                    if (!first)
                    {
                        json << ",";
                    }
                    json << ItemJson(item);
                    first = false;
                }
                json << "]";
                promise.Resolve(json.str());
                return;
            }

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
            auto segments = AplusRelativeSegments(path);
            if (segments)
            {
                auto item = TryGetItemForSegments(*segments);
                if (!item)
                {
                    throw std::runtime_error("Path does not exist");
                }
                promise.Resolve(ItemJson(item));
                return;
            }

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
            auto segments = AplusRelativeSegments(path);
            if (segments)
            {
                auto file = GetFileForSegments(*segments);
                promise.Resolve(winrt::to_string(FileIO::ReadTextAsync(file).get()));
                return;
            }

            std::ifstream file(ToPath(path), std::ios::binary);
            if (!file)
            {
                throw std::runtime_error("Unable to open file");
            }
            std::ostringstream buffer;
            buffer << file.rdbuf();
            promise.Resolve(buffer.str());
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
            auto segments = AplusRelativeSegments(path);
            if (segments)
            {
                auto file = CreateFileForSegments(*segments, CreationCollisionOption::ReplaceExisting);
                FileIO::WriteTextAsync(file, winrt::to_hstring(content)).get();
                promise.Resolve(true);
                return;
            }

            auto target = ToPath(path);
            EnsureParent(target);
            std::ofstream file(target, std::ios::binary | std::ios::trunc);
            if (!file)
            {
                throw std::runtime_error("Unable to write file");
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
            auto segments = AplusRelativeSegments(path);
            if (segments)
            {
                std::string current;
                try
                {
                    auto file = GetFileForSegments(*segments);
                    current = winrt::to_string(FileIO::ReadTextAsync(file).get());
                }
                catch (...) {}

                auto file = CreateFileForSegments(*segments, CreationCollisionOption::ReplaceExisting);
                FileIO::WriteTextAsync(file, winrt::to_hstring(current + content)).get();
                promise.Resolve(true);
                return;
            }

            auto target = ToPath(path);
            EnsureParent(target);
            std::ofstream file(target, std::ios::binary | std::ios::app);
            if (!file)
            {
                throw std::runtime_error("Unable to append file");
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
            auto segments = AplusRelativeSegments(path);
            if (segments)
            {
                auto item = TryGetItemForSegments(*segments);
                if (item)
                {
                    item.DeleteAsync(StorageDeleteOption::PermanentDelete).get();
                }
                promise.Resolve(true);
                return;
            }

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
            auto fromSegments = AplusRelativeSegments(from);
            auto toSegments = AplusRelativeSegments(to);
            if (fromSegments && toSegments)
            {
                if (toSegments->empty())
                {
                    throw std::runtime_error("Missing destination file name");
                }
                auto source = GetFileForSegments(*fromSegments);
                auto destinationFolder = EnsureParentFolder(*toSegments);
                source.CopyAsync(destinationFolder, winrt::hstring(toSegments->back()), NameCollisionOption::ReplaceExisting).get();
                promise.Resolve(true);
                return;
            }

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
            auto fromSegments = AplusRelativeSegments(from);
            auto toSegments = AplusRelativeSegments(to);
            if (fromSegments && toSegments)
            {
                if (toSegments->empty())
                {
                    throw std::runtime_error("Missing destination file name");
                }
                auto source = GetFileForSegments(*fromSegments);
                auto destinationFolder = EnsureParentFolder(*toSegments);
                source.MoveAsync(destinationFolder, winrt::hstring(toSegments->back()), NameCollisionOption::ReplaceExisting).get();
                promise.Resolve(true);
                return;
            }

            auto source = ToPath(from);
            auto target = ToPath(to);
            EnsureParent(target);
            std::error_code ec;
            std::filesystem::rename(source, target, ec);
            if (ec)
            {
                std::filesystem::copy_file(source, target, std::filesystem::copy_options::overwrite_existing, ec);
                if (ec)
                {
                    throw std::runtime_error(ec.message());
                }
                std::filesystem::remove(source, ec);
                if (ec)
                {
                    throw std::runtime_error(ec.message());
                }
            }
            promise.Resolve(true);
        }
        catch (std::exception const &ex)
        {
            RejectWithMessage(promise, ex.what());
        }
    }
}
