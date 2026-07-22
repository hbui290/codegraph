import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCPServer } from '../src/mcp';
import { StdioTransport } from '../src/mcp/transport';

describe('MCP direct shutdown', () => {
  const previousNoWatchdog = process.env.CODEGRAPH_NO_WATCHDOG;
  const previousHandshakeTimeout = process.env.CODEGRAPH_STARTUP_HANDSHAKE_TIMEOUT_MS;

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousNoWatchdog === undefined) delete process.env.CODEGRAPH_NO_WATCHDOG;
    else process.env.CODEGRAPH_NO_WATCHDOG = previousNoWatchdog;
    if (previousHandshakeTimeout === undefined) delete process.env.CODEGRAPH_STARTUP_HANDSHAKE_TIMEOUT_MS;
    else process.env.CODEGRAPH_STARTUP_HANDSHAKE_TIMEOUT_MS = previousHandshakeTimeout;
  });

  it('routes stdio close through the server drain before exiting', async () => {
    process.env.CODEGRAPH_NO_WATCHDOG = '1';
    process.env.CODEGRAPH_STARTUP_HANDSHAKE_TIMEOUT_MS = '0';

    let transport!: StdioTransport;
    vi.spyOn(StdioTransport.prototype, 'start').mockImplementation(function () {
      transport = this;
    });
    vi.spyOn(process.stdin, 'on').mockImplementation(() => process.stdin);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const server = new MCPServer();
    (server as unknown as { installSignalHandlers(): void }).installSignalHandlers = () => undefined;
    (server as unknown as { installPpidWatchdog(): void }).installPpidWatchdog = () => undefined;

    await (server as unknown as { startDirect(reason: string): Promise<void> }).startDirect('test');

    let releaseDrain!: () => void;
    const drainReleased = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const engine = (server as unknown as { engine: { stop(): Promise<void> } }).engine;
    vi.spyOn(engine, 'stop').mockReturnValue(drainReleased);

    const opts = (transport as unknown as {
      opts: { exitOnClose: boolean; onClose(): void };
    }).opts;
    expect(opts.exitOnClose).toBe(false);

    opts.onClose();
    expect((server as unknown as { stopped: boolean }).stopped).toBe(true);
    expect(exit).not.toHaveBeenCalled();

    releaseDrain();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });
});
