#!/usr/bin/env node

"use strict";

const { Command } = require("commander");
const chalk = require("chalk");
const path = require("path");
const fs = require("fs");
const { NpmScanner } = require("./scanners/npm-scanner");
const { PipScanner } = require("./scanners/pip-scanner");
const { GoScanner } = require("./scanners/go-scanner");
const { PolicyEngine } = require("./policy");
const { Analyzer } = require("./analyzer");
const { Explainer } = require("./explainer");
const { Reporter } = require("./reporter");

const program = new Command();

program
  .name("licensegpt")
  .description("Dependency license checker with plain-English decisions and evidence")
  .version("1.0.0");

program
  .command("scan")
  .description("Scan project dependencies for license information")
  .option("-d, --dir <path>", "Project directory to scan", ".")
  .option("-t, --type <type>", "Project type: npm, pip, go, auto", "auto")
  .option("-f, --format <format>", "Output format: table, json, markdown, sbom", "table")
  .option("-o, --output <file>", "Write output to file")
  .option("-p, --policy <file>", "Policy file path", ".licensegpt.json")
  .option("--explain", "Use LLM to explain license implications", false)
  .option("--strict", "Exit with code 1 if any forbidden licenses found", false)
  .action(async (opts) => {
    try {
      await runScan(opts);
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command("check <package>")
  .description("Check license for a specific package")
  .option("-t, --type <type>", "Package ecosystem: npm, pip, go", "npm")
  .option("--explain", "Get plain-English explanation", false)
  .action(async (pkg, opts) => {
    try {
      await runCheck(pkg, opts);
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command("policy")
  .description("Manage license policy")
  .command("init")
  .description("Initialize a .licensegpt.json policy file")
  .action(() => {
    initPolicy();
  });

async function runScan(opts) {
  const dir = path.resolve(opts.dir);
  console.log(chalk.blue.bold("licensegpt") + " scanning " + chalk.cyan(dir) + "...\n");

  // Detect project type
  const types = opts.type === "auto" ? detectProjectTypes(dir) : [opts.type];

  if (types.length === 0) {
    console.log(chalk.yellow("No supported project files found. Supported: package.json, requirements.txt, go.sum"));
    return;
  }

  // Load policy
  const policyPath = path.resolve(opts.policy);
  const policy = new PolicyEngine(policyPath);

  // Scan all detected types
  let allDependencies = [];

  for (const type of types) {
    const scanner = createScanner(type, dir);
    console.log(chalk.dim(`Scanning ${type} dependencies...`));
    const deps = await scanner.scan();
    allDependencies = allDependencies.concat(deps);
  }

  if (allDependencies.length === 0) {
    console.log(chalk.yellow("No dependencies found."));
    return;
  }

  console.log(chalk.green(`Found ${allDependencies.length} dependencies\n`));

  // Analyze each dependency
  const analyzer = new Analyzer(policy);
  const results = analyzer.analyzeAll(allDependencies);

  // Optional LLM explanation
  if (opts.explain) {
    const explainer = new Explainer();
    const flagged = results.filter(r => r.risk !== "low");
    if (flagged.length > 0) {
      console.log(chalk.dim("Getting AI explanations for flagged licenses...\n"));
      await explainer.explainBatch(flagged);
    }
  }

  // Report
  const reporter = new Reporter();
  const output = reporter.format(results, opts.format, {
    projectDir: dir,
    projectTypes: types,
  });

  if (opts.output) {
    fs.writeFileSync(opts.output, output, "utf-8");
    console.log(chalk.green(`\nReport written to ${opts.output}`));
  } else {
    console.log(output);
  }

  // Summary
  const summary = analyzer.summarize(results);
  console.log("\n" + chalk.bold("Summary:"));
  console.log(chalk.green(`  Permissive: ${summary.permissive}`));
  console.log(chalk.yellow(`  Copyleft:   ${summary.copyleft}`));
  console.log(chalk.red(`  Forbidden:  ${summary.forbidden}`));
  console.log(chalk.gray(`  Unknown:    ${summary.unknown}`));
  console.log(chalk.cyan(`  Total:      ${summary.total}`));

  if (opts.strict && summary.forbidden > 0) {
    console.log(chalk.red.bold(`\nFailed: ${summary.forbidden} forbidden licenses found`));
    process.exit(1);
  }
}

async function runCheck(pkg, opts) {
  console.log(chalk.blue.bold("licensegpt") + " checking " + chalk.cyan(pkg) + "...\n");

  const scanner = createScanner(opts.type, ".");
  const dep = await scanner.checkSingle(pkg);

  if (!dep) {
    console.log(chalk.yellow(`Package '${pkg}' not found`));
    return;
  }

  const policy = new PolicyEngine(".licensegpt.json");
  const analyzer = new Analyzer(policy);
  const result = analyzer.analyze(dep);

  console.log(chalk.bold("Package:  ") + result.name);
  console.log(chalk.bold("Version:  ") + result.version);
  console.log(chalk.bold("License:  ") + result.license);
  console.log(chalk.bold("SPDX:     ") + (result.spdxValid ? chalk.green("Valid") : chalk.yellow("Invalid/Unknown")));
  console.log(chalk.bold("Risk:     ") + riskColor(result.risk));
  console.log(chalk.bold("Decision: ") + decisionColor(result.decision));

  if (result.evidence) {
    console.log(chalk.bold("Evidence: ") + chalk.dim(result.evidence));
  }

  if (opts.explain) {
    const explainer = new Explainer();
    const explanation = await explainer.explain(result);
    console.log(chalk.bold("\nExplanation:"));
    console.log(explanation);
  }
}

function initPolicy() {
  const examplePath = path.join(__dirname, "..", ".licensegpt.example.json");
  const targetPath = ".licensegpt.json";

  if (fs.existsSync(targetPath)) {
    console.log(chalk.yellow(".licensegpt.json already exists"));
    return;
  }

  let content;
  if (fs.existsSync(examplePath)) {
    content = fs.readFileSync(examplePath, "utf-8");
  } else {
    content = JSON.stringify({
      allowed: [
        "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC",
        "0BSD", "Unlicense", "CC0-1.0", "Zlib", "BlueOak-1.0.0"
      ],
      forbidden: [
        "GPL-2.0-only", "GPL-3.0-only", "AGPL-3.0-only",
        "SSPL-1.0", "EUPL-1.1"
      ],
      review_required: [
        "LGPL-2.1-only", "LGPL-3.0-only", "MPL-2.0",
        "EPL-1.0", "EPL-2.0", "CDDL-1.0", "Artistic-2.0"
      ],
      unknown_action: "review",
      ignore_packages: [],
      override: {}
    }, null, 2);
  }

  fs.writeFileSync(targetPath, content, "utf-8");
  console.log(chalk.green("Created .licensegpt.json - edit to customize your license policy"));
}

function detectProjectTypes(dir) {
  const types = [];
  if (fs.existsSync(path.join(dir, "package.json"))) types.push("npm");
  if (
    fs.existsSync(path.join(dir, "requirements.txt")) ||
    fs.existsSync(path.join(dir, "Pipfile")) ||
    fs.existsSync(path.join(dir, "pyproject.toml"))
  ) types.push("pip");
  if (
    fs.existsSync(path.join(dir, "go.sum")) ||
    fs.existsSync(path.join(dir, "go.mod"))
  ) types.push("go");
  return types;
}

function createScanner(type, dir) {
  switch (type) {
    case "npm": return new NpmScanner(dir);
    case "pip": return new PipScanner(dir);
    case "go":  return new GoScanner(dir);
    default: throw new Error(`Unknown scanner type: ${type}`);
  }
}

function riskColor(risk) {
  switch (risk) {
    case "low":    return chalk.green(risk);
    case "medium": return chalk.yellow(risk);
    case "high":   return chalk.red(risk);
    default:       return chalk.gray(risk);
  }
}

function decisionColor(decision) {
  switch (decision) {
    case "allowed":  return chalk.green(decision);
    case "review":   return chalk.yellow(decision);
    case "forbidden": return chalk.red(decision);
    default:         return chalk.gray(decision);
  }
}

program.parse();
