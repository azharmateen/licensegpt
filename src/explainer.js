"use strict";

/**
 * Optional LLM-powered license explanation generator.
 * Uses OpenAI API if OPENAI_API_KEY is set, otherwise provides canned explanations.
 */
class Explainer {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.hasLLM = !!this.apiKey;
  }

  /**
   * Explain a single license result.
   */
  async explain(result) {
    if (this.hasLLM) {
      return this._llmExplain(result);
    }
    return this._cannedExplain(result);
  }

  /**
   * Explain a batch of results.
   */
  async explainBatch(results) {
    for (const result of results) {
      result.explanation = await this.explain(result);
    }
  }

  /**
   * Call OpenAI API for a plain-English explanation.
   */
  async _llmExplain(result) {
    try {
      let OpenAI;
      try {
        OpenAI = require("openai");
      } catch {
        return this._cannedExplain(result);
      }

      const client = new OpenAI({ apiKey: this.apiKey });
      const prompt = `You are a software licensing expert. Explain in 2-3 plain-English sentences what the "${result.license}" license means for a commercial software project that uses "${result.name}" as a dependency.

Key points to cover:
- Can they use it in proprietary/commercial software?
- Are there any obligations (attribution, source disclosure, etc.)?
- What's the risk level?

Be concise and practical.`;

      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.3,
      });

      return response.choices[0].message.content.trim();
    } catch (err) {
      return this._cannedExplain(result);
    }
  }

  /**
   * Provide canned explanations for common licenses (no API needed).
   */
  _cannedExplain(result) {
    const explanations = {
      "MIT": "MIT is one of the most permissive licenses. You can use, modify, and distribute this code in commercial projects with no restrictions. The only requirement is to include the original copyright notice and license text.",

      "Apache-2.0": "Apache 2.0 is permissive and business-friendly. You can use it commercially, but you must include the license, state any changes made, and include the NOTICE file if one exists. It also provides an express grant of patent rights.",

      "BSD-2-Clause": "BSD 2-Clause is very permissive. You can use it commercially with just two conditions: retain the copyright notice in source code and in documentation for binary distributions.",

      "BSD-3-Clause": "BSD 3-Clause is permissive. Same as BSD-2-Clause but adds a clause preventing use of the author's name for endorsement without permission. Safe for commercial use.",

      "ISC": "ISC is functionally equivalent to MIT. Fully permissive, safe for commercial use. Just include the copyright notice.",

      "GPL-2.0-only": "GPL-2.0 is a strong copyleft license. If you link against or include GPL-2.0 code, your entire project must also be released under GPL-2.0. This is generally incompatible with proprietary/commercial software unless used as a separate process.",

      "GPL-3.0-only": "GPL-3.0 is a strong copyleft license with additional anti-tivoization provisions. If you use GPL-3.0 code in your project, the entire project must be open-sourced under GPL-3.0. Not suitable for proprietary software.",

      "AGPL-3.0-only": "AGPL-3.0 is the strongest copyleft license. Even providing the software as a network service (SaaS) triggers the copyleft requirement. Your entire codebase must be open-sourced. Extremely risky for commercial use.",

      "LGPL-3.0-only": "LGPL-3.0 is a weak copyleft license. You can use LGPL libraries in proprietary software as long as you dynamically link to them (not statically). Any modifications to the LGPL library itself must be open-sourced.",

      "MPL-2.0": "MPL-2.0 is a file-level copyleft license. You can use MPL-2.0 code in proprietary projects, but any modifications to the MPL-licensed files must be shared. New files you write remain proprietary.",

      "Unlicense": "The Unlicense dedicates the code to the public domain. No restrictions whatsoever. Safe for any use.",

      "CC0-1.0": "CC0 is a public domain dedication. No restrictions on use. Note: CC0 is designed for content/data, not software, but is commonly used for both.",

      "SSPL-1.0": "SSPL (Server Side Public License) requires that if you offer the software as a service, you must release the entire service stack source code. This is extremely restrictive for commercial SaaS use.",
    };

    const explanation = explanations[result.license];
    if (explanation) return explanation;

    if (result.category === "permissive") {
      return `${result.license} is a permissive license. Generally safe for commercial use, but check specific terms.`;
    }
    if (result.category === "copyleft") {
      return `${result.license} is a copyleft license. It may require you to open-source your code if you distribute it. Consult a lawyer for your specific use case.`;
    }

    return `License "${result.license}" is not well-known. Manual review recommended before using in commercial projects.`;
  }
}

module.exports = { Explainer };
