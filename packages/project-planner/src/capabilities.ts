/**
 * Capability evaluation for a planned target.
 *
 * A target declares the capabilities it needs; the scan says whether they are
 * satisfied. Unknown is reported as a limitation, never as satisfied, and an
 * unsatisfied capability is a blocker — the plan must not claim it can build.
 */
import type { EnvironmentScan } from '@assembler/environment-manager';
import type { CapabilityRequirement, PlanBlocker } from './planner.js';

export function evaluatePlannedCapabilities(
  requiredCapabilities: readonly string[],
  environment: EnvironmentScan | undefined,
  blockers: PlanBlocker[],
  limitations: string[],
): CapabilityRequirement[] {
  return [...new Set(requiredCapabilities)].map((capability) => {
    if (environment === undefined) {
      return { capability, status: 'not-checked', reason: 'Environment was not scanned for this plan' };
    }
    const result = environment.capabilities.find((entry) => entry.capability === capability);
    if (result === undefined) {
      return { capability, status: 'unknown', reason: 'The environment manager did not evaluate this capability' };
    }
    const requirement: CapabilityRequirement = {
      capability,
      status: result.status,
      reason: result.reason,
    };
    if (result.status === 'unsatisfied') {
      blockers.push({
        code: 'CAPABILITY_UNSATISFIED',
        message: `${capability} is unsatisfied: ${result.reason}`,
        hint: 'Run `assembler doctor` for the detected toolchain and installation options.',
      });
    }
    if (result.status === 'unknown') {
      limitations.push(`Capability ${capability} could not be verified: ${result.reason}`);
    }
    return requirement;
  });
}
