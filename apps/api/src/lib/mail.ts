export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailProvider {
  send(message: MailMessage): Promise<{ id?: string }>;
}

export interface EmailBinding {
  send(message: {
    to: string;
    from: { email: string; name: string };
    subject: string;
    text: string;
    html?: string;
  }): Promise<unknown>;
}

export function cloudflareMailProvider(binding: EmailBinding, from: string): MailProvider {
  return {
    async send(message) {
      await binding.send({ ...message, from: { email: from, name: "时政小助手" } });
      return {};
    },
  };
}
