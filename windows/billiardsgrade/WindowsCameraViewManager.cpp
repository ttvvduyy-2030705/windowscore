#include "pch.h"
#include "WindowsCameraViewManager.h"

#include <algorithm>
#include <cwctype>
#include <filesystem>
#include <string>

#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.Devices.Enumeration.h>
#include <winrt/Windows.Media.Capture.h>
#include <winrt/Windows.Media.MediaProperties.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.System.Threading.h>
#include <winrt/Windows.UI.Core.h>
#include <winrt/Windows.UI.Xaml.Controls.h>
#include <winrt/Windows.UI.Xaml.Media.h>

using namespace winrt;
using namespace Windows::Devices::Enumeration;
using namespace Windows::Foundation;
using namespace Windows::Media::Capture;
using namespace Windows::Media::MediaProperties;
using namespace Windows::Storage;
using namespace Windows::UI::Core;
using namespace Windows::UI::Xaml;
using namespace Windows::UI::Xaml::Controls;
using namespace Windows::UI::Xaml::Media;
using namespace Microsoft::ReactNative;

namespace
{
    MediaCapture g_mediaCapture{nullptr};
    bool g_previewReady = false;
    bool g_isRecording = false;
    hstring g_lastRecordingPath{};

    void DebugLog(std::wstring const &message) noexcept
    {
        OutputDebugStringW((L"[WindowsCameraView] " + message + L"\n").c_str());
    }

    std::wstring ToLower(std::wstring value)
    {
        std::transform(value.begin(), value.end(), value.begin(), [](wchar_t ch) {
            return static_cast<wchar_t>(std::towlower(ch));
        });
        return value;
    }

    bool LooksLikeExternalCamera(DeviceInformation const &device)
    {
        auto const name = ToLower(std::wstring(device.Name().c_str()));
        auto const id = ToLower(std::wstring(device.Id().c_str()));

        return name.find(L"usb") != std::wstring::npos ||
               name.find(L"webcam") != std::wstring::npos ||
               name.find(L"external") != std::wstring::npos ||
               name.find(L"uvc") != std::wstring::npos ||
               id.find(L"usb") != std::wstring::npos ||
               id.find(L"vid_") != std::wstring::npos;
    }

    std::filesystem::path ParentPath(std::wstring const &path)
    {
        std::filesystem::path fsPath(path);
        return fsPath.parent_path();
    }

    hstring FileNameFromPath(std::wstring const &path)
    {
        std::filesystem::path fsPath(path);
        return hstring(fsPath.filename().wstring());
    }

    IAsyncOperation<StorageFile> CreateStorageFileForPathAsync(hstring const &requestedPath)
    {
        std::wstring path(requestedPath.c_str());
        auto parent = ParentPath(path);

        if (!parent.empty())
        {
            std::error_code ec;
            std::filesystem::create_directories(parent, ec);
        }

        try
        {
            auto folder = co_await StorageFolder::GetFolderFromPathAsync(hstring(parent.wstring()));
            auto file = co_await folder.CreateFileAsync(FileNameFromPath(path), CreationCollisionOption::ReplaceExisting);
            co_return file;
        }
        catch (hresult_error const &ex)
        {
            DebugLog(L"recording output path fallback: " + std::wstring(ex.message().c_str()));
        }
        catch (...)
        {
            DebugLog(L"recording output path fallback: unknown error");
        }

        auto localFolder = ApplicationData::Current().LocalFolder();
        auto recordingsFolder = co_await localFolder.CreateFolderAsync(L"Recordings", CreationCollisionOption::OpenIfExists);
        auto file = co_await recordingsFolder.CreateFileAsync(FileNameFromPath(path), CreationCollisionOption::ReplaceExisting);
        co_return file;
    }

    fire_and_forget StopPreviewAsync(Grid grid) noexcept
    {
        try
        {
            auto media = grid.Tag().try_as<MediaCapture>();
            if (media)
            {
                if (g_isRecording)
                {
                    co_await media.StopRecordAsync();
                    g_isRecording = false;
                    DebugLog(L"recording stopped on unload: " + std::wstring(g_lastRecordingPath.c_str()));
                }

                co_await media.StopPreviewAsync();
            }

            if (g_mediaCapture == media)
            {
                g_mediaCapture = nullptr;
                g_previewReady = false;
            }

            grid.Tag(nullptr);
            DebugLog(L"preview stopped");
        }
        catch (hresult_error const &ex)
        {
            DebugLog(L"preview stop error: " + std::wstring(ex.message().c_str()));
        }
    }

