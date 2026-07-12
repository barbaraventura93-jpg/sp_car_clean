module.exports = {
  id: 'ping',
  trigger: 'http',
  async run(_payload, core) {
    const result = await core.claude.complete({
      system: 'Você é um assistente da SP Car Clean. Responda apenas em português.',
      messages: [{ role: 'user', content: 'Responda com "pong" seguido de uma frase curta e criativa em uma única linha.' }],
      maxTokens: 64
    });
    return { ok: true, summary: result.text };
  }
};
