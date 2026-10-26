package org.saeindia.dronerescue;

import android.content.Intent;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UsbSerialPlugin.class);
        super.onCreate(savedInstanceState);
        handleUsbIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleUsbIntent(intent);
    }

    private void handleUsbIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action)) {
            UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            if (device != null) {
                Log.i(TAG, "[USB] MainActivity received USB_DEVICE_ATTACHED for: " + device.getDeviceName());
                UsbSerialPlugin plugin = (UsbSerialPlugin) getBridge().getPlugin("UsbSerial").getInstance();
                if (plugin != null) {
                    plugin.handleDeviceAttachedFromActivity(device);
                }
            }
        }
    }
}
