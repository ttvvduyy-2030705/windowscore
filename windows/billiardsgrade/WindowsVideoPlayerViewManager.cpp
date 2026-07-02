#include "pch.h"
#include "WindowsVideoPlayerViewManager.h"
#include "JSValue.h"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <sstream>
#include <string>

#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Media.Core.h>
#include <winrt/Windows.Media.Playback.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.UI.Xaml.Controls.h>
#include <winrt/Windows.UI.Xaml.Media.h>

using namespace winrt::Microsoft::ReactNative;
using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Media::Core;
using namespace Windows::Media::Playback;
using namespace Windows::Storage;
using namespace Windows::UI::Xaml;
using namespace Windows::UI::Xaml::Controls;
using namespace Windows::UI::Xaml::Media;

namespace
{
    void DebugLog(std::wstring const &message) noexcept
    {
        OutputDebugStringW((L"[WindowsVideoPlayer] " + message + L"\n").c_str());
    }

    std::string ToLowerAscii(std::string value)
    {
        std::transform(value.begin(), value.end(), value.begin(), [](char ch) {
            return static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
        });
        return value;
    }

    bool IsWindowsAbsolutePath(std::string const &value)
    {
        return value.size() >= 3 &&
            std::isalpha(static_cast<unsigned char>(value[0])) &&
            value[1] == ':' &&
            (value[2] == '/' || value[2] == '\\');
    }

    std::string PercentDecode(std::string const &value)
    {
        std::string decoded;
        decoded.reserve(value.size());

        for (size_t index = 0; index < value.size(); ++index)
        {
            if (value[index] == '%' && index + 2 < value.size())
            {
                auto hex = value.substr(index + 1, 2);
                char *end = nullptr;
                auto decodedChar = static_cast<char>(std::strtol(hex.c_str(), &end, 16));
                if (end != nullptr && *end == '\0')
                {
                    decoded.push_back(decodedChar);
                    index += 2;
                    continue;
                }
            }

            decoded.push_back(value[index]);
        }

        return decoded;
    }

    std::string EncodeFileUriPart(std::string const &part)
    {
        std::ostringstream encoded;
        constexpr char hex[] = "0123456789ABCDEF";

        for (unsigned char ch : part)
        {
            if ((ch >= 'A' && ch <= 'Z') ||
                (ch >= 'a' && ch <= 'z') ||
                (ch >= '0' && ch <= '9') ||
                ch == '-' || ch == '_' || ch == '.' || ch == '~' || ch == ':')
            {
                encoded << ch;
            }
            else
            {
                encoded << '%' << hex[ch >> 4] << hex[ch & 15];
            }
        }

        return encoded.str();
    }

    std::string NormalizeUri(std::string uri)
    {
        if (uri.empty())
        {
            return uri;
        }

        std::replace(uri.begin(), uri.end(), '\\', '/');

        auto lower = ToLowerAscii(uri);

        if (lower.rfind("file:///", 0) == 0)
        {
            // Keep file URI as URI for logs/source identity. Actual local files are opened
            // through StorageFile below to avoid UWP/sandbox URI access issues.
            return uri;
        }

        if (lower.rfind("file://", 0) == 0)
        {
            return std::string("file:///") + uri.substr(7);
        }

        if (lower.rfind("http://", 0) == 0 ||
            lower.rfind("https://", 0) == 0 ||
            lower.rfind("rtsp://", 0) == 0 ||
            lower.rfind("rtsps://", 0) == 0 ||
            lower.rfind("rtspu://", 0) == 0)
        {
            return uri;
        }

        std::ostringstream encoded;
        encoded << "file:///";

        size_t start = 0;
        while (start <= uri.size())
        {
            auto slash = uri.find('/', start);
            auto part = slash == std::string::npos ? uri.substr(start) : uri.substr(start, slash - start);
            encoded << EncodeFileUriPart(part);

            if (slash == std::string::npos)
            {
                break;
            }

            encoded << "/";
            start = slash + 1;
        }

        return encoded.str();
    }

    std::string LocalPathFromSource(std::string sourceUri)
    {
        if (sourceUri.empty())
        {
            return {};
        }

        std::replace(sourceUri.begin(), sourceUri.end(), '\\', '/');
        auto lower = ToLowerAscii(sourceUri);

        std::string path;
        if (lower.rfind("file:///", 0) == 0)
        {
            path = sourceUri.substr(8);
        }
        else if (lower.rfind("file://", 0) == 0)
        {
            path = sourceUri.substr(7);
            if (!path.empty() && path[0] == '/')
            {
                path.erase(path.begin());
            }
        }
        else if (IsWindowsAbsolutePath(sourceUri))
        {
            path = sourceUri;
        }
        else
        {
            return {};
        }

        path = PercentDecode(path);
        if (path.size() >= 3 && path[0] == '/' && std::isalpha(static_cast<unsigned char>(path[1])) && path[2] == ':')
        {
            path.erase(path.begin());
        }

        std::replace(path.begin(), path.end(), '/', '\\');
        return path;
    }

