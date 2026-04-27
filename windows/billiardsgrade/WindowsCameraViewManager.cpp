#include "pch.h"
#include "WindowsCameraViewManager.h"

#include <algorithm>
#include <cwctype>
#include <filesystem>
#include <string>

#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.ApplicationModel.Core.h>
#include <winrt/Windows.Devices.Enumeration.h>
#include <winrt/Windows.Media.Capture.h>
#include <winrt/Windows.Media.MediaProperties.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.UI.Core.h>
#include <winrt/Windows.UI.Xaml.Controls.h>
#include <winrt/Windows.UI.Xaml.Media.h>

using namespace winrt;
using namespace Windows::ApplicationModel::Core;
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
    CoreDispatcher g_cameraDispatcher{nullptr};
    bool g_previewReady = false;
    bool g_isRecording = false;
    bool g_recordingStarting = false;
    bool g_recordingStopping = false;
    hstring g_lastRecordingPath{};

    void DebugLog(std::wstring const &message) noexcept
    {
        OutputDebugStringW((L"[WindowsCameraView] " + message + L"\n").c_str());
    }

    std::wstring BoolText(bool value)
    {
        return value ? L"true" : L"false";
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

    CoreDispatcher GetCameraDispatcher() noexcept
    {
        if (g_cameraDispatcher)
        {
            return g_cameraDispatcher;
        }

        try
        {
            auto mainView = CoreApplication::MainView();
            if (mainView && mainView.CoreWindow())
            {
                return mainView.CoreWindow().Dispatcher();
            }
        }
        catch (...) {}

        return nullptr;
    }

    bool HasCameraThreadAccess() noexcept
    {
        auto dispatcher = GetCameraDispatcher();
        return dispatcher ? dispatcher.HasThreadAccess() : false;
    }

    IAsyncAction ResumeOnCameraDispatcherAsync()
    {
        auto dispatcher = GetCameraDispatcher();
        if (dispatcher && !dispatcher.HasThreadAccess())
        {
            co_await resume_foreground(dispatcher);
        }
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
        // This function is always called from the camera dispatcher coroutine.
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
            co_await ResumeOnCameraDispatcherAsync();
            auto file = co_await folder.CreateFileAsync(FileNameFromPath(path), CreationCollisionOption::ReplaceExisting);
            co_await ResumeOnCameraDispatcherAsync();
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
        co_await ResumeOnCameraDispatcherAsync();
        auto file = co_await recordingsFolder.CreateFileAsync(FileNameFromPath(path), CreationCollisionOption::ReplaceExisting);
        co_await ResumeOnCameraDispatcherAsync();
        co_return file;
    }

    fire_and_forget StartRecordingOnCameraDispatcherAsync(hstring requestedPath) noexcept
    {
        try
        {
            co_await ResumeOnCameraDispatcherAsync();

            DebugLog(L"v13 recording command running on camera dispatcher threadAccess=" + BoolText(HasCameraThreadAccess()));

            auto media = g_mediaCapture;
            if (!media || !g_previewReady)
            {
                g_recordingStarting = false;
                DebugLog(L"recording start failed: preview is not ready");
                co_return;
            }

            if (g_isRecording)
            {
                g_recordingStarting = false;
                DebugLog(L"recording already active: " + std::wstring(g_lastRecordingPath.c_str()));
                co_return;
            }

            auto file = co_await CreateStorageFileForPathAsync(requestedPath);
            co_await ResumeOnCameraDispatcherAsync();

            auto profile = MediaEncodingProfile::CreateMp4(VideoEncodingQuality::HD720p);
            DebugLog(L"recording calling StartRecordToStorageFileAsync threadAccess=" + BoolText(HasCameraThreadAccess()));

            co_await media.StartRecordToStorageFileAsync(profile, file);
            co_await ResumeOnCameraDispatcherAsync();

            g_isRecording = true;
            g_recordingStarting = false;
            g_lastRecordingPath = file.Path();
            DebugLog(L"recording file created: " + std::wstring(g_lastRecordingPath.c_str()));
        }
        catch (hresult_error const &ex)
        {
            g_isRecording = false;
            g_recordingStarting = false;
            DebugLog(L"recording start error: " + std::wstring(ex.message().c_str()));
        }
        catch (...)
        {
            g_isRecording = false;
            g_recordingStarting = false;
            DebugLog(L"recording start error: unknown");
        }
    }

    fire_and_forget StopRecordingOnCameraDispatcherAsync() noexcept
    {
        try
        {
            co_await ResumeOnCameraDispatcherAsync();
            DebugLog(L"v13 stop command running on camera dispatcher threadAccess=" + BoolText(HasCameraThreadAccess()));

            auto media = g_mediaCapture;
            if (!media || !g_isRecording)
            {
                g_recordingStopping = false;
                DebugLog(L"recording stop ignored: not recording");
                co_return;
            }

            co_await media.StopRecordAsync();
            co_await ResumeOnCameraDispatcherAsync();

            g_isRecording = false;
            g_recordingStopping = false;
            DebugLog(L"recording finalized path: " + std::wstring(g_lastRecordingPath.c_str()));
        }
        catch (hresult_error const &ex)
        {
            g_recordingStopping = false;
            DebugLog(L"recording stop error: " + std::wstring(ex.message().c_str()));
        }
        catch (...)
        {
            g_recordingStopping = false;
            DebugLog(L"recording stop error: unknown");
        }
    }

    fire_and_forget StopPreviewAsync(Grid grid) noexcept
    {
        try
        {
            if (!g_cameraDispatcher)
            {
                g_cameraDispatcher = grid.Dispatcher();
            }
            co_await ResumeOnCameraDispatcherAsync();

            auto media = grid.Tag().try_as<MediaCapture>();
            if (media)
            {
                if (g_isRecording)
                {
                    co_await media.StopRecordAsync();
                    co_await ResumeOnCameraDispatcherAsync();
                    g_isRecording = false;
                    g_recordingStarting = false;
                    g_recordingStopping = false;
                    DebugLog(L"recording stopped on unload: " + std::wstring(g_lastRecordingPath.c_str()));
                }

                co_await media.StopPreviewAsync();
                co_await ResumeOnCameraDispatcherAsync();
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
            g_cameraDispatcher = grid.Dispatcher();
            co_await ResumeOnCameraDispatcherAsync();

            DebugLog(L"v13 dispatcher-owned recorder loaded");
            DebugLog(L"enumerate devices start");

            auto devices = co_await DeviceInformation::FindAllAsync(DeviceClass::VideoCapture);
            co_await ResumeOnCameraDispatcherAsync();
            DebugLog(L"camera devices found: " + std::to_wstring(devices.Size()) + L" threadAccess=" + BoolText(HasCameraThreadAccess()));

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

            co_await ResumeOnCameraDispatcherAsync();
            auto mediaCapture = MediaCapture();
            DebugLog(L"media capture create threadAccess=" + BoolText(HasCameraThreadAccess()));
            co_await mediaCapture.InitializeAsync(settings);
            co_await ResumeOnCameraDispatcherAsync();

            capture.Stretch(Stretch::UniformToFill);
            capture.Source(mediaCapture);
            grid.Tag(mediaCapture);
            g_mediaCapture = mediaCapture;

            DebugLog(L"preview start threadAccess=" + BoolText(HasCameraThreadAccess()));
            co_await mediaCapture.StartPreviewAsync();
            co_await ResumeOnCameraDispatcherAsync();
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
        DebugLog(L"v13 WindowsCameraStartRecordingAsync scheduled: " + std::wstring(requestedPath.c_str()));

        // Do not dereference g_mediaCapture on the React Native native-module thread.
        // MediaCapture is apartment-affine; the dispatcher coroutine validates it.
        if (g_isRecording || g_recordingStarting)
        {
            DebugLog(L"recording already requested/active: " + std::wstring(g_lastRecordingPath.c_str()));
            co_return g_lastRecordingPath.size() == 0 ? requestedPath : g_lastRecordingPath;
        }

        g_recordingStarting = true;
        g_lastRecordingPath = requestedPath;
        StartRecordingOnCameraDispatcherAsync(requestedPath);

        // Resolve immediately after the start command is enqueued.  The JS layer
        // keeps the session active and verifies the real file after stop.
        co_return requestedPath;
    }

    IAsyncOperation<hstring> WindowsCameraStopRecordingAsync()
    {
        DebugLog(L"v13 WindowsCameraStopRecordingAsync scheduled");

        // Do not touch the MediaCapture object on the React Native module thread.
        // Always enqueue stop on the camera dispatcher; it will ignore safely if idle.
        if (!g_recordingStopping)
        {
            g_recordingStopping = true;
            StopRecordingOnCameraDispatcherAsync();
        }

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
