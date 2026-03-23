"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Scan Go module dependencies for license information.
 */
class GoScanner {
  constructor(dir) {
    this.dir = path.resolve(dir);
  }

  /**
   * Scan all Go module dependencies for license info.
   */
  async scan() {
    const dependencies = [];

    // Method 1: Parse go.sum
    const goSumPath = path.join(this.dir, "go.sum");
    if (fs.existsSync(goSumPath)) {
      const modules = this._parseGoSum(goSumPath);
      for (const mod of modules) {
        const info = this._findLicense(mod);
        dependencies.push(info);
      }
      return dependencies;
    }

    // Method 2: Use go list
    try {
      const output = execSync("go list -m -json all 2>/dev/null", {
        cwd: this.dir,
        encoding: "utf-8",
        timeout: 30000,
      });

      // go list -m -json outputs concatenated JSON objects
      const jsonBlocks = output
        .split("}\n{")
        .map((block, i, arr) => {
          if (i === 0) return block + "}";
          if (i === arr.length - 1) return "{" + block;
          return "{" + block + "}";
        });

      for (const block of jsonBlocks) {
        try {
          const mod = JSON.parse(block);
          if (mod.Main) continue; // skip the main module

          dependencies.push({
            name: mod.Path,
            version: mod.Version || "unknown",
            license: "UNKNOWN",
            licensePath: mod.Dir ? this._findLicenseFile(mod.Dir) : null,
            evidence: "From go list -m",
            ecosystem: "go",
          });
        } catch {
          // skip malformed JSON
        }
      }
    } catch {
      // go list not available, fall through
    }

    // Method 3: Parse go.mod
    const goModPath = path.join(this.dir, "go.mod");
    if (dependencies.length === 0 && fs.existsSync(goModPath)) {
      const mods = this._parseGoMod(goModPath);
      for (const mod of mods) {
        dependencies.push({
          name: mod.name,
          version: mod.version,
          license: "UNKNOWN",
          licensePath: null,
          evidence: "Declared in go.mod",
          ecosystem: "go",
        });
      }
    }

    // Try to find licenses in vendor/ directory
    const vendorDir = path.join(this.dir, "vendor");
    if (fs.existsSync(vendorDir)) {
      for (const dep of dependencies) {
        if (dep.license === "UNKNOWN") {
          const vendorLicense = this._findVendorLicense(vendorDir, dep.name);
          if (vendorLicense) {
            dep.licensePath = vendorLicense.path;
            dep.license = vendorLicense.license;
            dep.evidence = `vendor/${dep.name}: ${vendorLicense.license}`;
          }
        }
      }
    }

    return dependencies;
  }

  /**
   * Check a single Go module.
   */
  async checkSingle(moduleName) {
    return {
      name: moduleName,
      version: "unknown",
      license: "UNKNOWN",
      licensePath: null,
      evidence: "Single module lookup not fully supported for Go",
      ecosystem: "go",
    };
  }

  /**
   * Parse go.sum file to extract unique module paths and versions.
   */
  _parseGoSum(filepath) {
    const content = fs.readFileSync(filepath, "utf-8");
    const seen = new Set();
    const modules = [];

    for (const line of content.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;

      const modulePath = parts[0];
      let version = parts[1].replace("/go.mod", "");

      const key = `${modulePath}@${version}`;
      if (seen.has(key)) continue;
      seen.add(key);

      modules.push({ name: modulePath, version });
    }

    return modules;
  }

  /**
   * Parse go.mod file for require directives.
   */
  _parseGoMod(filepath) {
    const content = fs.readFileSync(filepath, "utf-8");
    const modules = [];
    let inRequire = false;

    for (let line of content.split("\n")) {
      line = line.trim();

      if (line.startsWith("require (")) {
        inRequire = true;
        continue;
      }
      if (line === ")") {
        inRequire = false;
        continue;
      }
      if (line.startsWith("require ") && !line.includes("(")) {
        const parts = line.replace("require ", "").trim().split(/\s+/);
        if (parts.length >= 2) {
          modules.push({ name: parts[0], version: parts[1] });
        }
        continue;
      }
      if (inRequire) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && !parts[0].startsWith("//")) {
          modules.push({ name: parts[0], version: parts[1] });
        }
      }
    }

    return modules;
  }

  /**
   * Find license info from vendor directory.
   */
  _findVendorLicense(vendorDir, modulePath) {
    const moduleDir = path.join(vendorDir, modulePath);
    if (!fs.existsSync(moduleDir)) return null;

    const licenseFile = this._findLicenseFile(moduleDir);
    if (!licenseFile) return null;

    try {
      const content = fs.readFileSync(licenseFile, "utf-8").substring(0, 500);
      const license = this._detectLicenseFromContent(content);
      return { path: licenseFile, license: license || "UNKNOWN" };
    } catch {
      return null;
    }
  }

  _findLicense(mod) {
    return {
      name: mod.name,
      version: mod.version,
      license: "UNKNOWN",
      licensePath: null,
      evidence: "From go.sum (install and use vendor/ for full license detection)",
      ecosystem: "go",
    };
  }

  _findLicenseFile(dir) {
    const candidates = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "LICENCE"];
    for (const name of candidates) {
      const fp = path.join(dir, name);
      if (fs.existsSync(fp)) return fp;
    }
    return null;
  }

  _detectLicenseFromContent(content) {
    const lower = content.toLowerCase();
    if (lower.includes("mit license") || lower.includes("permission is hereby granted, free of charge")) return "MIT";
    if (lower.includes("apache license") && lower.includes("version 2.0")) return "Apache-2.0";
    if (lower.includes("bsd 3-clause")) return "BSD-3-Clause";
    if (lower.includes("bsd 2-clause")) return "BSD-2-Clause";
    if (lower.includes("isc license")) return "ISC";
    if (lower.includes("mozilla public license") && lower.includes("2.0")) return "MPL-2.0";
    return null;
  }
}

module.exports = { GoScanner };