    fire_and_forget StartPreviewAsync(Grid grid, CaptureElement capture) noexcept
    {
        try
        {
            DebugLog(L"enumerate devices start");

            auto devices = co_await DeviceInformation::FindAllAsync(DeviceClass::VideoCapture);
            DebugLog(L"camera devices found: " + std::to_wstring(devices.Size()));

            if (devices.Size() == 0)
            {
                DebugLog(L"preview error: no video capture devices found");
                co_return;
            }

            DeviceInformation selected = devices.GetAt(0);
            for (auto const &device : devices)
            {
                DebugLog(L"camera device: " + std::wstring(device.Name().c_str()) + L" | " + std::wstring(device.Id().c_str()));
                if (LooksLikeExternalCamera(device))
                {
                    selected = device;
                    break;
                }
            }

            DebugLog(L"selected camera: " + std::wstring(selected.Name().c_str()) + L" | " + std::wstring(selected.Id().c_str()));

            MediaCaptureInitializationSettings settings;
            settings.StreamingCaptureMode(StreamingCaptureMode::AudioAndVideo);
            settings.VideoDeviceId(selected.Id());
            settings.SharingMode(MediaCaptureSharingMode::ExclusiveControl);
            settings.MemoryPreference(MediaCaptureMemoryPreference::Auto);

            auto mediaCapture = MediaCapture();
            co_await mediaCapture.InitializeAsync(settings);

            capture.Stretch(Stretch::UniformToFill);
            capture.Source(mediaCapture);
            grid.Tag(mediaCapture);
            g_mediaCapture = mediaCapture;

            co_await mediaCapture.StartPreviewAsync();
            g_previewReady = true;
            DebugLog(L"preview ready");
        }
        catch (hresult_error const &ex)
        {
            g_mediaCapture = nullptr;
            g_previewReady = false;
            DebugLog(L"preview error: " + std::wstring(ex.message().c_str()));
            try
            {
                capture.Source(nullptr);
                grid.Tag(nullptr);
            }
            catch (...) {}
        }
    }
} // namespace

namespace winrt::billiardsgrade::implementation
{
    IAsyncOperation<hstring> WindowsCameraStartRecordingAsync(hstring const &requestedPath)
    {
        DebugLog(L"recording start requested: " + std::wstring(requestedPath.c_str()));

        if (!g_mediaCapture || !g_previewReady)
        {
            throw hresult_error(E_FAIL, L"Windows camera preview is not ready");
        }

        if (g_isRecording)
        {
            DebugLog(L"recording already active: " + std::wstring(g_lastRecordingPath.c_str()));
            co_return g_lastRecordingPath;
        }

        auto file = co_await CreateStorageFileForPathAsync(requestedPath);
        auto profile = MediaEncodingProfile::CreateMp4(VideoEncodingQuality::HD720p);

        co_await g_mediaCapture.StartRecordToStorageFileAsync(profile, file);
        g_isRecording = true;
        g_lastRecordingPath = file.Path();
        DebugLog(L"recording file created: " + std::wstring(g_lastRecordingPath.c_str()));
        co_return g_lastRecordingPath;
    }

    IAsyncOperation<hstring> WindowsCameraStopRecordingAsync()
    {
        DebugLog(L"recording stop requested");

        if (!g_mediaCapture || !g_isRecording)
        {
            DebugLog(L"recording stop ignored: not recording");
            co_return g_lastRecordingPath;
        }

        co_await g_mediaCapture.StopRecordAsync();
        g_isRecording = false;
        DebugLog(L"recording finalized path: " + std::wstring(g_lastRecordingPath.c_str()));
        co_return g_lastRecordingPath;
    }

    winrt::hstring WindowsCameraViewManager::Name() noexcept
    {
        return L"WindowsCameraView";
    }

    FrameworkElement WindowsCameraViewManager::CreateView() noexcept
    {
        Grid grid;
        CaptureElement capture;

        capture.Stretch(Stretch::UniformToFill);
        capture.HorizontalAlignment(HorizontalAlignment::Stretch);
        capture.VerticalAlignment(VerticalAlignment::Stretch);

        grid.Children().Append(capture);
        grid.Unloaded([grid](IInspectable const &, RoutedEventArgs const &) {
            StopPreviewAsync(grid);
        });

        StartPreviewAsync(grid, capture);
        return grid;
    }
} // namespace winrt::billiardsgrade::implementation