    std::string PropString(JSValue const &value)
    {
        if (value.Type() == JSValueType::String)
        {
            return value.AsString();
        }

        return {};
    }

    bool PropBool(JSValue const &value, bool fallback)
    {
        if (value.Type() == JSValueType::Boolean)
        {
            return value.AsBoolean();
        }

        return fallback;
    }

    double PropDouble(JSValue const &value, double fallback)
    {
        if (value.Type() == JSValueType::Double || value.Type() == JSValueType::Int64)
        {
            return value.AsDouble();
        }

        return fallback;
    }

    bool MapBool(JSValueObject const &propertyMap, char const *key, bool fallback)
    {
        auto it = propertyMap.find(key);
        return it == propertyMap.end() ? fallback : PropBool(it->second, fallback);
    }

    double MapDouble(JSValueObject const &propertyMap, char const *key, double fallback)
    {
        auto it = propertyMap.find(key);
        return it == propertyMap.end() ? fallback : PropDouble(it->second, fallback);
    }

    Stretch StretchFromResizeMode(std::string const &resizeMode)
    {
        if (resizeMode == "cover")
        {
            return Stretch::UniformToFill;
        }

        if (resizeMode == "stretch")
        {
            return Stretch::Fill;
        }

        return Stretch::Uniform;
    }

    double TailSecondsFromProps(JSValueObject const &propertyMap)
    {
        auto tailIt = propertyMap.find("startAtTailSeconds");
        if (tailIt == propertyMap.end())
        {
            return 0;
        }

        return std::max(0.0, PropDouble(tailIt->second, 0));
    }

    void SeekToTailWhenReady(MediaPlayer const &player, double tailSeconds)
    {
        if (tailSeconds <= 0)
        {
            return;
        }

        player.MediaOpened([player, tailSeconds](MediaPlayer const &, IInspectable const &) {
            try
            {
                auto duration = player.PlaybackSession().NaturalDuration();
                auto totalTicks = duration.count();
                auto tailTicks = static_cast<int64_t>(tailSeconds * 10000000.0);
                auto targetTicks = totalTicks > tailTicks ? totalTicks - tailTicks : 0;
                player.PlaybackSession().Position(Windows::Foundation::TimeSpan{targetTicks});
                DebugLog(L"seek to replay tail seconds=" + std::to_wstring(static_cast<int>(tailSeconds)));
            }
            catch (...)
            {
                DebugLog(L"seek to replay tail failed");
            }
        });
    }

    fire_and_forget ApplyMediaSourceAsync(
        winrt::weak_ref<MediaPlayerElement> weakElement,
        std::string sourceUri,
        double tailSeconds,
        bool paused,
        double rate) noexcept
    {
        apartment_context uiThread;
        auto normalizedSource = winrt::to_hstring(sourceUri);
        MediaSource mediaSource{nullptr};

        try
        {
            auto localPath = LocalPathFromSource(sourceUri);
            if (!localPath.empty())
            {
                DebugLog(L"open local mp4 via StorageFile path=" + std::wstring(winrt::to_hstring(localPath).c_str()));
                auto storageFile = co_await StorageFile::GetFileFromPathAsync(winrt::to_hstring(localPath));
                mediaSource = MediaSource::CreateFromStorageFile(storageFile);
                DebugLog(L"MediaSource created from StorageFile");
            }
            else
            {
                mediaSource = MediaSource::CreateFromUri(Uri(normalizedSource));
                DebugLog(L"MediaSource created from Uri");
            }
        }
        catch (hresult_error const &ex)
        {
            DebugLog(L"StorageFile/MediaSource open failed: " + std::wstring(ex.message().c_str()) + L"; fallback to Uri");
            try
            {
                mediaSource = MediaSource::CreateFromUri(Uri(normalizedSource));
            }
            catch (hresult_error const &uriEx)
            {
                DebugLog(L"Uri fallback failed: " + std::wstring(uriEx.message().c_str()));
                co_return;
            }
            catch (...)
            {
                DebugLog(L"Uri fallback failed: unknown");
                co_return;
            }
        }
        catch (...)
        {
            DebugLog(L"StorageFile/MediaSource open failed: unknown");
            co_return;
        }

        co_await uiThread;

        auto element = weakElement.get();
        if (!element)
        {
            DebugLog(L"element released before source applied");
            co_return;
        }

        auto currentSource = winrt::unbox_value_or<winrt::hstring>(element.Tag(), L"");
        if (currentSource != normalizedSource)
        {
            DebugLog(L"ignore stale source apply; view has newer source");
            co_return;
        }

        auto player = element.MediaPlayer();
        if (!player)
        {
            player = MediaPlayer();
            element.SetMediaPlayer(player);
        }

        try
        {
            SeekToTailWhenReady(player, tailSeconds);
            player.Source(mediaSource);
            if (rate > 0)
            {
                player.PlaybackSession().PlaybackRate(rate);
            }

            if (paused)
            {
                player.Pause();
            }
            else
            {
                player.Play();
            }

            DebugLog(L"source applied and playback requested");
        }
        catch (hresult_error const &ex)
        {
            DebugLog(L"apply source failed: " + std::wstring(ex.message().c_str()));
        }
        catch (...)
        {
            DebugLog(L"apply source failed: unknown");
        }
    }

}

