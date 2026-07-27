export async function chat(provider, apiKey, model, system, messages) {
  switch (provider) {
    case 'openai':
      return chatOpenAI('https://api.openai.com/v1/chat/completions', apiKey, model, system, messages, 'openai');
    case 'openrouter':
      return chatOpenAI('https://openrouter.ai/api/v1/chat/completions', apiKey, model, system, messages, 'openrouter');
    case 'anthropic':
      return chatAnthropic(apiKey, model, system, messages);
    case 'gemini':
      return chatGemini(apiKey, model, system, messages);
    case 'mock':
      return chatMock(messages);
    default:
      throw new Error('Unknown provider: ' + provider);
  }
}

async function chatOpenAI(url, apiKey, model, system, messages, providerName) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  if (!resp.ok) {
    throw new Error(providerName + ' API error ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
  }
  const json = await resp.json();
  return json.choices[0].message.content;
}

async function chatAnthropic(apiKey, model, system, messages) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages,
    }),
  });
  if (!resp.ok) {
    throw new Error('anthropic API error ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
  }
  const json = await resp.json();
  return json.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function chatGemini(apiKey, model, system, messages) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
      }),
    }
  );
  if (!resp.ok) {
    throw new Error('gemini API error ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
  }
  const json = await resp.json();
  return json.candidates[0].content.parts.map(p => p.text).join('');
}

async function chatMock(messages) {
  const assistantCount = messages.filter(m => m.role === 'assistant').length;
  if (assistantCount === 0) {
    return '```json\n{"tool":"get_games","ids":["g0"]}\n```';
  }
  return '# Tilt Mirror Report (mock)\n\nThis is a mock report for testing. Patterns: you play too fast after losses.';
}
