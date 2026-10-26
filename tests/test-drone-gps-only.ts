import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('================================================================');
console.log('🛸 VERIFYING EXCLUSIVE PIXHAWK DRONE GPS (NO MOBILE LOCATION)');
console.log('================================================================\n');

// 1. Verify MapPanel.tsx
const mapPanelPath = path.resolve(__dirname, '../frontend/src/features/dashboard/MapPanel.tsx');
const mapPanelCode = fs.readFileSync(mapPanelPath, 'utf-8');

console.log('▶ Checking MapPanel.tsx...');
assert(!mapPanelCode.includes('navigator.geolocation'), 'FAIL: MapPanel still contains navigator.geolocation');
assert(!mapPanelCode.includes('deviceLocation'), 'FAIL: MapPanel still contains deviceLocation');
assert(!mapPanelCode.includes('deviceMarkerRef'), 'FAIL: MapPanel still contains deviceMarkerRef');
assert(!mapPanelCode.includes('deviceAccuracyCircleRef'), 'FAIL: MapPanel still contains deviceAccuracyCircleRef');
assert(!mapPanelCode.includes('droneToDeviceLineRef'), 'FAIL: MapPanel still contains droneToDeviceLineRef');
assert(!mapPanelCode.includes('handleLocateDevice'), 'FAIL: MapPanel still contains handleLocateDevice');
assert(!mapPanelCode.includes('handleSetHomeToDevice'), 'FAIL: MapPanel still contains handleSetHomeToDevice');
assert(!mapPanelCode.includes('ipapi.co'), 'FAIL: MapPanel still contains ipapi.co IP location lookup');
assert(mapPanelCode.includes('telemetry.latitude') && mapPanelCode.includes('telemetry.longitude'), 'FAIL: MapPanel does not use telemetry lat/lon');
assert(mapPanelCode.includes('Pixhawk FC GPS'), 'FAIL: MapPanel does not display Pixhawk FC GPS HUD');
console.log('  ✓ MapPanel has zero mobile/device GPS references and strictly displays Pixhawk FC drone GPS');

// 2. Verify GoogleMapGroundStation.tsx
const gcsMapPath = path.resolve(__dirname, '../frontend/src/components/GroundStation/GoogleMapGroundStation.tsx');
const gcsMapCode = fs.readFileSync(gcsMapPath, 'utf-8');

console.log('▶ Checking GoogleMapGroundStation.tsx...');
assert(!gcsMapCode.includes('navigator.geolocation'), 'FAIL: GoogleMapGroundStation still contains navigator.geolocation');
assert(!gcsMapCode.includes('operatorLocation'), 'FAIL: GoogleMapGroundStation still contains operatorLocation');
assert(!gcsMapCode.includes('operatorMarkerRef'), 'FAIL: GoogleMapGroundStation still contains operatorMarkerRef');
assert(!gcsMapCode.includes('operatorAccuracyCircleRef'), 'FAIL: GoogleMapGroundStation still contains operatorAccuracyCircleRef');
assert(!gcsMapCode.includes('handleGetOperatorLocation'), 'FAIL: GoogleMapGroundStation still contains handleGetOperatorLocation');
assert(gcsMapCode.includes('telemetry.latitude') && gcsMapCode.includes('telemetry.longitude'), 'FAIL: GoogleMapGroundStation does not use telemetry lat/lon');
console.log('  ✓ GoogleMapGroundStation has zero mobile/device GPS references and strictly displays Pixhawk FC drone GPS');

// 3. Verify Permissions-Policy in netlify.toml files
const frontendNetlifyToml = fs.readFileSync(path.resolve(__dirname, '../frontend/netlify.toml'), 'utf-8');
const rootNetlifyToml = fs.readFileSync(path.resolve(__dirname, '../netlify.toml'), 'utf-8');

console.log('▶ Checking Netlify Permissions-Policy...');
assert(!frontendNetlifyToml.includes('geolocation=*'), 'FAIL: frontend/netlify.toml still permits geolocation');
assert(!rootNetlifyToml.includes('geolocation=*'), 'FAIL: root netlify.toml still permits geolocation');
console.log('  ✓ Netlify configs no longer request or allow geolocation permissions');

console.log('\n================================================================');
console.log('🎉 ALL EXCLUSIVE PIXHAWK GPS VERIFICATION CHECKS PASSED (100%)');
console.log('================================================================');
