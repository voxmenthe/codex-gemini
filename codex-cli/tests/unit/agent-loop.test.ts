import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../../src/utils/agent/agent-loop.ts';
import * as genai from '../../src/utils/genai.ts';

// Mock genai.chat
vi.mock('../../src/utils/genai.ts', () => ({
  genai: {},
  chat: vi.fn(),
}));

describe('AgentLoop', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calls chat() and emits a message item with the returned text', async () => {
    // Arrange
    (genai.chat as unknown as vi.Mock).mockResolvedValue('pong');
    const emitted: Array<any> = [];
    const loop = new AgentLoop({
      model: 'gemini-2.0-flash',
      instructions: '',
      approvalPolicy: {} as any,
      onItem: (item) => emitted.push(item),
      onLoading: () => {},
      getCommandConfirmation: () => Promise.resolve({ review: 'approve' } as any),
      onLastResponseId: () => {},
    });

    // Act
    await loop.run(
      [{ type: 'message', content: [{ type: 'input_text', text: 'ping' }] }],
      '',
    );

    // Assert
    expect(genai.chat).toHaveBeenCalledWith('ping', { model: 'gemini-2.0-flash' });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].content[0].text).toBe('pong');
  });
});
