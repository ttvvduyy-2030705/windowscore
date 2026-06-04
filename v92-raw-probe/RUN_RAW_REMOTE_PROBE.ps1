# Aplus Remote Raw Input Probe v92
# This does NOT modify your project. It opens a small window and prints raw keyboard/HID input.
# Run with: powershell -Sta -ExecutionPolicy Bypass -File .\RUN_RAW_REMOTE_PROBE.ps1

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$code = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Drawing;

public class RawRemoteProbeForm : Form
{
    private const int WM_INPUT = 0x00FF;
    private const int RID_INPUT = 0x10000003;
    private const int RIDI_DEVICENAME = 0x20000007;
    private const int RIDEV_INPUTSINK = 0x00000100;
    private const int RIM_TYPEMOUSE = 0;
    private const int RIM_TYPEKEYBOARD = 1;
    private const int RIM_TYPEHID = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTDEVICE
    {
        public ushort usUsagePage;
        public ushort usUsage;
        public int dwFlags;
        public IntPtr hwndTarget;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTHEADER
    {
        public int dwType;
        public int dwSize;
        public IntPtr hDevice;
        public IntPtr wParam;
    }

    [DllImport("user32.dll", SetLastError=true)]
    private static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] pRawInputDevices, int uiNumDevices, int cbSize);

    [DllImport("user32.dll", SetLastError=true)]
    private static extern uint GetRawInputData(IntPtr hRawInput, uint uiCommand, IntPtr pData, ref uint pcbSize, uint cbSizeHeader);

    [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    private static extern uint GetRawInputDeviceInfo(IntPtr hDevice, uint uiCommand, StringBuilder pData, ref uint pcbSize);

    private TextBox box;

    public RawRemoteProbeForm()
    {
        this.Text = "Aplus Raw Remote Probe v92 - click here, press Stop/Break";
        this.Width = 980;
        this.Height = 620;
        this.StartPosition = FormStartPosition.CenterScreen;
        this.TopMost = true;

        box = new TextBox();
        box.Multiline = true;
        box.ScrollBars = ScrollBars.Vertical;
        box.Dock = DockStyle.Fill;
        box.Font = new Font("Consolas", 10);
        box.Text = "Aplus Raw Remote Probe v92\r\n" +
                   "1) Click inside this window.\r\n" +
                   "2) Press remote STOP once.\r\n" +
                   "3) Press remote BREAK once.\r\n" +
                   "4) Copy all lines beginning [RAW].\r\n\r\n";
        this.Controls.Add(box);

        this.Shown += (s,e) => {
            RegisterAll();
            this.Activate();
            Log("Probe ready. Press Stop/Break now.");
        };
    }

    private void RegisterAll()
    {
        RAWINPUTDEVICE[] devices = new RAWINPUTDEVICE[] {
            // Keyboard
            new RAWINPUTDEVICE { usUsagePage = 0x01, usUsage = 0x06, dwFlags = RIDEV_INPUTSINK, hwndTarget = this.Handle },
            // Consumer control: media/volume/remote buttons
            new RAWINPUTDEVICE { usUsagePage = 0x0C, usUsage = 0x01, dwFlags = RIDEV_INPUTSINK, hwndTarget = this.Handle },
            // Gamepad
            new RAWINPUTDEVICE { usUsagePage = 0x01, usUsage = 0x05, dwFlags = RIDEV_INPUTSINK, hwndTarget = this.Handle },
            // Joystick
            new RAWINPUTDEVICE { usUsagePage = 0x01, usUsage = 0x04, dwFlags = RIDEV_INPUTSINK, hwndTarget = this.Handle }
        };
        bool ok = RegisterRawInputDevices(devices, devices.Length, Marshal.SizeOf(typeof(RAWINPUTDEVICE)));
        Log("RegisterRawInputDevices=" + ok + " err=" + Marshal.GetLastWin32Error());
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_INPUT)
        {
            try { DumpRawInput(m.LParam); } catch (Exception ex) { Log("[ERR] " + ex.ToString()); }
        }
        base.WndProc(ref m);
    }

    private void DumpRawInput(IntPtr hRawInput)
    {
        uint size = 0;
        uint headerSize = (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER));
        GetRawInputData(hRawInput, RID_INPUT, IntPtr.Zero, ref size, headerSize);
        if (size == 0) return;

        IntPtr buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            uint read = GetRawInputData(hRawInput, RID_INPUT, buffer, ref size, headerSize);
            if (read == 0 || read == 0xFFFFFFFF) { Log("[RAW] GetRawInputData failed err=" + Marshal.GetLastWin32Error()); return; }

            RAWINPUTHEADER header = (RAWINPUTHEADER)Marshal.PtrToStructure(buffer, typeof(RAWINPUTHEADER));
            string dev = GetDeviceName(header.hDevice);
            int offset = Marshal.SizeOf(typeof(RAWINPUTHEADER));

            if (header.dwType == RIM_TYPEKEYBOARD)
            {
                ushort makeCode = (ushort)Marshal.ReadInt16(buffer, offset + 0);
                ushort flags = (ushort)Marshal.ReadInt16(buffer, offset + 2);
                ushort vkey = (ushort)Marshal.ReadInt16(buffer, offset + 6);
                uint msg = (uint)Marshal.ReadInt32(buffer, offset + 8);
                Log(String.Format("[RAW][KEYBOARD] vkey={0} make={1} flags=0x{2:X} msg=0x{3:X} device={4}", vkey, makeCode, flags, msg, dev));
            }
            else if (header.dwType == RIM_TYPEHID)
            {
                int sizeHid = Marshal.ReadInt32(buffer, offset + 0);
                int count = Marshal.ReadInt32(buffer, offset + 4);
                int dataOffset = offset + 8;
                int len = Math.Min(sizeHid * count, Math.Max(0, (int)size - dataOffset));
                byte[] data = new byte[len];
                Marshal.Copy(IntPtr.Add(buffer, dataOffset), data, 0, len);
                Log(String.Format("[RAW][HID] sizeHid={0} count={1} data={2} device={3}", sizeHid, count, BitConverter.ToString(data), dev));
            }
            else
            {
                Log("[RAW][TYPE " + header.dwType + "] device=" + dev + " size=" + size);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private string GetDeviceName(IntPtr hDevice)
    {
        uint size = 0;
        GetRawInputDeviceInfo(hDevice, RIDI_DEVICENAME, null, ref size);
        if (size == 0) return "unknown";
        StringBuilder sb = new StringBuilder((int)size + 2);
        uint ok = GetRawInputDeviceInfo(hDevice, RIDI_DEVICENAME, sb, ref size);
        if (ok == 0xFFFFFFFF) return "unknown";
        return sb.ToString();
    }

    private void Log(string s)
    {
        string line = DateTime.Now.ToString("HH:mm:ss.fff") + " " + s;
        Console.WriteLine(line);
        if (box != null && !box.IsDisposed)
        {
            box.AppendText(line + "\r\n");
        }
    }
}
'@

Add-Type -TypeDefinition $code -ReferencedAssemblies System.Windows.Forms,System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::Run([RawRemoteProbeForm]::new())
