import { createServer, type Server } from "node:net";

/** What a stand-in relay was given. */
export interface Received {
  from: string;
  to: string[];
  data: string;
  authenticated: string | null;
}

/**
 * A relay that speaks just enough SMTP to take a message: plain, with no STARTTLS offered, and
 * `AUTH PLAIN` when asked to require it. For tests of the transport.
 */
export class FakeRelay {
  readonly received: Received[] = [];
  private server: Server | null = null;
  port = 0;
  /** Refuses every recipient, as a relay that does not know the domain would. */
  refuse = false;

  constructor(private readonly requireAuth: { user: string; pass: string } | null = null) {}

  async start(): Promise<this> {
    this.server = createServer((socket) => {
      let from = "";
      let to: string[] = [];
      let data: string | null = null;
      let authenticated: string | null = null;
      let buffer = "";
      socket.write("220 relay.test ESMTP\r\n");
      socket.on("error", () => undefined);
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        for (;;) {
          if (data !== null) {
            const end = buffer.indexOf("\r\n.\r\n");
            if (end === -1) return;
            data += buffer.slice(0, end);
            buffer = buffer.slice(end + 5);
            this.received.push({ from, to, data, authenticated });
            data = null;
            socket.write("250 queued\r\n");
            continue;
          }
          const eol = buffer.indexOf("\r\n");
          if (eol === -1) return;
          const line = buffer.slice(0, eol);
          buffer = buffer.slice(eol + 2);
          const verb = line.split(" ")[0]!.toUpperCase();
          if (verb === "EHLO" || verb === "HELO") {
            socket.write(
              this.requireAuth ? "250-relay.test\r\n250 AUTH PLAIN\r\n" : "250 relay.test\r\n",
            );
          } else if (verb === "AUTH") {
            const [, , token = ""] = line.split(" ");
            const [, user = "", pass = ""] = Buffer.from(token, "base64").toString().split("\0");
            if (user === this.requireAuth?.user && pass === this.requireAuth.pass) {
              authenticated = user;
              socket.write("235 ok\r\n");
            } else socket.write("535 no\r\n");
          } else if (verb === "MAIL") {
            if (this.requireAuth && !authenticated) socket.write("530 auth first\r\n");
            else {
              from = /<(.*)>/.exec(line)?.[1] ?? "";
              socket.write("250 ok\r\n");
            }
          } else if (verb === "RCPT") {
            if (this.refuse) socket.write("550 no such user\r\n");
            else {
              to.push(/<(.*)>/.exec(line)?.[1] ?? "");
              socket.write("250 ok\r\n");
            }
          } else if (verb === "DATA") {
            data = "";
            socket.write("354 go\r\n");
          } else if (verb === "RSET") {
            to = [];
            socket.write("250 ok\r\n");
          } else if (verb === "QUIT") {
            socket.end("221 bye\r\n");
          } else socket.write("250 ok\r\n");
        }
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as { port: number }).port;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}
