#include "pch.h"
#include "WindowsCameraViewManager.h"

#include <algorithm>
#include <chrono>
#include <cwctype>
#include <filesystem>
#include <string>
#include <vector>

#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.ApplicationModel.Core.h>
#include <winrt/Windows.Devices.Enumeration.h>
#include <winrt/Windows.Media.Capture.h>
#include <winrt/Windows.Media.MediaProperties.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.FileProperties.h>
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
using namespace Windows::Storage::FileProperties;
using namespace Windows::UI::Core;
using namespace Windows::UI::Xaml;
using namespace Windows::UI::Xaml::Controls;
using namespace Windows::UI::Xaml::Media;
using namespace Microsoft::ReactNative;

namespace
{
    MediaCapture g_mediaCapture{nullptr};
    winrt::agile_ref<MediaCapture> g_mediaCaptureAgile{};
    CoreDispatcher g_cameraDispatcher{nullptr};
    bool g_previewReady = false;
    bool g_isRecording = false;
    bool g_recordingStarting = false;
    bool g_recordingStopping = false;
    hstring g_lastRecordingPath{};
    StorageFile g_currentRecordingFile{nullptr};

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

    MediaCapture GetMediaCaptureForCurrentApartment() noexcept
    {
        try
        {
            if (g_mediaCaptureAgile)
            {
                auto media = g_mediaCaptureAgile.get();
                if (media)
                {
                    return media;
                }
            }
        }
        catch (hresult_error const &ex)
        {
            DebugLog(L"agile MediaCapture get failed: " + std::wstring(ex.message().c_str()));
        }
        catch (...)
        {
            DebugLog(L"agile MediaCapture get failed: unknown");
        }
        return g_mediaCapture;
    }

