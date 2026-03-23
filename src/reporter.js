"use strict";

const chalk = require("chalk");

/**
 * Format scan results in various output formats.
 */
class Reporter {
  /**
   * Format results in the specified format.
   */
  format(results, formatType, meta = {}) {
    switch (formatType) {
      case "table":   return this._formatTable(results);
      case "json":    return this._formatJSON(results, meta);
      case "markdown": return this._formatMarkdown(results, meta);
      case "sbom":    return this._formatSBOM(results, meta);
      default:        return this._formatTable(results);
    }
  }

  /**
   * Color-coded terminal table output.
   */
  _formatTable(results) {
    const lines = [];

    // Header
    const header = [
      pad("Package", 35),
      pad("Version", 12),
      pad("License", 20),
      pad("Risk", 8),
      pad("Decision", 10),
      "Reason",
    ].join(" | ");

    lines.push(chalk.bold(header));
    lines.push("-".repeat(120));

    // Sort: forbidden first, then review, then allowed
    const sortOrder = { forbidden: 0, review: 1, allowed: 2 };
    const sorted = [...results].sort((a, b) =>
      (sortOrder[a.decision] ?? 3) - (sortOrder[b.decision] ?? 3)
    );

    for (const r of sorted) {
      const row = [
        pad(r.name, 35),
        pad(r.version, 12),
        pad(this._colorLicense(r), 20),
        pad(this._colorRisk(r.risk), 8),
        pad(this._colorDecision(r.decision), 10),
        chalk.dim(truncate(r.reason, 40)),
      ].join(" | ");
      lines.push(row);
    }

    return lines.join("\n");
  }

  /**
   * JSON output.
   */
  _formatJSON(results, meta) {
    const output = {
      timestamp: new Date().toISOString(),
      project: meta.projectDir || ".",
      ecosystems: meta.projectTypes || [],
      dependencies: results.map(r => ({
        name: r.name,
        version: r.version,
        license: r.license,
        spdx_valid: r.spdxValid,
        category: r.category,
        risk: r.risk,
        decision: r.decision,
        reason: r.reason,
        evidence: r.evidence,
        ecosystem: r.ecosystem,
        explanation: r.explanation,
      })),
      summary: {
        total: results.length,
        allowed: results.filter(r => r.decision === "allowed").length,
        review: results.filter(r => r.decision === "review").length,
        forbidden: results.filter(r => r.decision === "forbidden").length,
      },
    };
    return JSON.stringify(output, null, 2);
  }

  /**
   * Markdown report output.
   */
  _formatMarkdown(results, meta) {
    const lines = [];

    lines.push("# License Scan Report");
    lines.push("");
    lines.push(`**Generated:** ${new Date().toISOString()}`);
    lines.push(`**Project:** ${meta.projectDir || "."}`);
    lines.push(`**Total Dependencies:** ${results.length}`);
    lines.push("");

    // Summary
    const allowed = results.filter(r => r.decision === "allowed").length;
    const review = results.filter(r => r.decision === "review").length;
    const forbidden = results.filter(r => r.decision === "forbidden").length;

    lines.push("## Summary");
    lines.push("");
    lines.push(`| Status | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Allowed | ${allowed} |`);
    lines.push(`| Needs Review | ${review} |`);
    lines.push(`| Forbidden | ${forbidden} |`);
    lines.push("");

    // Forbidden packages (if any)
    if (forbidden > 0) {
      lines.push("## Forbidden Licenses");
      lines.push("");
      for (const r of results.filter(r => r.decision === "forbidden")) {
        lines.push(`- **${r.name}** (${r.version}) - ${r.license}: ${r.reason}`);
      }
      lines.push("");
    }

    // Review-required packages
    if (review > 0) {
      lines.push("## Needs Review");
      lines.push("");
      for (const r of results.filter(r => r.decision === "review")) {
        lines.push(`- **${r.name}** (${r.version}) - ${r.license}: ${r.reason}`);
        if (r.explanation) {
          lines.push(`  > ${r.explanation}`);
        }
      }
      lines.push("");
    }

    // Full table
    lines.push("## All Dependencies");
    lines.push("");
    lines.push("| Package | Version | License | Risk | Decision |");
    lines.push("|---------|---------|---------|------|----------|");

    for (const r of results) {
      const riskEmoji = r.risk === "low" ? "LOW" : r.risk === "medium" ? "MEDIUM" : "HIGH";
      lines.push(`| ${r.name} | ${r.version} | ${r.license} | ${riskEmoji} | ${r.decision} |`);
    }

    return lines.join("\n");
  }

  /**
   * CycloneDX SBOM format (simplified).
   */
  _formatSBOM(results, meta) {
    const sbom = {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        tools: [
          {
            vendor: "licensegpt",
            name: "licensegpt",
            version: "1.0.0",
          },
        ],
        component: {
          type: "application",
          name: meta.projectDir ? require("path").basename(meta.projectDir) : "unknown",
          version: "0.0.0",
        },
      },
      components: results.map((r, idx) => {
        const component = {
          type: "library",
          "bom-ref": `pkg-${idx}`,
          name: r.name,
          version: r.version,
          purl: this._buildPurl(r),
        };

        if (r.license && r.license !== "UNKNOWN") {
          component.licenses = [
            {
              license: {
                id: r.spdxValid ? r.license : undefined,
                name: !r.spdxValid ? r.license : undefined,
              },
            },
          ];
        }

        return component;
      }),
    };

    return JSON.stringify(sbom, null, 2);
  }

  /**
   * Build a Package URL (purl) for a dependency.
   */
  _buildPurl(dep) {
    const type = dep.ecosystem === "npm" ? "npm" : dep.ecosystem === "pip" ? "pypi" : "golang";
    const name = dep.name.replace("/", "%2F");
    return `pkg:${type}/${name}@${dep.version}`;
  }

  _colorLicense(r) {
    if (r.category === "permissive") return chalk.green(r.license);
    if (r.category === "copyleft") return chalk.yellow(r.license);
    return chalk.red(r.license);
  }

  _colorRisk(risk) {
    if (risk === "low") return chalk.green(risk);
    if (risk === "medium") return chalk.yellow(risk);
    return chalk.red(risk);
  }

  _colorDecision(decision) {
    if (decision === "allowed") return chalk.green(decision);
    if (decision === "review") return chalk.yellow(decision);
    return chalk.red(decision);
  }
}

function pad(str, len) {
  if (str.length >= len) return str.substring(0, len);
  return str + " ".repeat(len - str.length);
}

function truncate(str, len) {
  if (str.length <= len) return str;
  return str.substring(0, len - 3) + "...";
}

module.exports = { Reporter };
