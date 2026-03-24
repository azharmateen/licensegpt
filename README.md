# licensegpt

[![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-blue?logo=anthropic&logoColor=white)](https://claude.ai/code)


Dependency license checker with plain-English decisions and evidence.

```bash
npx licensegpt scan
```

## Why licensegpt?

Every dependency you ship is a legal obligation. `licensegpt` scans your npm, pip, and Go dependencies, classifies each license, and gives you clear allowed/review/forbidden decisions backed by your policy file. Optionally, it explains each license in plain English using an LLM.

## Features

- **Multi-ecosystem** - Scans npm (node_modules/package-lock.json), pip (requirements.txt/pyproject.toml), Go (go.sum/vendor)
- **Policy Engine** - Define allowed, forbidden, and review-required licenses in `.licensegpt.json`
- **SPDX Compliance** - Validates license identifiers against the SPDX standard
- **Risk Classification** - Categorizes as permissive/copyleft/unknown with low/medium/high risk levels
- **Evidence Trail** - Shows exactly where each license was detected (package.json field, LICENSE file, pip metadata)
- **4 Output Formats** - Terminal table (color-coded), JSON, Markdown, CycloneDX SBOM
- **LLM Explanations** - Optional OpenAI-powered plain-English license implications
- **Compound Licenses** - Handles `MIT OR Apache-2.0`, `GPL-2.0 AND LGPL-3.0` expressions
- **CI-Ready** - `--strict` flag exits with code 1 on forbidden licenses

## Quickstart

```bash
# Install globally
npm install -g licensegpt

# Scan current project
licensegpt scan

# Scan with strict mode (fails on forbidden)
licensegpt scan --strict

# Check a specific package
licensegpt check express

# Initialize policy file
licensegpt policy init

# Output as markdown report
licensegpt scan -f markdown -o license-report.md

# Generate CycloneDX SBOM
licensegpt scan -f sbom -o sbom.json

# Get AI explanations for flagged licenses
OPENAI_API_KEY=sk-... licensegpt scan --explain
```

## Policy File

Create `.licensegpt.json` in your project root:

```json
{
  "allowed": ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC"],
  "forbidden": ["GPL-3.0-only", "AGPL-3.0-only", "SSPL-1.0"],
  "review_required": ["LGPL-3.0-only", "MPL-2.0"],
  "unknown_action": "review",
  "ignore_packages": ["internal-tool"],
  "override": {
    "special-pkg": {
      "action": "allowed",
      "reason": "Reviewed by legal on 2026-01-15"
    }
  }
}
```

## Output Example

```
Package                             | Version      | License              | Risk     | Decision   | Reason
----------------------------------------------------------------------------------------------------------------------------
react                               | 18.3.1       | MIT                  | low      | allowed    | License "MIT" is in allowed list
typescript                          | 5.4.5        | Apache-2.0           | low      | allowed    | License "Apache-2.0" is in allowe...
some-gpl-lib                        | 2.1.0        | GPL-3.0-only         | high     | forbidden  | License "GPL-3.0-only" is in forb...
```

## Architecture

```
Project Directory
       |
  [Auto-Detect] -- package.json? requirements.txt? go.sum?
       |
  [Scanners] -- npm-scanner, pip-scanner, go-scanner
       |
  [Analyzer] -- SPDX validation, risk classification, category
       |
  [Policy Engine] -- .licensegpt.json rules + overrides
       |
  [Explainer] -- (optional) LLM plain-English explanation
       |
  [Reporter] -- table / json / markdown / CycloneDX SBOM
```

## License

MIT
