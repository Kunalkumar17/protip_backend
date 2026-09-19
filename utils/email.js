import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendVerificationEmail(email, verificationUrl) {
  const { data, error } = await resend.emails.send({
    from: "ProTip <noreply@protip.online>",
    to: [email],
    subject: "Verify your ProTip account",
    html: `
      <h2>Welcome to ProTip!</h2>

      <p>Thanks for creating your account.</p>

      <p>Click the button below to verify your email:</p>

      <a
        href="${verificationUrl}"
        style="
          display:inline-block;
          padding:12px 20px;
          background:#000;
          color:#fff;
          text-decoration:none;
          border-radius:6px;
        "
      >
        Verify Email
      </a>

      <p>This link expires in 30 minutes.</p>
    `,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}