    IAsyncAction ResumeOnCameraDispatcherAsync()
    {
        auto dispatcher = GetCameraDispatcher();
        if (dispatcher && !dispatcher.HasThreadAccess())
        {
            co_await resume_foreground(dispatcher);
        }
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

    std::vector<std::wstring> AplusRelativeSegmentsFromPath(std::wstring const &requestedPath, bool &matched)
    {
        auto parts = SplitPath(requestedPath);
        matched = false;
        for (size_t index = 0; index < parts.size(); ++index)
        {
            if (ToLower(parts[index]) == L"aplus score")
            {
                matched = true;
                return std::vector<std::wstring>(parts.begin() + static_cast<std::ptrdiff_t>(index + 1), parts.end());
            }
        }
        return {};
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

    uint64_t PhysicalFileSizeSafe(std::wstring const &path)
    {
        try
        {
            std::error_code ec;
            std::filesystem::path fsPath(path);
            if (!std::filesystem::is_regular_file(fsPath, ec) || ec)
            {
                return 0;
            }

            auto size = std::filesystem::file_size(fsPath, ec);
            return ec ? 0 : static_cast<uint64_t>(size);
        }
        catch (...)
        {
            return 0;
        }
    }

    IAsyncOperation<uint64_t> GetFinalizedFileSizeAsync(StorageFile const &file)
    {
        if (!file)
        {
            co_return 0;
        }

        uint64_t size = 0;

        for (int attempt = 0; attempt < 20; ++attempt)
        {
            try
            {
                auto properties = co_await file.GetBasicPropertiesAsync();
                size = properties.Size();
            }
            catch (...)
            {
                size = 0;
            }

            if (size == 0)
            {
                size = PhysicalFileSizeSafe(std::wstring(file.Path().c_str()));
            }

            if (size > 0)
            {
                co_return size;
            }

            co_await winrt::resume_after(std::chrono::milliseconds(250));
        }

        co_return size;
    }

    IAsyncOperation<StorageFolder> EnsureAplusRootFolderAsync()
    {
        try
        {
            auto videos = KnownFolders::VideosLibrary();
            auto root = co_await videos.CreateFolderAsync(L"Aplus Score", CreationCollisionOption::OpenIfExists);
            co_await ResumeOnCameraDispatcherAsync();
            co_return root;
        }
        catch (hresult_error const &ex)
        {
            DebugLog(L"recording VideosLibrary access failed: " + std::wstring(ex.message().c_str()));
            auto message = std::wstring(L"Cannot access Windows Videos library for recording: ") + std::wstring(ex.message().c_str());
            throw hresult_error(ex.code(), winrt::hstring(message.c_str()));
        }
    }

    IAsyncOperation<StorageFolder> EnsureAplusParentFolderAsync(std::vector<std::wstring> const &segments)
    {
        auto folder = co_await EnsureAplusRootFolderAsync();
        co_await ResumeOnCameraDispatcherAsync();
        if (segments.size() <= 1)
        {
            co_return folder;
        }
        for (size_t index = 0; index + 1 < segments.size(); ++index)
        {
            if (segments[index].empty())
            {
                continue;
            }
            folder = co_await folder.CreateFolderAsync(hstring(segments[index]), CreationCollisionOption::OpenIfExists);
            co_await ResumeOnCameraDispatcherAsync();
        }
        co_return folder;
    }

    IAsyncOperation<StorageFile> CreateStorageFileForPathAsync(hstring const &requestedPath)
    {
        // Packaged Windows apps cannot safely create files in Videos by direct
        // C:\Users\... paths. For Aplus Score recordings, always resolve via
        // KnownFolders::VideosLibrary + StorageFolder/StorageFile.
        std::wstring path(requestedPath.c_str());
        bool isAplusPath = false;
        auto segments = AplusRelativeSegmentsFromPath(path, isAplusPath);

        if (isAplusPath)
        {
            if (segments.empty())
            {
                throw hresult_error(E_INVALIDARG, L"Missing recording file name under Aplus Score");
            }
            try
            {
                auto folder = co_await EnsureAplusParentFolderAsync(segments);
                co_await ResumeOnCameraDispatcherAsync();
                auto file = co_await folder.CreateFileAsync(hstring(segments.back()), CreationCollisionOption::ReplaceExisting);
                co_await ResumeOnCameraDispatcherAsync();
                DebugLog(L"recording output StorageFile created via VideosLibrary: " + std::wstring(file.Path().c_str()));
                co_return file;
            }
            catch (hresult_error const &ex)
            {
                DebugLog(L"recording output VideosLibrary create failed: " + std::wstring(ex.message().c_str()));
                auto message =
                    std::wstring(L"Cannot create recording file through Windows Videos library: ") +
                    std::wstring(requestedPath.c_str()) + L" (" + std::wstring(ex.message().c_str()) + L")";
                throw hresult_error(ex.code(), winrt::hstring(message.c_str()));
            }
            catch (...)
            {
                DebugLog(L"recording output VideosLibrary create failed: unknown error");
                auto message =
                    std::wstring(L"Cannot create recording file through Windows Videos library: ") +
                    std::wstring(requestedPath.c_str());
                throw hresult_error(E_ACCESSDENIED, winrt::hstring(message.c_str()));
            }
        }

        // Non-Aplus paths are kept as a compatibility fallback for any legacy caller outside the replay/history flow.
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
            DebugLog(L"recording output path failed: " + std::wstring(ex.message().c_str()));
            auto message =
                std::wstring(L"Cannot create recording file at requested Windows path: ") +
                std::wstring(requestedPath.c_str()) + L" (" + std::wstring(ex.message().c_str()) + L")";
            throw hresult_error(ex.code(), winrt::hstring(message.c_str()));
        }
    }


    IAsyncOperation<hstring> StartRecordingOnCameraDispatcherAsync(hstring requestedPath)
    {
        try
        {
            co_await ResumeOnCameraDispatcherAsync();

            DebugLog(L"v17 recording command running on camera dispatcher threadAccess=" + BoolText(HasCameraThreadAccess()));

            // Do not keep the MediaCapture COM interface in a local variable across
            // any awaited storage operation. MediaCapture is apartment/thread-affine;
            // carrying a captured interface through coroutine suspension can trigger:
            // "The application called an interface that was marshalled for a different thread."
            if (!g_previewReady)
            {
                g_recordingStarting = false;
                DebugLog(L"recording start failed: preview is not ready");
                throw hresult_error(E_FAIL, L"Windows camera preview is not ready for recording");
            }

            if (g_isRecording)
            {
                g_recordingStarting = false;
                DebugLog(L"recording already active: " + std::wstring(g_lastRecordingPath.c_str()));
                co_return g_lastRecordingPath.size() == 0 ? requestedPath : g_lastRecordingPath;
            }

            auto file = co_await CreateStorageFileForPathAsync(requestedPath);
            co_await ResumeOnCameraDispatcherAsync();
            auto filePath = file.Path();

            // Re-open the StorageFile on the camera dispatcher before passing it to
            // MediaCapture. This avoids passing a StorageFile interface that may have
            // been marshalled through a different coroutine/apartment.
            StorageFile recordFile = file;
            bool reopenStorageFileFailed = false;
            std::wstring reopenStorageFileError;
            try
            {
                recordFile = co_await StorageFile::GetFileFromPathAsync(filePath);
                co_await ResumeOnCameraDispatcherAsync();
                DebugLog(L"recording StorageFile re-opened on camera dispatcher: " + std::wstring(recordFile.Path().c_str()));
            }
            catch (hresult_error const &ex)
            {
                // C++/WinRT does not allow co_await inside catch blocks. Capture the
                // failure details here, then resume/log outside the catch.
                reopenStorageFileFailed = true;
                reopenStorageFileError = std::wstring(ex.message().c_str());
                recordFile = file;
            }

            if (reopenStorageFileFailed)
            {
                co_await ResumeOnCameraDispatcherAsync();
                DebugLog(L"recording StorageFile re-open fallback to created handle: " + reopenStorageFileError);
            }

            auto media = GetMediaCaptureForCurrentApartment();
            if (!media || !g_previewReady)
            {
                g_recordingStarting = false;
                DebugLog(L"recording start failed after file create: preview is not ready");
                throw hresult_error(E_FAIL, L"Windows camera preview is not ready for recording");
            }

            auto profile = MediaEncodingProfile::CreateMp4(VideoEncodingQuality::HD720p);
            DebugLog(L"recording calling StartRecordToStorageFileAsync threadAccess=" + BoolText(HasCameraThreadAccess()));

            co_await media.StartRecordToStorageFileAsync(profile, recordFile);
            co_await ResumeOnCameraDispatcherAsync();

            g_currentRecordingFile = recordFile;
            g_lastRecordingPath = recordFile.Path();
            g_isRecording = true;
            g_recordingStarting = false;
            DebugLog(L"recording started and file handle is active: " + std::wstring(g_lastRecordingPath.c_str()));
            co_return g_lastRecordingPath;
        }
        catch (hresult_error const &ex)
        {
            g_isRecording = false;
            g_recordingStarting = false;
            g_currentRecordingFile = nullptr;
            DebugLog(L"recording start error: " + std::wstring(ex.message().c_str()) + L" threadAccess=" + BoolText(HasCameraThreadAccess()));
            throw;
        }
        catch (...)
        {
            g_isRecording = false;
            g_recordingStarting = false;
            g_currentRecordingFile = nullptr;
            DebugLog(L"recording start error: unknown");
            throw hresult_error(E_FAIL, L"Windows camera recording start failed");
        }
    }

    IAsyncOperation<hstring> StopRecordingOnCameraDispatcherAsync()
    {
        try
        {
            for (int attempt = 0; g_recordingStarting && !g_isRecording && attempt < 50; ++attempt)
            {
                co_await winrt::resume_after(std::chrono::milliseconds(100));
            }

            co_await ResumeOnCameraDispatcherAsync();
            DebugLog(L"v17 stop command running on camera dispatcher threadAccess=" + BoolText(HasCameraThreadAccess()));

            auto media = GetMediaCaptureForCurrentApartment();
            if (!media || !g_isRecording)
            {
                g_recordingStopping = false;
                DebugLog(L"recording stop ignored: not recording");
                co_return g_lastRecordingPath;
            }

            co_await media.StopRecordAsync();
            co_await ResumeOnCameraDispatcherAsync();

            g_isRecording = false;
            g_recordingStarting = false;
            g_recordingStopping = false;

            uint64_t finalizedSize = 0;
            if (g_currentRecordingFile)
            {
                try
                {
                    finalizedSize = co_await GetFinalizedFileSizeAsync(g_currentRecordingFile);
                }
                catch (hresult_error const &ex)
                {
                    DebugLog(L"recording finalized size check failed: " + std::wstring(ex.message().c_str()));
                }
            }

            DebugLog(L"recording finalized path: " + std::wstring(g_lastRecordingPath.c_str()) + L" size=" + std::to_wstring(static_cast<unsigned long long>(finalizedSize)));
            g_currentRecordingFile = nullptr;
            co_return g_lastRecordingPath;
        }
        catch (hresult_error const &ex)
        {
            g_recordingStopping = false;
            DebugLog(L"recording stop error: " + std::wstring(ex.message().c_str()));
            throw;
        }
        catch (...)
        {
            g_recordingStopping = false;
            DebugLog(L"recording stop error: unknown");
            throw hresult_error(E_FAIL, L"Windows camera recording stop failed");
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
                    g_currentRecordingFile = nullptr;
                    DebugLog(L"recording stopped on unload: " + std::wstring(g_lastRecordingPath.c_str()));
                }

                co_await media.StopPreviewAsync();
                co_await ResumeOnCameraDispatcherAsync();
                try
                {
                    media.Close();
                    DebugLog(L"preview MediaCapture closed on unload");
                }
                catch (hresult_error const &ex)
                {
                    DebugLog(L"preview close on unload ignored: " + std::wstring(ex.message().c_str()));
                }
            }

            if (g_mediaCapture == media)
            {
                g_mediaCapture = nullptr;
                g_mediaCaptureAgile = {};
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

            DebugLog(L"v17 dispatcher-owned recorder loaded");
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
            // v38: Keep preview in shared-read mode during normal gameplay. When YouTube
            // camera-only live starts, JS unmounts this view and native release closes
            // MediaCapture so FFmpeg/DirectShow can own the webcam.
            settings.SharingMode(MediaCaptureSharingMode::SharedReadOnly);
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
            try
            {
                g_mediaCaptureAgile = winrt::make_agile(mediaCapture);
            }
            catch (hresult_error const &ex)
            {
                DebugLog(L"preview agile MediaCapture create failed: " + std::wstring(ex.message().c_str()));
                g_mediaCaptureAgile = {};
            }
            catch (...)
            {
                DebugLog(L"preview agile MediaCapture create failed: unknown");
                g_mediaCaptureAgile = {};
            }

            DebugLog(L"preview start threadAccess=" + BoolText(HasCameraThreadAccess()));
            co_await mediaCapture.StartPreviewAsync();
            co_await ResumeOnCameraDispatcherAsync();
            g_previewReady = true;
            DebugLog(L"preview ready");
        }
        catch (hresult_error const &ex)
        {
            g_mediaCapture = nullptr;
            g_mediaCaptureAgile = {};
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
        DebugLog(L"v17 WindowsCameraStartRecordingAsync awaiting native start: " + std::wstring(requestedPath.c_str()));

        if (g_isRecording)
        {
            DebugLog(L"recording already active: " + std::wstring(g_lastRecordingPath.c_str()));
            co_return g_lastRecordingPath.size() == 0 ? requestedPath : g_lastRecordingPath;
        }

        if (g_recordingStarting)
        {
            for (int attempt = 0; g_recordingStarting && attempt < 50; ++attempt)
            {
                co_await winrt::resume_after(std::chrono::milliseconds(100));
            }
            if (g_isRecording)
            {
                co_return g_lastRecordingPath.size() == 0 ? requestedPath : g_lastRecordingPath;
            }
        }

        g_recordingStarting = true;
        g_lastRecordingPath = requestedPath;
        co_return co_await StartRecordingOnCameraDispatcherAsync(requestedPath);
    }

    IAsyncOperation<hstring> WindowsCameraStopRecordingAsync()
    {
        DebugLog(L"v17 WindowsCameraStopRecordingAsync awaiting native finalize");

        if (!g_recordingStopping)
        {
            g_recordingStopping = true;
        }

        co_return co_await StopRecordingOnCameraDispatcherAsync();
    }
    IAsyncOperation<bool> WindowsCameraReleaseForExternalUseAsync()
    {
        try
        {
            DebugLog(L"external live release requested");

            if (g_cameraDispatcher)
            {
                co_await ResumeOnCameraDispatcherAsync();
            }

            auto media = GetMediaCaptureForCurrentApartment();
            if (!media)
            {
                g_mediaCapture = nullptr;
                g_mediaCaptureAgile = {};
                g_previewReady = false;
                DebugLog(L"external live release: no active MediaCapture");
                co_return true;
            }

            if (g_isRecording || g_recordingStarting)
            {
                try
                {
                    co_await media.StopRecordAsync();
                    co_await ResumeOnCameraDispatcherAsync();
                    DebugLog(L"external live release: recording stopped");
                }
                catch (hresult_error const &ex)
                {
                    DebugLog(L"external live release: stop record ignored: " + std::wstring(ex.message().c_str()));
                }
            }

            g_isRecording = false;
            g_recordingStarting = false;
            g_recordingStopping = false;
            g_currentRecordingFile = nullptr;

            try
            {
                co_await media.StopPreviewAsync();
                co_await ResumeOnCameraDispatcherAsync();
                DebugLog(L"external live release: preview stopped");
            }
            catch (hresult_error const &ex)
            {
                DebugLog(L"external live release: stop preview ignored: " + std::wstring(ex.message().c_str()));
            }

            try
            {
                media.Close();
                DebugLog(L"external live release: MediaCapture closed");
            }
            catch (hresult_error const &ex)
            {
                DebugLog(L"external live release: close ignored: " + std::wstring(ex.message().c_str()));
            }

            g_mediaCapture = nullptr;
            g_mediaCaptureAgile = {};
            g_previewReady = false;

            // Give Windows/DirectShow a short moment to publish the webcam back to the system
            // before FFmpeg tries BindToObject. Without this wait the device can still be
            // visible in list_devices but fail to open with I/O error.
            co_await winrt::resume_after(std::chrono::milliseconds(600));
            DebugLog(L"external live release completed");
            co_return true;
        }
        catch (hresult_error const &ex)
        {
            g_isRecording = false;
            g_recordingStarting = false;
            g_recordingStopping = false;
            g_currentRecordingFile = nullptr;
            g_mediaCapture = nullptr;
            g_mediaCaptureAgile = {};
            g_previewReady = false;
            DebugLog(L"external live release error: " + std::wstring(ex.message().c_str()));
            throw;
        }
        catch (...)
        {
            g_isRecording = false;
            g_recordingStarting = false;
            g_recordingStopping = false;
            g_currentRecordingFile = nullptr;
            g_mediaCapture = nullptr;
            g_mediaCaptureAgile = {};
            g_previewReady = false;
            DebugLog(L"external live release error: unknown");
            throw hresult_error(E_FAIL, L"Windows camera release for external live failed");
        }
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
