import nodemailer from "nodemailer";
import { env, hasSmtpCredentials } from "@/lib/env";

type VerificationEmailInput = {
  to: string;
  displayName: string;
  verificationUrl: string;
};

export async function sendVerificationEmail(input: VerificationEmailInput) {
  if (!hasSmtpCredentials()) {
    console.info(`[auth] Email verification link for ${input.to}: ${input.verificationUrl}`);
    return {
      sent: false,
      reason: "smtp-not-configured" as const
    };
  }

  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPassword
    }
  });

  await transporter.sendMail({
    from: env.smtpFrom,
    to: input.to,
    subject: "Verify your Crowd Remix account",
    text: [
      `Hi ${input.displayName},`,
      "",
      "Verify your Crowd Remix account to finish setting up your DJ dashboard.",
      input.verificationUrl,
      "",
      "This link expires in 24 hours."
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111315;">
        <h1 style="font-size: 22px;">Verify your Crowd Remix account</h1>
        <p>Hi ${escapeHtml(input.displayName)},</p>
        <p>Verify your account to finish setting up your DJ dashboard.</p>
        <p>
          <a href="${input.verificationUrl}" style="display: inline-block; background: #111315; color: #ffffff; padding: 12px 18px; border-radius: 999px; text-decoration: none;">
            Verify Email
          </a>
        </p>
        <p style="font-size: 13px; color: #62615d;">This link expires in 24 hours.</p>
      </div>
    `
  });

  return {
    sent: true,
    reason: null
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
