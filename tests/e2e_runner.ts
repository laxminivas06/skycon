/**
 * =====================================================================================
 * S500-AeroRecon Quadcopter System — Master E2E Automated Test Runner
 * Baseline Specification: Technical Project Report Rev 2.4.0-PROD / ArduCopter V4.7.2
 * 
 * Executes all 4 E2E Test Tiers:
 * - Tier 1: Feature Coverage (>= 50 test cases)
 * - Tier 2: Boundary & Corner Cases (>= 50 test cases)
 * - Tier 3: Pairwise Cross-Feature Interactions (>= 20 test cases)
 * - Tier 4: Real-World Flight Mission Scenarios (>= 5 test cases)
 * 
 * Command: npx tsx skycon/tests/e2e_runner.ts
 * =====================================================================================
 */

import { runTier1Tests, TierSuiteSummary as T1Summary } from './test_tier1_features.js';
import { runTier2Tests, TierSuiteSummary as T2Summary } from './test_tier2_boundaries.js';
import { runTier3Tests, TierSuiteSummary as T3Summary } from './test_tier3_pairwise.js';
import { runTier4Tests, TierSuiteSummary as T4Summary } from './test_tier4_scenarios.js';

interface MasterSuiteReport {
  timestampUtc: string;
  totalTests: number;
  totalPassed: number;
  totalFailed: number;
  totalDurationMs: number;
  allTiersPassed: boolean;
  tiers: {
    tier1: T1Summary;
    tier2: T2Summary;
    tier3: T3Summary;
    tier4: T4Summary;
  };
}

export async function runMasterE2ESuite(): Promise<MasterSuiteReport> {
  const masterStart = Date.now();

  console.log('################################################################################');
  console.log('🛸 S500-AERORECON QUADCOPTER SYSTEM — MASTER E2E TEST RUNNER');
  console.log('   Baseline: Technical Project Report Rev 2.4.0-PROD / ArduCopter 4.7.2');
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  console.log('################################################################################\n');

  // Execute Tier 1
  const tier1Result = await runTier1Tests();

  // Execute Tier 2
  const tier2Result = await runTier2Tests();

  // Execute Tier 3
  const tier3Result = await runTier3Tests();

  // Execute Tier 4
  const tier4Result = await runTier4Tests();

  const totalDurationMs = Date.now() - masterStart;
  const totalTests = tier1Result.total + tier2Result.total + tier3Result.total + tier4Result.total;
  const totalPassed = tier1Result.passed + tier2Result.passed + tier3Result.passed + tier4Result.passed;
  const totalFailed = tier1Result.failed + tier2Result.failed + tier3Result.failed + tier4Result.failed;
  const allTiersPassed = (totalFailed === 0);

  console.log('\n================================================================================');
  console.log('📊 MASTER E2E VERIFICATION SCOREBOARD');
  console.log('================================================================================');
  console.log(`| Tier                                     | Total | Passed | Failed | Pass Rate | Duration |`);
  console.log(`|:-----------------------------------------|:-----:|:------:|:------:|:---------:|:--------:|`);
  console.log(`| ${tier1Result.tier.padEnd(40)} | ${String(tier1Result.total).padStart(5)} | ${String(tier1Result.passed).padStart(6)} | ${String(tier1Result.failed).padStart(6)} | ${(tier1Result.passed / tier1Result.total * 100).toFixed(1).padStart(8)}% | ${(tier1Result.durationMs / 1000).toFixed(2).padStart(6)}s |`);
  console.log(`| ${tier2Result.tier.padEnd(40)} | ${String(tier2Result.total).padStart(5)} | ${String(tier2Result.passed).padStart(6)} | ${String(tier2Result.failed).padStart(6)} | ${(tier2Result.passed / tier2Result.total * 100).toFixed(1).padStart(8)}% | ${(tier2Result.durationMs / 1000).toFixed(2).padStart(6)}s |`);
  console.log(`| ${tier3Result.tier.padEnd(40)} | ${String(tier3Result.total).padStart(5)} | ${String(tier3Result.passed).padStart(6)} | ${String(tier3Result.failed).padStart(6)} | ${(tier3Result.passed / tier3Result.total * 100).toFixed(1).padStart(8)}% | ${(tier3Result.durationMs / 1000).toFixed(2).padStart(6)}s |`);
  console.log(`| ${tier4Result.tier.padEnd(40)} | ${String(tier4Result.total).padStart(5)} | ${String(tier4Result.passed).padStart(6)} | ${String(tier4Result.failed).padStart(6)} | ${(tier4Result.passed / tier4Result.total * 100).toFixed(1).padStart(8)}% | ${(tier4Result.durationMs / 1000).toFixed(2).padStart(6)}s |`);
  console.log(`|------------------------------------------|-------|--------|--------|-----------|----------|`);
  console.log(`| TOTAL METRICS                            | ${String(totalTests).padStart(5)} | ${String(totalPassed).padStart(6)} | ${String(totalFailed).padStart(6)} | ${(totalPassed / totalTests * 100).toFixed(1).padStart(8)}% | ${(totalDurationMs / 1000).toFixed(2).padStart(6)}s |`);
  console.log('================================================================================\n');

  if (allTiersPassed) {
    console.log('🎉 [PASS] ALL E2E TIERS PASSED PERFECTLY (100% SUCCESS RATE).');
    console.log('   The S500-AeroRecon system is verified ready for field deployment & integration.');
  } else {
    console.error(`💥 [FAIL] E2E SUITE DETECTED ${totalFailed} TEST FAILURES.`);
  }

  return {
    timestampUtc: new Date().toISOString(),
    totalTests,
    totalPassed,
    totalFailed,
    totalDurationMs,
    allTiersPassed,
    tiers: {
      tier1: tier1Result,
      tier2: tier2Result,
      tier3: tier3Result,
      tier4: tier4Result
    }
  };
}

// Direct CLI Invocation
runMasterE2ESuite().then(report => {
  if (!report.allTiersPassed) {
    process.exit(1);
  }
  process.exit(0);
}).catch(err => {
  console.error('[FATAL] Master test runner encountered unhandled error:', err);
  process.exit(1);
});
