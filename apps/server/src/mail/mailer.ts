/**
 * Sending mail (stage 28). Mail is on only when the server is configured for it; with no relay
 * every feature that would send a message does what it did before stage 28.
 *
 * Nothing here logs a message, its links or its codes. A failure is reported by kind and error
 * code only (an SMTP error text can quote the recipient).
 */
import { createTransport } from "nodemailer";
import type { MailConfig, MailSender } from "../config.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Why a message was not sent. The text is the server's, not the person's. */
export class MailError extends Error {
  constructor(
    message: string,
    readonly reason: "off" | "address" | "relay" | "timeout",
  ) {
    super(message);
    this.name = "MailError";
  }
}

/** What actually carries a message away. */
export interface Transport {
  deliver(from: MailSender, message: MailMessage): Promise<void>;
}

/**
 * An address that is safe to hand to a relay: one plain `local@domain`, with nothing that could
 * end a header line or start another recipient.
 */
export function mailable(address: string): boolean {
  return (
    address.length <= 254 &&
    /^[^\s<>,;"'\\()[\]:@]+@[^\s<>,;"'\\()[\]:@]+\.[^\s<>,;"'\\()[\]:@]+$/.test(address)
  );
}

/** A subject on one line, with no control characters, and not unreasonably long. */
export function oneLine(text: string, max = 150): string {
  // eslint-disable-next-line no-control-regex
  return text
    .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ")
    .trim()
    .slice(0, max);
}

const SEND_TIMEOUT_MS = 20_000;

/** The relay of the configuration: opportunistic or required STARTTLS, implicit TLS, or none. */
export function smtpTransport(
  config: Extract<MailConfig, { kind: "smtp" }>,
  /** How long to wait to connect and to be greeted; shorter in tests. */
  waitMs = 10_000,
): Transport {
  const transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === "tls",
    requireTLS: config.security === "required",
    ignoreTLS: config.security === "none",
    ...(config.user !== null && config.password !== null
      ? { auth: { user: config.user, pass: config.password } }
      : {}),
    // Opportunistic STARTTLS is for a private relay on the same network, which often has a
    // certificate that names no public host: it encrypts when it can and does not check who is
    // there. The other two settings check the certificate.
    tls: { rejectUnauthorized: config.security !== "starttls" },
    connectionTimeout: waitMs,
    greetingTimeout: waitMs,
    socketTimeout: SEND_TIMEOUT_MS,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async deliver(from, message) {
      await transporter.sendMail({
        from: { name: from.name, address: from.address },
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: { "Auto-Submitted": "auto-generated" },
      });
    },
  };
}

/** Keeps every message in memory. For tests: it exists only when `MAIL_TEST_TRANSPORT=memory`. */
export class MemoryTransport implements Transport {
  readonly messages: (MailMessage & { from: MailSender; at: string })[] = [];
  /** The next this many deliveries fail, as a relay that is down would. */
  failNext = 0;
  /** Makes each delivery wait this long first (tests of "sending does not hold the action up"). */
  delayMs = 0;
  async deliver(from: MailSender, message: MailMessage): Promise<void> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("The test relay refused the message.");
    }
    this.messages.push({ ...message, from, at: new Date().toISOString() });
  }
}

export interface MailLogger {
  warn(object: object, message: string): void;
}

/** The server's mail: whether it is on, one message at a time, and work that goes on after an answer. */
export class Mail {
  private logger: MailLogger | null = null;
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(
    private readonly transport: Transport | null,
    readonly sender: MailSender | null,
  ) {}

  static from(config: MailConfig | null): Mail {
    if (!config) return new Mail(null, null);
    return new Mail(
      config.kind === "memory" ? new MemoryTransport() : smtpTransport(config),
      config.from,
    );
  }

  get enabled(): boolean {
    return this.transport !== null && this.sender !== null;
  }

  /** The messages kept in memory; null unless this is the test transport. */
  get outbox(): MemoryTransport | null {
    return this.transport instanceof MemoryTransport ? this.transport : null;
  }

  logTo(logger: MailLogger): void {
    this.logger = logger;
  }

  /** Sends one message, or says why not. Bounded in time. Never logs the message. */
  async send(message: MailMessage): Promise<void> {
    if (!this.transport || !this.sender) throw new MailError("This server sends no mail.", "off");
    if (!mailable(message.to)) throw new MailError("Not an address mail can go to.", "address");
    const safe = { ...message, subject: oneLine(message.subject) };
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.transport.deliver(this.sender, safe),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new MailError("The mail relay took too long.", "timeout")),
            SEND_TIMEOUT_MS,
          );
          timer.unref();
        }),
      ]);
    } catch (err) {
      if (err instanceof MailError) throw err;
      const code = (err as { code?: unknown; responseCode?: unknown } | null) ?? {};
      this.logger?.warn(
        { code: String(code.code ?? ""), responseCode: Number(code.responseCode ?? 0) },
        "The mail relay did not take a message",
      );
      throw new MailError("The mail relay did not take the message.", "relay");
    } finally {
      clearTimeout(timer);
    }
  }

  /** Runs work after the answer has gone: it is waited for on shutdown and in tests, never by a request. */
  background(task: () => Promise<unknown>): void {
    const run = task()
      .catch((err: unknown) => {
        this.logger?.warn(
          { code: String((err as { code?: unknown } | null)?.code ?? "") },
          "Mail work failed",
        );
      })
      .finally(() => this.inflight.delete(run));
    this.inflight.add(run);
  }

  /** Resolves when everything started with `background` has finished. */
  async settled(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight]);
  }
}
