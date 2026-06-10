import type { WebSocketServer, WebSocket } from "ws";
import {
  serialize,
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "./protocol.js";

type Handler = (msg: ClientMessage) => void;

/**
 * Typed pub/sub over the sidebar WebSocket. The Node process is the single
 * source of truth; the sidebar is a view that reconnects freely.
 */
export class Bus {
  private sockets = new Set<WebSocket>();
  private handlers = new Set<Handler>();
  /** Replayed to late-joining sidebars so they can render current state. */
  private helloFactory: (() => ServerMessage) | null = null;

  attach(wss: WebSocketServer): void {
    wss.on("connection", (ws) => {
      this.sockets.add(ws);
      if (this.helloFactory) ws.send(serialize(this.helloFactory()));
      ws.on("message", (data) => {
        const msg = parseClientMessage(data.toString());
        if (msg) for (const h of this.handlers) h(msg);
      });
      ws.on("close", () => this.sockets.delete(ws));
      ws.on("error", () => this.sockets.delete(ws));
    });
  }

  onHello(factory: () => ServerMessage): void {
    this.helloFactory = factory;
  }

  send(msg: ServerMessage): void {
    const data = serialize(msg);
    for (const ws of this.sockets) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  onMessage(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Resolve once a message of the given type arrives. */
  waitFor<T extends ClientMessage["type"]>(type: T): Promise<Extract<ClientMessage, { type: T }>> {
    return new Promise((resolve) => {
      const off = this.onMessage((msg) => {
        if (msg.type === type) {
          off();
          resolve(msg as Extract<ClientMessage, { type: T }>);
        }
      });
    });
  }

  /** Resolve with whichever of the given message types arrives first. */
  waitForAny<T extends ClientMessage["type"]>(...types: T[]): Promise<Extract<ClientMessage, { type: T }>> {
    return new Promise((resolve) => {
      const off = this.onMessage((msg) => {
        if ((types as string[]).includes(msg.type)) {
          off();
          resolve(msg as Extract<ClientMessage, { type: T }>);
        }
      });
    });
  }
}
