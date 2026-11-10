# =====================================================================================
# SAE INDIA 2026 - ESP32-S3 Dual-Core Firmware Compilation & 1-Click Flasher
# Target: S500-AeroRecon Telemetry Relay Firmware (Milestone 1)
# =====================================================================================
$ErrorActionPreference = "Stop"

$sketchDir = "$PSScriptRoot\esp32_cloud_relay_client"
$fqbn = "esp32:esp32:esp32s3:CDCOnBoot=cdc"
$arduinoCli = "C:\Program Files\Arduino CLI\arduino-cli.exe"
$esptool = "C:\Users\VISHAL GUDLA\AppData\Local\Arduino15\packages\esp32\tools\esptool_py\5.3.1\esptool.exe"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🚀 SAE INDIA — ESP32-S3 COMPILATION & FLASHING TOOL" -ForegroundColor Yellow
Write-Host "   Dual-Core FreeRTOS Telemetry Relay Firmware (Rev 2.4.0-PROD)" -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Cyan

# Step 1: Verify tools
if (-not (Test-Path $arduinoCli)) {
    Write-Host "❌ Arduino CLI not found at '$arduinoCli'. Searching in PATH..." -ForegroundColor Red
    $arduinoCli = (Get-Command arduino-cli.exe -ErrorAction SilentlyContinue).Source
    if (-not $arduinoCli) {
        Write-Error "Arduino CLI executable could not be resolved."
    }
}

# Step 2: Compile firmware
Write-Host "`n🔨 Compiling firmware with Arduino CLI ($fqbn)..." -ForegroundColor Cyan
& $arduinoCli compile --fqbn $fqbn $sketchDir
if ($LASTEXITCODE -ne 0) {
    Write-Error "Compilation failed with exit code $LASTEXITCODE."
}
Write-Host "✅ Compilation succeeded with ZERO errors!" -ForegroundColor Green

# Step 3: Detect serial port
function Get-TargetPort {
    $ports = [System.IO.Ports.SerialPort]::GetPortNames()
    if ($ports -and $ports.Count -gt 0) {
        return $ports[0]
    }
    return $null
}

$port = Get-TargetPort
if (-not $port) {
    Write-Host "`n⏳ Waiting for ESP32-S3 to be connected via USB..." -ForegroundColor Yellow
    Write-Host "   👉 1. Use a Data USB-C cable (not charge-only)." -ForegroundColor Gray
    Write-Host "   👉 2. Plug into the USB/UART port on ESP32-S3." -ForegroundColor Gray
    Write-Host "   👉 3. Hold 'BOOT' while plugging in if entering DFU." -ForegroundColor Gray

    $retries = 0
    while (-not $port -and $retries -lt 30) {
        Start-Sleep -Milliseconds 1000
        $port = Get-TargetPort
        $retries++
        Write-Host "." -NoNewline -ForegroundColor Cyan
    }
    Write-Host ""
}

if (-not $port) {
    Write-Host "⚠️ No serial port detected. Binary compiled and ready for flashing when board is connected." -ForegroundColor Yellow
    exit 0
}

Write-Host "`n🎯 Detected ESP32-S3 on port: $port" -ForegroundColor Green
Write-Host "⚡ Uploading firmware to $port..." -ForegroundColor Cyan

& $arduinoCli upload -p $port --fqbn $fqbn $sketchDir
if ($LASTEXITCODE -eq 0) {
    Write-Host "`n=================================================================" -ForegroundColor Green
    Write-Host "🎉 FLASHING COMPLETED SUCCESSFULLY!" -ForegroundColor Green
    Write-Host "   ESP32-S3 is now running the Dual-Core Telemetry Relay Firmware." -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Green
} else {
    Write-Host "`n❌ Flashing failed. Hold BOOT button and run again." -ForegroundColor Red
}
