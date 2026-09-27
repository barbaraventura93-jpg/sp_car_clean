const API_URL     = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const TIMEOUT_MS  = 25000;

async function complete({ system, messages, maxTokens = 1024, model = DEFAULT_MODEL }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    messages,
    ...(system ? { system } : {})
  });

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  };

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(API_URL, { method: 'POST', headers, body, signal: controller.signal });
      clearTimeout(timer);
      if (resp.status >= 500 && attempt === 0) {
        lastErr = new Error(`Claude API ${resp.status}`);
        continue;
      }
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Claude API ${resp.status}: ${t}`);
      }
      const data = await resp.json();
      return {
        text: data.content[0].text,
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens
      };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e.name === 'AbortError' ? new Error('Claude API timeout (25s)') : e;
      if (attempt === 0) continue;
    }
  }
  throw lastErr;
}

module.exports = { complete };
