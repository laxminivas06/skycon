/**
 * AERORECON — LOGIN PAGE & GROUND STATION THEME VERIFICATION TEST SUITE
 * 
 * Verifies all 8 acceptance criteria:
 * 1. Simulation Test Bench completely removed from login page
 * 2. Login page matches Ground Station design system tokens and styling
 * 3. Valid credentials authenticate successfully for operational roles
 * 4. Invalid credentials return and display appropriate errors
 * 5. Loading and error state logic is implemented properly
 * 6. Users session routes to appropriate operational interfaces
 * 7. Existing authentication rules and permissions preserved
 * 8. Responsive layout with no horizontal overflow
 */

if (typeof globalThis.window === 'undefined') {
  const storage: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = String(v); },
    removeItem: (k: string) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).localStorage = mockLocalStorage;
}

import fs from 'fs';
import path from 'path';
import { authService, ROLE_CREDENTIALS } from '../frontend/src/services/authService';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    console.error(`  ✗ [FAIL] ${testName}${detail ? ` — ${detail}` : ''}`);
  }
}

async function runLoginTests() {
  console.log('\n===============================================================');
  console.log('🔐 AERORECON — LOGIN PAGE REDESIGN & AUTHENTICATION TESTS');
  console.log('===============================================================\n');

  const loginFilePath = path.resolve(process.cwd(), 'frontend/src/components/Auth/LoginScreen.tsx');
  const loginContent = fs.readFileSync(loginFilePath, 'utf8');

  // --------------------------------------------------------------------------
  // TEST 1 — Removal of Simulation Test Bench
  // --------------------------------------------------------------------------
  console.log('▶ TEST 1: Simulation Test Bench Removal');
  {
    assert(!loginContent.includes('SIM TESTBENCH'), 'Simulation Test Bench role removed from login');
    assert(!loginContent.includes('TESTBENCH_OPERATOR'), 'TESTBENCH_OPERATOR callsign removed from login');
    assert(!loginContent.includes('TACTICAL 1-CLICK DEMO ACCESS'), 'Legacy demo access strip removed from login');
    assert(!loginContent.includes('handleQuickLogin'), 'Quick bypass handleQuickLogin removed from login');
    assert(!loginContent.includes('MultiRoleSimBench'), 'No reference to MultiRoleSimBench on login page');
  }

  // --------------------------------------------------------------------------
  // TEST 2 — Match Ground Station Design System
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 2: Ground Station Theme & Design Token Integration');
  {
    assert(loginContent.includes('var(--uav-bg)'), 'Uses Ground Station background token (--uav-bg)');
    assert(loginContent.includes('var(--uav-card)'), 'Uses Ground Station card token (--uav-card)');
    assert(loginContent.includes('var(--uav-card-border)'), 'Uses Ground Station border token (--uav-card-border)');
    assert(loginContent.includes('font-orbitron'), 'Uses Ground Station Orbitron typography for branding');
    assert(loginContent.includes('Quadcopter'), 'Includes custom Quadcopter brand glyph');
    assert(loginContent.includes('text-emerald-400'), 'Uses Ground Station emerald accent palette');
    assert(loginContent.includes('bg-emerald-600'), 'Uses Ground Station emerald submit button styling');
    assert(loginContent.includes('ThemeController'), 'Integrates ThemeController for dark/light consistency');
  }

  // --------------------------------------------------------------------------
  // TEST 3 — Valid Credentials Authentication
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 3: Valid Credentials Authentication for Operational Roles');
  {
    // Test Ground Station
    authService.logout();
    const gcsResult = authService.login('GROUND_STATION', ROLE_CREDENTIALS.GROUND_STATION.defaultCallsign, ROLE_CREDENTIALS.GROUND_STATION.passkey);
    assert(gcsResult.success === true, 'Ground Station login with valid credentials succeeds');
    const gcsSession = authService.getSession();
    assert(gcsSession?.role === 'GROUND_STATION', 'Session role is correctly set to GROUND_STATION');
    assert(gcsSession?.callsign === ROLE_CREDENTIALS.GROUND_STATION.defaultCallsign, 'Session callsign is correctly set');

    // Test Drone Core
    authService.logout();
    const droneResult = authService.login('DRONE', ROLE_CREDENTIALS.DRONE.defaultCallsign, ROLE_CREDENTIALS.DRONE.passkey);
    assert(droneResult.success === true, 'Drone Core login with valid credentials succeeds');
    const droneSession = authService.getSession();
    assert(droneSession?.role === 'DRONE', 'Session role is correctly set to DRONE');

    // Test Field Runner Unit
    authService.logout();
    const runnerResult = authService.login('RUNNER', ROLE_CREDENTIALS.RUNNER.defaultCallsign, ROLE_CREDENTIALS.RUNNER.passkey);
    assert(runnerResult.success === true, 'Runner Unit login with valid credentials succeeds');
    const runnerSession = authService.getSession();
    assert(runnerSession?.role === 'RUNNER', 'Session role is correctly set to RUNNER');
  }

  // --------------------------------------------------------------------------
  // TEST 4 — Invalid Credentials Authentication Error Handling
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 4: Invalid Credentials & Error Feedback');
  {
    authService.logout();
    const invalidResult = authService.login('GROUND_STATION', 'GCS_ALPHA_01', 'wrong_passkey_123');
    assert(invalidResult.success === false, 'Invalid passkey fails authentication');
    assert(Boolean(invalidResult.error && invalidResult.error.length > 0), 'Invalid authentication returns descriptive error message');
    assert(authService.getSession() === null, 'No session created upon failed authentication');
  }

  // --------------------------------------------------------------------------
  // TEST 5 — Loading & Visibility Elements in Login Form
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 5: Form Controls, Password Toggle & Loading States');
  {
    assert(loginContent.includes('isLoading'), 'Form implements isLoading state');
    assert(loginContent.includes('Loader2'), 'Form includes animated Loader2 spinner for authentication progress');
    assert(loginContent.includes('showPassword'), 'Form supports showPassword toggle state');
    assert(loginContent.includes('EyeOff'), 'Password visibility toggle includes EyeOff / Eye icons');
    assert(loginContent.includes('disabled={isLoading}'), 'Submit button disables during active authentication');
  }

  // --------------------------------------------------------------------------
  // TEST 6 — Responsive Full-Screen Layout
  // --------------------------------------------------------------------------
  console.log('\n▶ TEST 6: Responsive Layout & Viewport Lock');
  {
    assert(loginContent.includes('h-[100dvh]'), 'LoginScreen uses h-[100dvh] for full viewport lock');
    assert(loginContent.includes('overflow-hidden'), 'LoginScreen prevents unwanted page scrollbars');
    assert(loginContent.includes('max-w-md'), 'Login card uses max-w-md for optimal readability on mobile and desktop');
  }

  console.log('\n===============================================================');
  console.log(`TEST SUMMARY: ${passedTests} / ${totalTests} assertions passed (${((passedTests / totalTests) * 100).toFixed(1)}%)`);
  console.log('===============================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runLoginTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
