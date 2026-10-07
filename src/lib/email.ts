import { Resend } from 'resend'
import { getBrand } from '@/lib/brand'

let resendInstance: Resend | null = null

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.warn('[email] RESEND_API_KEY not configured — emails will be skipped')
    return null
  }
  if (!resendInstance) {
    resendInstance = new Resend(key)
  }
  return resendInstance
}

function getAppUrl(): string {
  return getBrand().appUrl
}

function getLogoUrl(): string {
  // PNG: SVG does not render in Gmail/Outlook.
  return process.env.EMAIL_LOGO_URL?.trim() || `${getBrand().appUrl}/brand/logo.png`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Layout matches the dashboard's pattern so
// recipients see consistent branding across products.
function emailLayout(content: string): string {
  const brand = getBrand()
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0A0A;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td align="center" style="padding-bottom:32px;">
          <a href="${getAppUrl()}" style="text-decoration:none;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:middle;"><img src="${escapeHtml(getLogoUrl())}" alt="${escapeHtml(brand.name)}" width="40" height="40" style="display:block;border:0;" /></td>
              <td style="vertical-align:middle;padding-left:10px;"><span style="font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">${escapeHtml(brand.name.toUpperCase())}</span></td>
            </tr></table>
          </a>
        </td></tr>
        <tr><td style="background:linear-gradient(135deg,rgba(255,255,255,0.05) 0%,rgba(255,255,255,0.02) 100%);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px 32px;">
          ${content}
        </td></tr>
        <tr><td style="padding:24px 0;"><div style="height:1px;background:linear-gradient(to right,transparent,rgba(16,185,129,0.3),transparent);"></div></td></tr>
        <tr><td align="center" style="padding:0 0 16px;">
          <p style="margin:0;font-size:12px;color:#6B7280;line-height:1.5;">&copy; ${new Date().getFullYear()} ${escapeHtml(brand.name)} &mdash; AI-powered cannabis intelligence</p>
          <p style="margin:8px 0 0;font-size:12px;"><a href="${escapeHtml(brand.appUrl)}" style="color:#10B981;text-decoration:none;">${escapeHtml(brand.appUrl.replace(/^https?:\/\//, ''))}</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

export interface SendDomainVerificationEmailParams {
  to: string
  domain: string
  organizationName: string
  verifyUrl: string
}

export async function sendDomainVerificationEmail({
  to,
  domain,
  organizationName,
  verifyUrl,
}: SendDomainVerificationEmailParams): Promise<boolean> {
  const resend = getResend()
  if (!resend) return false

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">
      Verify your domain
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#9CA3AF;line-height:1.6;">
      Confirm that <strong style="color:#ffffff;">${escapeHtml(domain)}</strong> belongs to <strong style="color:#ffffff;">${escapeHtml(organizationName)}</strong>. After verification, anyone signing in with an <code style="background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:4px;color:#34D399;">@${escapeHtml(domain)}</code> email will join the org automatically as a member instead of getting a personal account.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td align="center">
        <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#059669,#10B981);color:#ffffff;padding:14px 32px;border-radius:9999px;text-decoration:none;font-size:15px;font-weight:600;letter-spacing:0.2px;">
          Verify Domain
        </a>
      </td></tr>
    </table>
    <p style="margin:28px 0 0;font-size:13px;color:#6B7280;line-height:1.5;">
      This link expires in 24 hours. If the button doesn't work, copy and paste:
    </p>
    <p style="margin:8px 0 0;font-size:12px;color:#4B5563;word-break:break-all;background:rgba(255,255,255,0.03);padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);">
      ${verifyUrl}
    </p>
    <p style="margin:24px 0 0;font-size:12px;color:#4B5563;">
      If you didn't request this, you can safely ignore this email.
    </p>`

  try {
    await resend.emails.send({
      from: getBrand().emailFrom,
      to,
      subject: `Verify ${domain} for ${organizationName}`,
      html: emailLayout(content),
    })
    console.log(`[email] Domain verification sent to ${to} for ${domain} -> ${organizationName}`)
    return true
  } catch (error) {
    console.error('[email] Failed to send domain verification email:', error)
    return false
  }
}
