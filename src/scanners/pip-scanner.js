"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Scan Python dependencies for license information.
 */
class PipScanner {
  constructor(dir) {
    this.dir = path.resolve(dir);
  }

  /**
   * Scan all Python dependencies for license info.
   */
  async scan() {
    const dependencies = [];

    // Method 1: Try pip show for installed packages
    const packages = this._getInstalledPackages();

    if (packages.length > 0) {
      for (const pkg of packages) {
        const info = this._pipShow(pkg);
        if (info) dependencies.push(info);
      }
      return dependencies;
    }

    // Method 2: Parse requirements.txt
    const reqFiles = ["requirements.txt", "requirements-dev.txt", "requirements/base.txt"];
    for (const reqFile of reqFiles) {
      const reqPath = path.join(this.dir, reqFile);
      if (fs.existsSync(reqPath)) {
        const reqs = this._parseRequirements(reqPath);
        for (const req of reqs) {
          const info = this._pipShow(req.name);
          if (info) {
            dependencies.push(info);
          } else {
            dependencies.push({
              name: req.name,
              version: req.version || "unknown",
              license: "UNKNOWN",
              licensePath: null,
              evidence: `Declared in ${reqFile} but not installed`,
              ecosystem: "pip",
            });
          }
        }
      }
    }

    // Method 3: Parse pyproject.toml
    const pyprojectPath = path.join(this.dir, "pyproject.toml");
    if (fs.existsSync(pyprojectPath) && dependencies.length === 0) {
      const deps = this._parsePyproject(pyprojectPath);
      for (const dep of deps) {
        const info = this._pipShow(dep);
        if (info) {
          dependencies.push(info);
        } else {
          dependencies.push({
            name: dep,
            version: "unknown",
            license: "UNKNOWN",
            licensePath: null,
            evidence: "Declared in pyproject.toml but not installed",
            ecosystem: "pip",
          });
        }
      }
    }

    return dependencies;
  }

  /**
   * Check a single Python package.
   */
  async checkSingle(packageName) {
    return this._pipShow(packageName) || {
      name: packageName,
      version: "unknown",
      license: "UNKNOWN",
      licensePath: null,
      evidence: "Package not installed",
      ecosystem: "pip",
    };
  }

  /**
   * Get list of installed packages via pip.
   */
  _getInstalledPackages() {
    try {
      const output = execSync("pip list --format=json 2>/dev/null", {
        cwd: this.dir,
        encoding: "utf-8",
        timeout: 30000,
      });
      const packages = JSON.parse(output);
      return packages.map(p => p.name);
    } catch {
      return [];
    }
  }

  /**
   * Get detailed package info via pip show.
   */
  _pipShow(packageName) {
    try {
      const output = execSync(`pip show "${packageName}" 2>/dev/null`, {
        encoding: "utf-8",
        timeout: 10000,
      });

      const info = {};
      for (const line of output.split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) continue;
        const key = line.substring(0, colonIdx).trim();
        const value = line.substring(colonIdx + 1).trim();
        info[key] = value;
      }

      const license = info["License"] || "UNKNOWN";

      // Try to find LICENSE file in package location
      let licensePath = null;
      const location = info["Location"];
      if (location) {
        const pkgDir = path.join(location, packageName.replace(/-/g, "_"));
        const candidates = ["LICENSE", "LICENSE.txt", "LICENSE.md", "COPYING"];
        for (const name of candidates) {
          const fp = path.join(pkgDir, name);
          if (fs.existsSync(fp)) {
            licensePath = fp;
            break;
          }
        }
      }

      return {
        name: info["Name"] || packageName,
        version: info["Version"] || "unknown",
        license: this._normalizeLicense(license),
        licensePath,
        evidence: `pip show: License="${license}"`,
        ecosystem: "pip",
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse a requirements.txt file.
   */
  _parseRequirements(filepath) {
    const content = fs.readFileSync(filepath, "utf-8");
    const packages = [];

    for (let line of content.split("\n")) {
      line = line.trim();
      if (!line || line.startsWith("#") || line.startsWith("-")) continue;

      // Remove inline comments
      const commentIdx = line.indexOf("#");
      if (commentIdx !== -1) line = line.substring(0, commentIdx).trim();

      // Parse package name and version
      const match = line.match(/^([a-zA-Z0-9_.-]+)\s*(?:[><=!~]+\s*(.+))?$/);
      if (match) {
        packages.push({
          name: match[1],
          version: match[2] || "any",
        });
      }
    }

    return packages;
  }

  /**
   * Parse pyproject.toml for dependencies (basic parser).
   */
  _parsePyproject(filepath) {
    const content = fs.readFileSync(filepath, "utf-8");
    const deps = [];

    // Simple regex to find dependencies array
    const depsMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (depsMatch) {
      const depsBlock = depsMatch[1];
      const pkgMatches = depsBlock.matchAll(/"([a-zA-Z0-9_.-]+)(?:\[.*?\])?(?:\s*[><=!~].*)?"/g);
      for (const m of pkgMatches) {
        deps.push(m[1]);
      }
    }

    return deps;
  }

  /**
   * Normalize common license classifier strings to SPDX.
   */
  _normalizeLicense(raw) {
    if (!raw || raw === "UNKNOWN") return "UNKNOWN";

    const mapping = {
      "MIT License": "MIT",
      "MIT": "MIT",
      "BSD License": "BSD-3-Clause",
      "BSD": "BSD-3-Clause",
      "Apache Software License": "Apache-2.0",
      "Apache 2.0": "Apache-2.0",
      "Apache-2.0": "Apache-2.0",
      "GNU General Public License v3 (GPLv3)": "GPL-3.0-only",
      "GPLv3": "GPL-3.0-only",
      "GNU General Public License v2 (GPLv2)": "GPL-2.0-only",
      "ISC License (ISCL)": "ISC",
      "ISC": "ISC",
      "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
      "PSF License": "PSF-2.0",
      "Python Software Foundation License": "PSF-2.0",
    };

    return mapping[raw] || raw;
  }
}

module.exports = { PipScanner };
