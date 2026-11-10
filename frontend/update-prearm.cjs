const fs = require('fs');
const file = 'skycon/frontend/src/components/common/PreArmChecksPanel.tsx';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes('UsbPowerSagAlert')) {
  // Add imports
  content = content.replace(
    "import { mavlinkService } from '../../services/mavlinkService';",
    "import { mavlinkService } from '../../services/mavlinkService';\nimport { UsbPowerSagAlert } from './UsbPowerSagAlert';\nimport { DiagnosticTranslator } from './DiagnosticTranslator';\nexport { UsbPowerSagAlert, DiagnosticTranslator };"
  );

  // Insert components right after Panel Header
  const target = '<div className="grid grid-cols-3 gap-2 text-[10px]">';
  const toInsert = `<UsbPowerSagAlert voltageV={telemetry.batteryVoltage} />

      {/* STATUSTEXT Pre-Arm Diagnostic Translator & Force Arm 21196 Button */}
      <DiagnosticTranslator
        statusMessages={connectionState.statusHistory}
        latestMessage={connectionState.latestStatusMessage?.text}
        preArmFailReason={connectionState.preArmFailReason}
        isArmed={telemetry.isArmed}
        onForceArm={() => mavlinkService.sendArmCommand(true)}
      />

      <div className="grid grid-cols-3 gap-2 text-[10px]">`;

  if (content.includes(target)) {
    content = content.replace(target, toInsert);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Successfully updated PreArmChecksPanel.tsx');
  } else {
    console.error('Target not found');
    process.exit(1);
  }
} else {
  console.log('Already imported');
}

