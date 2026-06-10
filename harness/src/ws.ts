import type { ClientMessage, ServerMessage } from "../../src/ipc/protocol.js";
import { parseServerMessage, serialize } from "../../src/ipc/protocol.js";

export type MessageHandler = (msg: ServerMessage) => void;

/** Auto-reconnecting WebSocket to the Node CLI process. */
export function connect(onMessage: MessageHandler): (msg: ClientMessage) => void {
  let ws: WebSocket | null = null;
  let queue: ClientMessage[] = [];

  const open = () => {
    ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => {
      for (const m of queue) ws!.send(serialize(m));
      queue = [];
    };
    ws.onmessage = (e) => {
      const msg = parseServerMessage(String(e.data));
      if (msg) onMessage(msg);
    };
    ws.onclose = () => setTimeout(open, 500);
    ws.onerror = () => ws?.close();
  };
  open();

  return (msg) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(serialize(msg));
    else queue.push(msg);
  };
}
