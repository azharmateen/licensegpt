"use strict";

let spdxIds;
try {
  spdxIds = require("spdx-license-ids");
} catch {
  spdxIds = [];
}

/**
 * Analyze dependency license information and classify risk.
 */
class Analyzer {
  constructor(policy) {
    this.policy = policy;
    this.spdxIds = new Set(spdxIds);
  }

  /**
   * Analyze all dependencies.
   */
  analyzeAll(dependencies) {
    return dependencies.map(dep => this.analyze(dep));
  }

  /**
   * Analyze a single dependency.
   */
  analyze(dep) {
    const license = dep.license || "UNKNOWN";
    const spdxValid = this._isSpdxValid(license);
    const category = this._categorize(license);
    const risk = this._assessRisk(license, category);
    const policyResult = this.policy.check(license, dep.name);

    return {
      name: dep.name,
      version: dep.version,
      license,
      spdxValid,
      category,
      risk,
      decision: policyResult.decision,
      reason: policyResult.reason,
      evidence: dep.evidence || "",
      licensePath: dep.licensePath,
      ecosystem: dep.ecosystem,
      explanation: null, // filled by Explainer if --explain
    };
  }

  /**
   * Generate summary statistics.
   */
  summarize(results) {
    const summary = {
      total: results.length,
      permissive: 0,
      copyleft: 0,
      forbidden: 0,
      unknown: 0,
      byLicense: {},
      byDecision: { allowed: 0, review: 0, forbidden: 0 },
    };

    for (const r of results) {
      // Count by category
      if (r.category === "permissive") summary.permissive++;
      else if (r.category === "copyleft") summary.copyleft++;
      else summary.unknown++;

      if (r.decision === "forbidden") summary.forbidden++;

      // Count by license
      summary.byLicense[r.license] = (summary.byLicense[r.license] || 0) + 1;

      // Count by decision
      if (summary.byDecision[r.decision] !== undefined) {
        summary.byDecision[r.decision]++;
      }
    }

    return summary;
  }

  /**
   * Check if a license identifier is a valid SPDX ID.
   */
  _isSpdxValid(license) {
    if (!license || license === "UNKNOWN") return false;

    // Handle compound expressions
    const parts = license.split(/\s+(?:OR|AND)\s+/).map(s => s.trim().replace(/[()]/g, ""));
    return parts.every(part => this.spdxIds.has(part));
  }

  /**
   * Categorize a license as permissive, copyleft, or unknown.
   */
  _categorize(license) {
    const permissive = new Set([
      "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC",
      "0BSD", "Unlicense", "CC0-1.0", "Zlib", "BlueOak-1.0.0",
      "PSF-2.0", "BSL-1.0", "Artistic-2.0",
    ]);

    const copyleft = new Set([
      "GPL-2.0-only", "GPL-2.0-or-later", "GPL-3.0-only", "GPL-3.0-or-later",
      "AGPL-3.0-only", "AGPL-3.0-or-later",
      "LGPL-2.1-only", "LGPL-2.1-or-later", "LGPL-3.0-only", "LGPL-3.0-or-later",
      "MPL-2.0", "EPL-1.0", "EPL-2.0", "CDDL-1.0", "CDDL-1.1",
      "EUPL-1.1", "EUPL-1.2", "SSPL-1.0",
    ]);

    if (permissive.has(license)) return "permissive";
    if (copyleft.has(license)) return "copyleft";

    // Check compound
    if (license.includes(" OR ") || license.includes(" AND ")) {
      const parts = license.split(/\s+(?:OR|AND)\s+/).map(s => s.trim().replace(/[()]/g, ""));
      const categories = parts.map(p => {
        if (permissive.has(p)) return "permissive";
        if (copyleft.has(p)) return "copyleft";
        return "unknown";
      });
      if (categories.includes("copyleft")) return "copyleft";
      if (categories.every(c => c === "permissive")) return "permissive";
    }

    return "unknown";
  }

  /**
   * Assess risk level: low, medium, high.
   */
  _assessRisk(license, category) {
    if (!license || license === "UNKNOWN") return "high";
    if (category === "permissive") return "low";
    if (category === "copyleft") {
      // Weak copyleft is medium, strong copyleft is high
      const strongCopyleft = new Set([
        "GPL-2.0-only", "GPL-3.0-only", "AGPL-3.0-only", "SSPL-1.0",
      ]);
      if (strongCopyleft.has(license)) return "high";
      return "medium";
    }
    return "medium";
  }
}

module.exports = { Analyzer };
