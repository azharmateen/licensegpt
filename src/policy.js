"use strict";

const fs = require("fs");
const path = require("path");

/**
 * License policy engine - reads .licensegpt.json and makes decisions.
 */
class PolicyEngine {
  constructor(policyPath) {
    this.policy = this._loadPolicy(policyPath);
  }

  /**
   * Check a license against the policy.
   * @param {string} license - SPDX license identifier
   * @param {string} packageName - Package name (for overrides)
   * @returns {{decision: string, reason: string}}
   */
  check(license, packageName) {
    // Check package-level overrides first
    if (this.policy.override && this.policy.override[packageName]) {
      const override = this.policy.override[packageName];
      return {
        decision: override.action || "allowed",
        reason: override.reason || `Override for ${packageName}`,
      };
    }

    // Check ignored packages
    if (this.policy.ignore_packages && this.policy.ignore_packages.includes(packageName)) {
      return { decision: "allowed", reason: "Package is in ignore list" };
    }

    if (!license || license === "UNKNOWN") {
      const action = this.policy.unknown_action || "review";
      return { decision: action, reason: "License is unknown" };
    }

    // Normalize for comparison
    const normalized = license.trim();

    // Handle compound licenses (OR / AND)
    if (normalized.includes(" OR ")) {
      return this._checkCompound(normalized, "OR", packageName);
    }
    if (normalized.includes(" AND ")) {
      return this._checkCompound(normalized, "AND", packageName);
    }

    // Check forbidden first
    if (this._matches(normalized, this.policy.forbidden || [])) {
      return { decision: "forbidden", reason: `License "${normalized}" is in forbidden list` };
    }

    // Check review-required
    if (this._matches(normalized, this.policy.review_required || [])) {
      return { decision: "review", reason: `License "${normalized}" requires manual review` };
    }

    // Check allowed
    if (this._matches(normalized, this.policy.allowed || [])) {
      return { decision: "allowed", reason: `License "${normalized}" is in allowed list` };
    }

    // Not in any list
    const action = this.policy.unknown_action || "review";
    return { decision: action, reason: `License "${normalized}" not found in policy` };
  }

  /**
   * Handle compound license expressions (OR/AND).
   */
  _checkCompound(expression, operator, packageName) {
    const parts = expression.split(` ${operator} `).map(s => s.trim().replace(/[()]/g, ""));

    if (operator === "OR") {
      // For OR: if ANY option is allowed, the whole thing is allowed
      // Pick the most permissive option
      let bestDecision = "forbidden";
      let bestReason = "";
      const priority = { allowed: 0, review: 1, forbidden: 2 };

      for (const part of parts) {
        const result = this.check(part, packageName);
        if (priority[result.decision] < priority[bestDecision]) {
          bestDecision = result.decision;
          bestReason = result.reason;
        }
      }

      return {
        decision: bestDecision,
        reason: `${expression}: best option - ${bestReason}`,
      };
    }

    if (operator === "AND") {
      // For AND: ALL must be allowed
      for (const part of parts) {
        const result = this.check(part, packageName);
        if (result.decision !== "allowed") {
          return {
            decision: result.decision,
            reason: `${expression}: blocked by ${part} - ${result.reason}`,
          };
        }
      }
      return {
        decision: "allowed",
        reason: `All licenses in "${expression}" are allowed`,
      };
    }

    return { decision: "review", reason: `Complex expression: ${expression}` };
  }

  /**
   * Check if a license matches any in a list (with basic SPDX flexibility).
   */
  _matches(license, list) {
    for (const item of list) {
      if (license === item) return true;
      // Handle -only/-or-later variants
      if (license.replace("-only", "") === item.replace("-only", "")) return true;
      if (license.replace("-or-later", "+") === item) return true;
    }
    return false;
  }

  /**
   * Load policy from file or return default.
   */
  _loadPolicy(policyPath) {
    const resolved = path.resolve(policyPath);

    if (fs.existsSync(resolved)) {
      try {
        const content = fs.readFileSync(resolved, "utf-8");
        return JSON.parse(content);
      } catch (err) {
        console.warn(`Warning: Could not parse policy file ${resolved}: ${err.message}`);
      }
    }

    // Default policy
    return {
      allowed: [
        "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC",
        "0BSD", "Unlicense", "CC0-1.0", "Zlib", "BlueOak-1.0.0",
        "PSF-2.0",
      ],
      forbidden: [
        "GPL-2.0-only", "GPL-3.0-only", "AGPL-3.0-only", "SSPL-1.0",
      ],
      review_required: [
        "LGPL-2.1-only", "LGPL-3.0-only", "MPL-2.0", "EPL-1.0", "EPL-2.0",
      ],
      unknown_action: "review",
      ignore_packages: [],
      override: {},
    };
  }
}

module.exports = { PolicyEngine };