namespace winrt::billiardsgrade::implementation
{
    winrt::hstring WindowsVideoPlayerViewManager::Name() noexcept
    {
        return L"WindowsVideoPlayerView";
    }

    FrameworkElement WindowsVideoPlayerViewManager::CreateView() noexcept
    {
        MediaPlayerElement element;
        MediaPlayer player;

        element.SetMediaPlayer(player);
        element.AreTransportControlsEnabled(false);
        element.Stretch(Stretch::Uniform);
        element.AutoPlay(true);
        element.HorizontalAlignment(HorizontalAlignment::Stretch);
        element.VerticalAlignment(VerticalAlignment::Stretch);

        return element;
    }

    Windows::Foundation::Collections::IMapView<hstring, ViewManagerPropertyType>
    WindowsVideoPlayerViewManager::NativeProps() noexcept
    {
        auto nativeProps = winrt::single_threaded_map<hstring, ViewManagerPropertyType>();
        nativeProps.Insert(L"sourceUri", ViewManagerPropertyType::String);
        nativeProps.Insert(L"paused", ViewManagerPropertyType::Boolean);
        nativeProps.Insert(L"rate", ViewManagerPropertyType::Number);
        nativeProps.Insert(L"resizeMode", ViewManagerPropertyType::String);
        nativeProps.Insert(L"controls", ViewManagerPropertyType::Boolean);
        nativeProps.Insert(L"startAtTailSeconds", ViewManagerPropertyType::Number);
        return nativeProps.GetView();
    }

    void WindowsVideoPlayerViewManager::UpdateProperties(
        FrameworkElement const &view,
        IJSValueReader const &propertyMapReader) noexcept
    {
        auto element = view.try_as<MediaPlayerElement>();
        if (!element)
        {
            return;
        }

        auto propertyMap = JSValueObject::ReadFrom(propertyMapReader);
        auto tailSeconds = TailSecondsFromProps(propertyMap);
        auto pausedFromMap = MapBool(propertyMap, "paused", false);
        auto rateFromMap = MapDouble(propertyMap, "rate", 1.0);
        auto player = element.MediaPlayer();

        if (!player)
        {
            player = MediaPlayer();
            element.SetMediaPlayer(player);
        }

        for (auto const &pair : propertyMap)
        {
            auto const &propertyName = pair.first;
            auto const &propertyValue = pair.second;

            try
            {
                if (propertyName == "sourceUri")
                {
                    auto sourceUri = NormalizeUri(PropString(propertyValue));
                    if (sourceUri.empty())
                    {
                        try
                        {
                            player.Pause();
                            player.Source(nullptr);
                        }
                        catch (...)
                        {
                            DebugLog(L"source clear stop failed");
                        }
                        element.Tag(winrt::box_value(L""));
                        DebugLog(L"source cleared; playback stopped");
                        continue;
                    }

                    auto normalizedSource = winrt::to_hstring(sourceUri);
                    auto currentSource = winrt::unbox_value_or<winrt::hstring>(element.Tag(), L"");
                    if (currentSource == normalizedSource)
                    {
                        DebugLog(L"sourceUri unchanged; keep source and apply paused state");
                        if (pausedFromMap)
                        {
                            player.Pause();
                        }
                        else
                        {
                            player.Play();
                        }
                        continue;
                    }

                    DebugLog(L"sourceUri=" + std::wstring(normalizedSource.c_str()));
                    try
                    {
                        player.Pause();
                        player.Source(nullptr);
                    }
                    catch (...)
                    {
                        DebugLog(L"previous source stop before switch failed");
                    }
                    element.Tag(winrt::box_value(normalizedSource));
                    ApplyMediaSourceAsync(winrt::make_weak(element), sourceUri, tailSeconds, pausedFromMap, rateFromMap);
                }
                else if (propertyName == "paused")
                {
                    if (PropBool(propertyValue, false))
                    {
                        player.Pause();
                    }
                    else
                    {
                        player.Play();
                    }
                }
                else if (propertyName == "rate")
                {
                    auto rate = PropDouble(propertyValue, 1.0);
                    if (rate > 0)
                    {
                        player.PlaybackSession().PlaybackRate(rate);
                    }
                }
                else if (propertyName == "resizeMode")
                {
                    element.Stretch(StretchFromResizeMode(PropString(propertyValue)));
                }
                else if (propertyName == "controls")
                {
                    element.AreTransportControlsEnabled(PropBool(propertyValue, false));
                }
            }
            catch (hresult_error const &ex)
            {
                DebugLog(L"property update error: " + std::wstring(ex.message().c_str()));
            }
            catch (...)
            {
                DebugLog(L"property update error: unknown");
            }
        }
    }
}
