"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Scan npm/node_modules for dependency license information.
 */
class NpmScanner {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.nodeModulesDir = path.join(this.dir, "node_modules");
  }

  /**
   * Scan all installed npm packages for license info.
   * @returns {Array<{name, version, license, licensePath, evidence}>}
   */
  async scan() {
    const dependencies = [];

    // Read the project's package.json for declared deps
    const pkgJsonPath = path.join(this.dir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      return dependencies;
    }

    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    const allDeps = {
      ...pkgJson.dependencies,
      ...pkgJson.devDependencies,
    };

    // Walk node_modules if it exists
    if (fs.existsSync(this.nodeModulesDir)) {
      const entries = fs.readdirSync(this.nodeModulesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // Handle scoped packages (@org/pkg)
        if (entry.name.startsWith("@")) {
          const scopeDir = path.join(this.nodeModulesDir, entry.name);
          const scopedEntries = fs.readdirSync(scopeDir, { withFileTypes: true });
          for (const scopedEntry of scopedEntries) {
            if (!scopedEntry.isDirectory()) continue;
            const fullName = `${entry.name}/${scopedEntry.name}`;
            const depInfo = this._extractLicenseInfo(fullName);
            if (depInfo) dependencies.push(depInfo);
          }
        } else if (!entry.name.startsWith(".")) {
          const depInfo = this._extractLicenseInfo(entry.name);
          if (depInfo) dependencies.push(depInfo);
        }
      }
    } else {
      // Fallback: parse package-lock.json
      const lockPath = path.join(this.dir, "package-lock.json");
      if (fs.existsSync(lockPath)) {
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
        const packages = lock.packages || {};

        for (const [pkgPath, pkgInfo] of Object.entries(packages)) {
          if (!pkgPath || pkgPath === "") continue;
          const name = pkgPath.replace("node_modules/", "");
          if (name.includes("node_modules/")) continue; // skip nested

          dependencies.push({
            name,
            version: pkgInfo.version || "unknown",
            license: pkgInfo.license || "UNKNOWN",
            licensePath: null,
            evidence: "Extracted from package-lock.json",
            ecosystem: "npm",
          });
        }
      }
    }

    return dependencies;
  }

  /**
   * Check a single package by name.
   */
  async checkSingle(packageName) {
    // Try node_modules first
    const depInfo = this._extractLicenseInfo(packageName);
    if (depInfo) return depInfo;

    // Fallback: try to read from npm registry (offline-only fallback)
    return {
      name: packageName,
      version: "unknown",
      license: "UNKNOWN",
      licensePath: null,
      evidence: "Package not installed locally",
      ecosystem: "npm",
    };
  }

  /**
   * Extract license information from a package in node_modules.
   */
  _extractLicenseInfo(packageName) {
    const pkgDir = path.join(this.nodeModulesDir, packageName);
    const pkgJsonPath = path.join(pkgDir, "package.json");

    if (!fs.existsSync(pkgJsonPath)) return null;

    let pkgJson;
    try {
      pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    } catch {
      return null;
    }

    // Extract license from package.json
    let license = "UNKNOWN";
    let evidence = "";

    if (typeof pkgJson.license === "string") {
      license = pkgJson.license;
      evidence = `package.json "license" field: "${license}"`;
    } else if (typeof pkgJson.license === "object" && pkgJson.license.type) {
      license = pkgJson.license.type;
      evidence = `package.json "license.type" field: "${license}"`;
    } else if (Array.isArray(pkgJson.licenses)) {
      const ids = pkgJson.licenses.map(l => l.type || l).filter(Boolean);
      license = ids.join(" OR ");
      evidence = `package.json "licenses" array: ${ids.join(", ")}`;
    }

    // Try to find and read LICENSE file for additional evidence
    const licensePath = this._findLicenseFile(pkgDir);
    if (licensePath) {
      const snippet = this._extractLicenseSnippet(licensePath);
      if (snippet) {
        evidence += ` | LICENSE file: ${path.basename(licensePath)}`;
        // If license was UNKNOWN, try to detect from file content
        if (license === "UNKNOWN") {
          license = this._detectLicenseFromContent(snippet) || "UNKNOWN";
          evidence = `Detected from ${path.basename(licensePath)} content`;
        }
      }
    }

    return {
      name: packageName,
      version: pkgJson.version || "unknown",
      license,
      licensePath,
      evidence,
      ecosystem: "npm",
    };
  }

  /**
   * Find a LICENSE file in a package directory.
   */
  _findLicenseFile(pkgDir) {
    const candidates = [
      "LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE.MIT",
      "LICENCE", "LICENCE.md", "LICENCE.txt",
      "license", "license.md", "license.txt",
      "COPYING", "COPYING.md",
    ];

    for (const name of candidates) {
      const fullPath = path.join(pkgDir, name);
      if (fs.existsSync(fullPath)) return fullPath;
    }
    return null;
  }

  /**
   * Extract the first 500 chars of a license file as evidence.
   */
  _extractLicenseSnippet(filepath) {
    try {
      const content = fs.readFileSync(filepath, "utf-8");
      return content.substring(0, 500);
    } catch {
      return null;
    }
  }

  /**
   * Detect license type from file content using keyword matching.
   */
  _detectLicenseFromContent(content) {
    const lower = content.toLowerCase();

    if (lower.includes("mit license") || lower.includes("permission is hereby granted, free of charge")) {
      return "MIT";
    }
    if (lower.includes("apache license") && lower.includes("version 2.0")) {
      return "Apache-2.0";
    }
    if (lower.includes("bsd 3-clause") || lower.includes("redistributions of source code must retain")) {
      if (lower.includes("neither the name")) return "BSD-3-Clause";
      return "BSD-2-Clause";
    }
    if (lower.includes("isc license")) return "ISC";
    if (lower.includes("mozilla public license") && lower.includes("2.0")) return "MPL-2.0";
    if (lower.includes("gnu general public license") && lower.includes("version 3")) return "GPL-3.0-only";
    if (lower.includes("gnu general public license") && lower.includes("version 2")) return "GPL-2.0-only";
    if (lower.includes("gnu lesser general public license")) return "LGPL-3.0-only";
    if (lower.includes("unlicense")) return "Unlicense";
    if (lower.includes("creative commons") && lower.includes("cc0")) return "CC0-1.0";

    return null;
  }
}

module.exports = { NpmScanner };
