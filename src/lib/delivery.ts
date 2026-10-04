import { runtimeConfig } from "./env";
import type { TokenPurpose } from "./identity";
// This adapter is invoked only by user-requested authentication flows.
// No background outreach or token-bearing messages are sent by development tests.
export async function deliverAuthLink(input: { id: string; email: string; purpose: TokenPurpose; token: string }): Promise<"fixture" | "unavailable" | "sent"> {
  const config = runtimeConfig();
  if (config.DELIVERY_MODE === "unavailable") return "unavailable";
  const route = input.purpose === "VERIFY_EMAIL" ? "/verify-email" : "/reset-password";
  const link = new URL(route, config.APP_ORIGIN);
  link.searchParams.set("token", input.token);
  if (config.DELIVERY_MODE === "fixture") {
    if (process.env.NODE_ENV === "production") throw new Error("Fixture delivery forbidden in production");
    const { deliverFixtureAuthLink } = await import("./delivery-fixture");
    return deliverFixtureAuthLink(input);
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `infame-auth/${input.id}` },
    body: JSON.stringify({ from: config.EMAIL_FROM, to: [input.email], subject: input.purpose === "VERIFY_EMAIL" ? "تأكيد بريدك في إنفيم / Verify your Infame email" : "استعادة حساب إنفيم / Recover your Infame account",
      text: `إنفيم / Infame\n\n${link.href}\n\nهذا الرابط صالح لمدة 30 دقيقة ولمرة واحدة.\nThis link expires in 30 minutes and can be used once.\n\nإذا لم تطلبه، تجاهل الرسالة. If you did not request this, ignore this message.` }),
  });
  if (!response.ok) throw new Error("Email delivery failed");
  return "sent";
}
