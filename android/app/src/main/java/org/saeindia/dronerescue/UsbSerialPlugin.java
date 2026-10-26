package org.saeindia.dronerescue;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "UsbSerial")
public class UsbSerialPlugin extends Plugin {
    private static final String TAG = "UsbSerialPlugin";
    private static final String ACTION_USB_PERMISSION = "org.saeindia.dronerescue.USB_PERMISSION";

    private UsbManager usbManager;
    private UsbDevice currentDevice;
    private UsbDeviceConnection currentConnection;
    private UsbInterface dataInterface;
    private UsbInterface controlInterface;
    private UsbEndpoint endpointIn;
    private UsbEndpoint endpointOut;

    private Thread readThread;
    private final AtomicBoolean isReading = new AtomicBoolean(false);
    private int currentBaudRate = 57600;
    private long bytesReceived = 0;
    private long bytesSent = 0;
    private String currentPhase = "DISCONNECTED";
    private String lastErrorMessage = "";

    // Broadcast receiver for USB Permission and Attach/Detach events
    private final BroadcastReceiver usbReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (ACTION_USB_PERMISSION.equals(action)) {
                synchronized (this) {
                    UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                    boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                    if (granted && device != null) {
                        Log.i(TAG, "[USB] Permission granted for device: " + device.getDeviceName());
                        notifyStateChange("USB_PERMISSION_GRANTED", "USB permission granted for " + getDeviceDisplayName(device), device);
                        openDeviceAndStartReader(device, currentBaudRate, null);
                    } else {
                        Log.w(TAG, "[USB] Permission denied for device: " + (device != null ? device.getDeviceName() : "Unknown"));
                        lastErrorMessage = "USB permission denied. Please allow USB access and reconnect the Pixhawk.";
                        notifyStateChange("PERMISSION_DENIED", lastErrorMessage, device);
                    }
                }
            } else if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action)) {
                UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                Log.i(TAG, "[USB] Broadcast: Device Attached: " + (device != null ? device.getDeviceName() : "Unknown"));
                if (device != null) {
                    handleDeviceAttachedInternal(device);
                }
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                Log.i(TAG, "[USB] Broadcast: Device Detached: " + (device != null ? device.getDeviceName() : "Unknown"));
                JSObject ret = new JSObject();
                if (device != null) {
                    ret.put("device", serializeDevice(device));
                }
                notifyListeners("usbDetached", ret);
                closeCurrentConnection();
                notifyStateChange("CONNECTION_LOST", "Pixhawk connection lost (USB cable disconnected)", null);
            }
        }
    };

    @Override
    public void load() {
        super.load();
        Context context = getContext();
        usbManager = (UsbManager) context.getSystemService(Context.USB_SERVICE);

        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_USB_PERMISSION);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(usbReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                context.registerReceiver(usbReceiver, filter);
            }
            Log.i(TAG, "[USB] UsbSerialPlugin initialized with exported broadcast receiver.");
        } catch (Exception e) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    context.registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
                }
            } catch (Exception ignored) {}
        }
    }

    public void handleDeviceAttachedFromActivity(UsbDevice device) {
        if (device != null) {
            handleDeviceAttachedInternal(device);
        }
    }

    private void handleDeviceAttachedInternal(UsbDevice device) {
        JSObject ret = new JSObject();
        ret.put("device", serializeDevice(device));
        notifyListeners("usbAttached", ret);
        notifyStateChange("USB_DEVICE_DETECTED", "USB device detected: " + getDeviceDisplayName(device), device);
        autoConnectDevice(device, currentBaudRate, null);
    }

    @Override
    protected void handleOnDestroy() {
        closeCurrentConnection();
        try {
            getContext().unregisterReceiver(usbReceiver);
        } catch (Exception ignored) {}
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getConnectedDevices(PluginCall call) {
        if (usbManager == null) {
            usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        }
        HashMap<String, UsbDevice> deviceList = (usbManager != null) ? usbManager.getDeviceList() : new HashMap<>();
        JSArray array = new JSArray();

        for (UsbDevice device : deviceList.values()) {
            array.put(serializeDevice(device));
        }

        JSObject ret = new JSObject();
        ret.put("devices", array);
        ret.put("count", deviceList.size());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (usbManager == null) {
            usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        }
        HashMap<String, UsbDevice> deviceList = (usbManager != null) ? usbManager.getDeviceList() : new HashMap<>();
        if (deviceList.isEmpty()) {
            lastErrorMessage = "No USB device detected. Verify OTG adapter, data cable, and Pixhawk power.";
            notifyStateChange("USB_NOT_DETECTED", lastErrorMessage, null);
            call.reject("USB_NOT_DETECTED", lastErrorMessage);
            return;
        }

        UsbDevice targetDevice = currentDevice;
        if (targetDevice == null) {
            targetDevice = selectBestDevice(deviceList);
        }

        if (targetDevice == null) {
            lastErrorMessage = "No compatible USB device found on USB Host.";
            notifyStateChange("UNSUPPORTED_DEVICE", lastErrorMessage, null);
            call.reject("UNSUPPORTED_DEVICE", lastErrorMessage);
            return;
        }

        if (usbManager.hasPermission(targetDevice)) {
            notifyStateChange("USB_PERMISSION_GRANTED", "USB permission already granted for " + getDeviceDisplayName(targetDevice), targetDevice);
            JSObject ret = new JSObject();
            ret.put("granted", true);
            ret.put("device", serializeDevice(targetDevice));
            call.resolve(ret);
            return;
        }

        notifyStateChange("USB_PERMISSION_REQUIRED", "Requesting USB permission for " + getDeviceDisplayName(targetDevice) + "…", targetDevice);
        promptUsbPermission(targetDevice);
        JSObject ret = new JSObject();
        ret.put("requested", true);
        ret.put("device", serializeDevice(targetDevice));
        call.resolve(ret);
    }

    @PluginMethod
    public void autoConnect(PluginCall call) {
        int baudRate = call.getInt("baudRate", 57600);
        this.currentBaudRate = baudRate;

        if (usbManager == null) {
            usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        }

        HashMap<String, UsbDevice> deviceList = (usbManager != null) ? usbManager.getDeviceList() : new HashMap<>();
        if (deviceList.isEmpty()) {
            lastErrorMessage = "No USB device detected. Verify the OTG adapter supports data and Pixhawk is powered.";
            notifyStateChange("USB_NOT_DETECTED", lastErrorMessage, null);
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("phase", "USB_NOT_DETECTED");
            ret.put("error", lastErrorMessage);
            call.resolve(ret);
            return;
        }

        UsbDevice targetDevice = selectBestDevice(deviceList);
        if (targetDevice == null) {
            targetDevice = deviceList.values().iterator().next();
        }

        autoConnectDevice(targetDevice, baudRate, call);
    }

    private UsbDevice selectBestDevice(HashMap<String, UsbDevice> deviceList) {
        // 1. Priority: Known Flight Controllers & Telemetry Radios
        for (UsbDevice device : deviceList.values()) {
            if (isFlightControllerVendor(device.getVendorId())) {
                return device;
            }
        }
        // 2. Priority: USB CDC-ACM or Devices with Bulk Serial Endpoints
        for (UsbDevice device : deviceList.values()) {
            if (hasSerialEndpoints(device)) {
                return device;
            }
        }
        // 3. Fallback: Any connected USB device
        return deviceList.isEmpty() ? null : deviceList.values().iterator().next();
    }

    private void autoConnectDevice(UsbDevice device, int baudRate, PluginCall call) {
        this.currentDevice = device;
        this.currentBaudRate = baudRate;

        notifyStateChange("USB_DEVICE_DETECTED", "USB device detected: " + getDeviceDisplayName(device), device);

        if (!usbManager.hasPermission(device)) {
            Log.i(TAG, "[USB] Requesting permission for " + device.getDeviceName());
            notifyStateChange("USB_PERMISSION_REQUIRED", "Requesting USB permission...", device);
            promptUsbPermission(device);

            if (call != null) {
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("phase", "USB_PERMISSION_REQUIRED");
                ret.put("device", serializeDevice(device));
                call.resolve(ret);
            }
            return;
        }

        // Already has permission -> Open directly
        notifyStateChange("USB_PERMISSION_GRANTED", "USB permission granted", device);
        openDeviceAndStartReader(device, baudRate, call);
    }

    private void promptUsbPermission(UsbDevice device) {
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        Intent intent = new Intent(ACTION_USB_PERMISSION);
        intent.setPackage(getContext().getPackageName());
        PendingIntent permissionIntent = PendingIntent.getBroadcast(getContext(), 0, intent, flags);
        usbManager.requestPermission(device, permissionIntent);
    }

    private synchronized void openDeviceAndStartReader(UsbDevice device, int baudRate, PluginCall call) {
        closeCurrentConnection();
        this.currentDevice = device;
        this.currentBaudRate = baudRate;

        notifyStateChange("SERIAL_OPENING", "Opening serial connection…", device);

        UsbDeviceConnection connection = usbManager.openDevice(device);
        if (connection == null) {
            lastErrorMessage = "USB interface detected but could not be opened (UsbDeviceConnection returned null). USB device may require additional power.";
            notifyStateChange("SERIAL_OPEN_FAILED", lastErrorMessage, device);
            if (call != null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("phase", "SERIAL_OPEN_FAILED");
                ret.put("error", lastErrorMessage);
                call.resolve(ret);
            }
            return;
        }
        this.currentConnection = connection;

        // Inspect and claim serial interface + endpoints
        if (!setupInterfacesAndEndpoints(device, connection)) {
            notifyStateChange("UNSUPPORTED_DEVICE", lastErrorMessage, device);
            closeCurrentConnection();
            if (call != null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("phase", "UNSUPPORTED_DEVICE");
                ret.put("error", lastErrorMessage);
                call.resolve(ret);
            }
            return;
        }

        // Configure Serial Line Coding & Control Lines (Baud Rate, 8N1, DTR=1, RTS=1)
        configureSerialPort(connection, device, baudRate);

        notifyStateChange("SERIAL_OPEN", "Serial port opened @ " + baudRate + " baud. Testing serial data…", device);

        // Start background reader thread
        startReaderThread();

        if (call != null) {
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("phase", "SERIAL_OPEN");
            ret.put("device", serializeDevice(device));
            call.resolve(ret);
        }
    }

    private boolean setupInterfacesAndEndpoints(UsbDevice device, UsbDeviceConnection connection) {
        dataInterface = null;
        controlInterface = null;
        endpointIn = null;
        endpointOut = null;

        int interfaceCount = device.getInterfaceCount();
        Log.i(TAG, "[USB] Inspecting " + interfaceCount + " interfaces on " + device.getDeviceName());

        // Composite CDC-ACM (Pixhawk / STM32 / ArduPilot ChibiOS)
        for (int i = 0; i < interfaceCount; i++) {
            UsbInterface iface = device.getInterface(i);
            int ifaceClass = iface.getInterfaceClass();

            if (ifaceClass == UsbConstants.USB_CLASS_COMM && controlInterface == null) {
                controlInterface = iface;
                try {
                    connection.claimInterface(iface, true);
                    Log.i(TAG, "[USB] Claimed CDC COMM control interface: " + i);
                } catch (Exception e) {
                    Log.w(TAG, "[USB] Notice claiming control interface: " + e.getMessage());
                }
            } else if ((ifaceClass == UsbConstants.USB_CLASS_CDC_DATA || ifaceClass == UsbConstants.USB_CLASS_VENDOR_SPEC || ifaceClass == UsbConstants.USB_CLASS_COMM) && dataInterface == null) {
                UsbEndpoint in = null;
                UsbEndpoint out = null;

                for (int e = 0; e < iface.getEndpointCount(); e++) {
                    UsbEndpoint ep = iface.getEndpoint(e);
                    if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK) {
                        if (ep.getDirection() == UsbConstants.USB_DIR_IN && in == null) {
                            in = ep;
                        } else if (ep.getDirection() == UsbConstants.USB_DIR_OUT && out == null) {
                            out = ep;
                        }
                    }
                }

                if (in != null && out != null) {
                    try {
                        connection.claimInterface(iface, true);
                        dataInterface = iface;
                        endpointIn = in;
                        endpointOut = out;
                        Log.i(TAG, "[USB] Claimed data interface " + i + " (IN EP " + in.getEndpointNumber() + ", OUT EP " + out.getEndpointNumber() + ")");
                        break;
                    } catch (Exception e) {
                        Log.w(TAG, "[USB] Could not claim interface " + i + ": " + e.getMessage());
                    }
                }
            }
        }

        // Fallback: Scan any interface with bulk IN and OUT endpoints
        if (endpointIn == null || endpointOut == null) {
            for (int i = 0; i < interfaceCount; i++) {
                UsbInterface iface = device.getInterface(i);
                UsbEndpoint in = null;
                UsbEndpoint out = null;

                for (int e = 0; e < iface.getEndpointCount(); e++) {
                    UsbEndpoint ep = iface.getEndpoint(e);
                    if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK) {
                        if (ep.getDirection() == UsbConstants.USB_DIR_IN && in == null) in = ep;
                        if (ep.getDirection() == UsbConstants.USB_DIR_OUT && out == null) out = ep;
                    }
                }

                if (in != null && out != null) {
                    try {
                        connection.claimInterface(iface, true);
                        dataInterface = iface;
                        endpointIn = in;
                        endpointOut = out;
                        Log.i(TAG, "[USB] Fallback selected bulk interface " + iface.getId());
                        break;
                    } catch (Exception e) {
                        Log.w(TAG, "[USB] Fallback claim failed: " + e.getMessage());
                    }
                }
            }
        }

        if (endpointIn == null && endpointOut == null) {
            lastErrorMessage = "No compatible USB serial interface found (no bulk endpoints).";
            return false;
        } else if (endpointIn == null) {
            lastErrorMessage = "No IN endpoint found on USB serial interface.";
            return false;
        } else if (endpointOut == null) {
            lastErrorMessage = "No OUT endpoint found on USB serial interface.";
            return false;
        }

        return true;
    }

    private void configureSerialPort(UsbDeviceConnection connection, UsbDevice device, int baudRate) {
        int vid = device.getVendorId();

        try {
            // CDC-ACM standard SET_LINE_CODING (0x20): baud rate, 1 stop bit, no parity, 8 data bits
            byte[] lineCoding = new byte[] {
                    (byte) (baudRate & 0xff),
                    (byte) ((baudRate >> 8) & 0xff),
                    (byte) ((baudRate >> 16) & 0xff),
                    (byte) ((baudRate >> 24) & 0xff),
                    0, // 1 stop bit
                    0, // no parity
                    8  // 8 data bits
            };
            connection.controlTransfer(0x21, 0x20, 0, 0, lineCoding, lineCoding.length, 1000);

            // SET_CONTROL_LINE_STATE (0x22): DTR = 1, RTS = 1
            connection.controlTransfer(0x21, 0x22, 0x03, 0, null, 0, 1000);

            // Silicon Labs CP210x setup
            if (vid == 0x10C4) {
                connection.controlTransfer(0x41, 0x00, 0x0001, 0, null, 0, 1000); // IFC_ENABLE
                connection.controlTransfer(0x41, 0x07, 0x0303, 0, null, 0, 1000); // SET_MHS (DTR/RTS)
            }

            // FTDI setup
            if (vid == 0x0403) {
                connection.controlTransfer(0x40, 0x00, 0, 0, null, 0, 1000); // SIO_RESET
                connection.controlTransfer(0x40, 0x01, 0x0303, 0, null, 0, 1000); // SIO_SET_MODEM_CTRL
            }

            // CH340 / CH341 setup
            if (vid == 0x1A86 || vid == 0x2E3C) {
                connection.controlTransfer(0x40, 0xA1, 0xC29C, 0xB2B9, null, 0, 1000);
                connection.controlTransfer(0x40, 0xA4, 0x00DF, 0, null, 0, 1000);
            }
        } catch (Exception e) {
            Log.w(TAG, "[USB] Serial line configuration note: " + e.getMessage());
        }
    }

    private void startReaderThread() {
        isReading.set(true);
        readThread = new Thread(() -> {
            byte[] buffer = new byte[4096];
            Log.i(TAG, "[USB] USB Read Thread started.");

            while (isReading.get() && currentConnection != null && endpointIn != null) {
                try {
                    int len = currentConnection.bulkTransfer(endpointIn, buffer, buffer.length, 100);
                    if (len > 0) {
                        bytesReceived += len;
                        byte[] data = new byte[len];
                        System.arraycopy(buffer, 0, data, 0, len);

                        String base64Data = Base64.encodeToString(data, Base64.NO_WRAP);
                        JSObject event = new JSObject();
                        event.put("data", base64Data);
                        event.put("length", len);
                        notifyListeners("usbData", event);
                    }
                } catch (Exception e) {
                    if (isReading.get()) {
                        Log.e(TAG, "[USB] Bulk read error: " + e.getMessage());
                    }
                    break;
                }
            }
            Log.i(TAG, "[USB] USB Read Thread ended.");
        }, "PixhawkUsbReaderThread");
        readThread.start();
    }

    @PluginMethod
    public void sendData(PluginCall call) {
        String base64 = call.getString("data");
        if (base64 == null || currentConnection == null || endpointOut == null) {
            call.reject("Not connected or no data provided");
            return;
        }

        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            int transferred = currentConnection.bulkTransfer(endpointOut, bytes, bytes.length, 1000);
            if (transferred >= 0) {
                bytesSent += transferred;
                JSObject ret = new JSObject();
                ret.put("bytesSent", transferred);
                call.resolve(ret);
            } else {
                call.reject("Bulk transfer failed with code: " + transferred);
            }
        } catch (Exception e) {
            call.reject("Failed to write to USB: " + e.getMessage());
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeCurrentConnection();
        notifyStateChange("DISCONNECTED", "Disconnected by user", null);
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getDiagnostics(PluginCall call) {
        JSObject diag = new JSObject();
        diag.put("status", currentPhase);
        diag.put("phase", currentPhase);
        diag.put("baudRate", currentBaudRate);
        diag.put("bytesReceived", bytesReceived);
        diag.put("bytesSent", bytesSent);
        diag.put("lastError", lastErrorMessage);
        diag.put("isConnected", currentConnection != null && isReading.get());
        diag.put("isUsbHostSupported", usbManager != null);

        HashMap<String, UsbDevice> deviceList = (usbManager != null) ? usbManager.getDeviceList() : new HashMap<>();
        diag.put("connectedDeviceCount", deviceList.size());

        if (currentDevice != null) {
            diag.put("device", serializeDevice(currentDevice));
            diag.put("hasPermission", usbManager != null && usbManager.hasPermission(currentDevice));
            diag.put("interfaceType", getInterfaceTypeName(currentDevice));
            diag.put("driverType", getDriverTypeName(currentDevice));
        }

        if (endpointIn != null) {
            diag.put("endpointInNumber", endpointIn.getEndpointNumber());
            diag.put("endpointInMaxPacket", endpointIn.getMaxPacketSize());
        }
        if (endpointOut != null) {
            diag.put("endpointOutNumber", endpointOut.getEndpointNumber());
            diag.put("endpointOutMaxPacket", endpointOut.getMaxPacketSize());
        }

        call.resolve(diag);
    }

    private synchronized void closeCurrentConnection() {
        isReading.set(false);
        if (readThread != null) {
            readThread.interrupt();
            readThread = null;
        }

        if (currentConnection != null) {
            try {
                if (dataInterface != null) {
                    currentConnection.releaseInterface(dataInterface);
                }
                if (controlInterface != null) {
                    currentConnection.releaseInterface(controlInterface);
                }
                currentConnection.close();
            } catch (Exception ignored) {}
            currentConnection = null;
        }

        dataInterface = null;
        controlInterface = null;
        endpointIn = null;
        endpointOut = null;
        currentDevice = null;
    }

    private void notifyStateChange(String phase, String message, UsbDevice device) {
        this.currentPhase = phase;
        JSObject ret = new JSObject();
        ret.put("status", phase);
        ret.put("phase", phase);
        ret.put("message", message);
        if (device != null) {
            ret.put("device", serializeDevice(device));
        }
        notifyListeners("usbStateChange", ret);
    }

    private boolean isFlightControllerVendor(int vid) {
        return vid == 0x26AC || vid == 0x1209 || vid == 0x0483 || vid == 0x10C4 ||
               vid == 0x0403 || vid == 0x1A86 || vid == 0x2E3C || vid == 0x067B || vid == 0x303A;
    }

    private boolean hasSerialEndpoints(UsbDevice device) {
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface iface = device.getInterface(i);
            boolean hasIn = false;
            boolean hasOut = false;
            for (int e = 0; e < iface.getEndpointCount(); e++) {
                UsbEndpoint ep = iface.getEndpoint(e);
                if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK) {
                    if (ep.getDirection() == UsbConstants.USB_DIR_IN) hasIn = true;
                    if (ep.getDirection() == UsbConstants.USB_DIR_OUT) hasOut = true;
                }
            }
            if (hasIn && hasOut) return true;
        }
        return false;
    }

    private String getInterfaceTypeName(UsbDevice device) {
        int vid = device.getVendorId();
        if (vid == 0x26AC || vid == 0x0483 || vid == 0x1209 || vid == 0x303A) {
            return "USB CDC ACM (Pixhawk / STM32 VCP)";
        } else if (vid == 0x10C4) {
            return "Silicon Labs CP210x UART Bridge";
        } else if (vid == 0x0403) {
            return "FTDI Serial Module";
        } else if (vid == 0x1A86 || vid == 0x2E3C) {
            return "WCH CH340 / CH9102 Serial";
        } else if (vid == 0x067B) {
            return "Prolific PL2303 Serial";
        }
        return "USB CDC ACM / Generic Serial";
    }

    private String getDriverTypeName(UsbDevice device) {
        int vid = device.getVendorId();
        if (vid == 0x26AC || vid == 0x0483 || vid == 0x1209) return "CDC_ACM";
        if (vid == 0x10C4) return "CP210X";
        if (vid == 0x0403) return "FTDI";
        if (vid == 0x1A86 || vid == 0x2E3C) return "CH34X";
        return "GENERIC_CDC";
    }

    private String getDeviceDisplayName(UsbDevice device) {
        String name = "";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            name = device.getProductName();
        }
        if (name == null || name.trim().isEmpty()) {
            int vid = device.getVendorId();
            if (vid == 0x26AC) name = "Pixhawk 2.4.8 FC";
            else if (vid == 0x0483) name = "STM32 Pixhawk Flight Controller";
            else if (vid == 0x1209) name = "ArduPilot Autopilot";
            else if (vid == 0x10C4) name = "CP2102 USB Telemetry";
            else if (vid == 0x0403) name = "FTDI Serial Module";
            else if (vid == 0x1A86 || vid == 0x2E3C) name = "CH340/CH9102 USB Serial";
            else name = "USB Serial Flight Controller (" + String.format("0x%04X:0x%04X", vid, device.getProductId()) + ")";
        }
        return name;
    }

    private JSObject serializeDevice(UsbDevice device) {
        JSObject obj = new JSObject();
        obj.put("deviceName", device.getDeviceName());
        obj.put("vendorId", device.getVendorId());
        obj.put("productId", device.getProductId());
        obj.put("deviceClass", device.getDeviceClass());
        obj.put("deviceSubclass", device.getDeviceSubclass());
        obj.put("deviceProtocol", device.getDeviceProtocol());
        obj.put("interfaceCount", device.getInterfaceCount());
        obj.put("interfaceType", getInterfaceTypeName(device));
        obj.put("driverType", getDriverTypeName(device));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            obj.put("productName", device.getProductName() != null ? device.getProductName() : getDeviceDisplayName(device));
            obj.put("manufacturerName", device.getManufacturerName() != null ? device.getManufacturerName() : "");
            obj.put("serialNumber", device.getSerialNumber() != null ? device.getSerialNumber() : "");
        } else {
            obj.put("productName", getDeviceDisplayName(device));
            obj.put("manufacturerName", "");
            obj.put("serialNumber", "");
        }

        JSArray interfacesArray = new JSArray();
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface iface = device.getInterface(i);
            JSObject ifaceObj = new JSObject();
            ifaceObj.put("id", iface.getId());
            ifaceObj.put("interfaceClass", iface.getInterfaceClass());
            ifaceObj.put("interfaceSubclass", iface.getInterfaceSubclass());
            ifaceObj.put("interfaceProtocol", iface.getInterfaceProtocol());
            ifaceObj.put("endpointCount", iface.getEndpointCount());
            interfacesArray.put(ifaceObj);
        }
        obj.put("interfaces", interfacesArray);

        return obj;
    }
}
