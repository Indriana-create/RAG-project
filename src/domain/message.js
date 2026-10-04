export const Role = Object.freeze({ USER: 'user', ASSISTANT: 'assistant' });

export function createMessage({ role, content, sources = [] }) {
  if (!Object.values(Role).includes(role)) throw new Error(`Role tidak valid: ${role}`);
  return Object.freeze({ role, content, sources, createdAt: new Date().toISOString() });
}
