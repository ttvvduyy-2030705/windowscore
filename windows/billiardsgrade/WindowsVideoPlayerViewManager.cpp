#include "pch.h"
#include "WindowsVideoPlayerViewManager.h"
#include "JSValue.h"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <sstream>
#include <string>

#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Media.Core.h>
#include <winrt/Windows.Media.Playback.h>
#include <winrt/Windows.UI.Xaml.Controls.h>
#include <winrt/Windows.UI.Xaml.Media.h>

using namespace winrt::Microsoft::ReactNative;
using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Media::Core;
using namespace Windows::Media::Playback;
using namespace Windows::UI::Xaml;
using namespace Windows::UI::Xaml::Controls;
using namespace Windows::UI::Xaml::Media;

namespace
{
    void DebugLog(std::wstring const &message) noexcept
    {
        OutputDebugStringW((L"[WindowsVideoPlayer] " + message + L"\n").c_str());
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

        auto lower = uri;
        std::transform(lower.begin(), lower.end(), lower.begin(), [](char ch) {
            return static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
        });

        if (lower.rfind("file://", 0) == 0 ||
            lower.rfind("http://", 0) == 0 ||
            lower.rfind("https://", 0) == 0)
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
                        player.Source(nullptr);
                        continue;
                    }

                    DebugLog(L"sourceUri=" + std::wstring(winrt::to_hstring(sourceUri).c_str()));
                    SeekToTailWhenReady(player, tailSeconds);
                    player.Source(MediaSource::CreateFromUri(Uri(winrt::to_hstring(sourceUri))));
                    player.Play();
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
