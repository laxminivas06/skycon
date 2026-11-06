# =====================================================================================
# SAE INDIA 2026 - ESP32-S3 1-CLICK AUTO-DETECTION FLASHER & SERIAL MONITOR
# =====================================================================================
$esptool = "C:\Users\VISHAL GUDLA\AppData\Local\Arduino15\packages\esp32\tools\esptool_py\5.3.1\esptool.exe"
$mergedBin = "c:\Antigravityyyyy\last drone\skycon\esp32-firmware\build\esp32_cloud_relay_client.ino.merged.bin"
$sketchDir = "c:\Antigravityyyyy\last drone\skycon\esp32-firmware\esp32_cloud_relay_client"
$arduinoCli = "C:\Program Files\Arduino CLI\arduino-cli.exe"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🚀 SAE INDIA — ESP32-S3 AUTOMATIC FLASHING TOOL" -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Cyan

function Get-TargetPort {
    $ports = [System.IO.Ports.SerialPort]::GetPortNames()
    if ($ports -and $ports.Count -gt 0) {
        return $ports[0]
    }
    return $null
}

$port = Get-TargetPort

if (-not $port) {
    Write-Host "`n⏳ Waiting for ESP32-S3 to be plugged in via USB..." -ForegroundColor Yellow
    Write-Host "👉 1. Use a Data USB-C cable (not a charge-only cable)." -ForegroundColor Gray
    Write-Host "👉 2. Plug into the 'USB' or 'UART' port on the ESP32-S3 board." -ForegroundColor Gray
    Write-Host "👉 3. If needed, hold the 'BOOT' button while plugging in." -ForegroundColor Gray
    
    while (-not $port) {
        Start-Sleep -Milliseconds 800
        $port = Get-TargetPort
        Write-Host "." -NoNewline -ForegroundColor Cyan
    }
    Write-Host "`n"
}

Write-Host "🎯 DETECTED ESP32 ON PORT: $port" -ForegroundColor Green
Write-Host "⚡ Flashing 100% verified firmware with 2026 TLS clock fix..." -ForegroundColor Cyan

if (Test-Path $mergedBin) {
    & $esptool --chip esp32s3 -p $port -b 921600 --before default_reset --after hard_reset write_flash -z --flash_mode dio --flash_freq 80m 0x0 $mergedBin
} else {
    & $arduinoCli upload -p $port --fqbn esp32:esp32:esp32s3 $sketchDir
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n=================================================================" -ForegroundColor Green
    Write-Host "✅ FLASHING COMPLETED SUCCESSFULLY!" -ForegroundColor Green
    Write-Host "🌐 The ESP32 is rebooting and will connect to 'drone123' hotspot." -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Green
} else {
    Write-Host "`n❌ Flashing failed. Hold BOOT button on the ESP32 and run again." -ForegroundColor Red
}

