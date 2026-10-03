/** Membaca stream Server-Sent Events gaya OpenAI (`data: {json}` ... `data: [DONE]`). */
export async function* readSse(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      let data;
      try { data = JSON.parse(payload); } catch { continue; }
      yield data;
    }
  }
}
