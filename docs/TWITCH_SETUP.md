# Twitch story mode

The host chooses **Twitch mode**, connects the Twitch account that owns their channel, enters the beginning of the story, chooses clip length and resolution, and starts the show. Viewers contribute with `!next A doorway appears in the clouds.` in that channel's chat. The text after `!next` answers **What happens next?** and enters the same moderation, selection, and video generation queue as the QR form.

Ordinary chat does not trigger generations. Messages from other channels in a shared-chat session are ignored. If the host has multiple live Twitch stories, new messages go to the most recently started matching story. Each received message is attached to that story immediately, so a delayed message cannot accidentally become part of a later story. Stories in QR mode continue to use the web form.

## One-time platform setup

1. Register a **Confidential** application in the [Twitch Developer Console](https://dev.twitch.tv/console/apps). Use the platform's permanent public HTTPS domain. Add the exact OAuth redirect URL `https://YOUR_DOMAIN/api/twitch/callback`. Register a separate app for a separate staging environment. Twitch explains the registration and client-secret steps in its [app registration guide](https://dev.twitch.tv/docs/authentication/register-app/).
2. Add these server environment variables to the production deployment. Do not put secrets in `NEXT_PUBLIC_*` variables or source files.

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_APP_URL` | `https://YOUR_DOMAIN` |
   | `TWITCH_CLIENT_ID` | The registered app's client ID |
   | `TWITCH_CLIENT_SECRET` | The app's client secret |
   | `TWITCH_EVENTSUB_SECRET` | A random 64-character hex string |
   | `TWITCH_TOKEN_ENCRYPTION_KEY` | A separate random 32-byte key, encoded as base64 |
   | `TWITCH_REDIRECT_URI` | Optional; defaults to the app URL plus `/api/twitch/callback`; must exactly match the registered URL and use the same origin as the app |
   | `CRON_SECRET` | A separate random secret that protects the recovery endpoint |

3. Apply the Prisma migration and deploy. The public webhook endpoint is `https://YOUR_DOMAIN/api/twitch/webhook`. It must accept Twitch requests without a login page or deployment-protection challenge. The application registers the subscription automatically when a host connects; there is no webhook URL to paste into the Twitch console.
4. Verify the recovery and token-validation schedule after deploying. The repository's [`vercel.json`](../vercel.json) schedules `/api/twitch/process` every minute on production deployments. Set `CRON_SECRET` so Vercel attaches `Authorization: Bearer <CRON_SECRET>` to each request. **This minute schedule requires Vercel Pro or Enterprise**; Hobby will reject it at deployment. For Hobby, remove the `crons` entry before deploying and use an external scheduler to call the same endpoint every minute with that authorization header. Use the same external-scheduler approach on other hosts. The schedule supports reliable retries and Twitch's hourly token-validation requirement even while no dashboard is open. [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [securing cron requests](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
5. Open the new-story page, select Twitch mode, and connect the broadcaster's Twitch account. Wait for the connection to finish verification, then start a story and submit one `!next` message from another Twitch account. Confirm it appears in the story queue and produces a continuation. Repeat the webhook delivery in a test environment to verify that it cannot create a second submission.

For local integration testing, use a public HTTPS tunnel, configure the app URL to that tunnel, register its callback URL in a development Twitch app, and access Dream Sequence through the tunnel URL so the login and OAuth state cookies share an origin.

## How authorization works

The application uses Twitch's [Authorization Code Grant](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow). A signed, expiring state value is bound to the logged-in Dream Sequence user and a secure HttpOnly browser cookie. The server exchanges the code, validates its app and user identity, and stores the access and refresh tokens with AES-256-GCM encryption, bound to that account.

This implementation uses the broadcaster's account as the reading identity and requests `user:read:chat`, `user:bot`, and `channel:bot`. The latter two scopes authorize app-token chat subscriptions. It does not request `user:write:chat` and does not post chat messages. A separate bot account is unnecessary for this initial read-only flow. These choices follow the authorization conditions for [channel.chat.message](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage).

The server obtains an app access token and subscribes to `channel.chat.message` version 1 over EventSub webhooks. This suits a serverless deployment because the platform does not need a continuously running WebSocket or IRC connection. Twitch recommends webhook transport for [cloud chatbot integrations](https://dev.twitch.tv/docs/chat/authenticating/).

The webhook checks Twitch's HMAC signature against the exact request bytes, checks timestamp freshness, verifies the channel and subscription, and persists an inbox receipt before returning. Processing runs after the response. Unique delivery IDs, per-event processing leases, and unique Twitch chat-message submission IDs prevent duplicate processing. Pending work retries through subsequent webhook invocations, live-story reconciliation, and the recovery schedule. The last route also validates stored grants before an hour has passed and refreshes expired tokens; see [Twitch token validation](https://dev.twitch.tv/docs/authentication/validate-tokens/) and [refreshing tokens](https://dev.twitch.tv/docs/authentication/refresh-tokens/).

## Operating the integration

- **Disconnected or not configured:** Twitch mode stays unavailable until the deployment has its credentials and the host's subscription is verified. QR mode remains usable.
- **Connection remains pending:** Check that both URLs use the public production origin, that the webhook bypasses deployment protection, and that the app has the exact redirect URI. The setup screen polls until Twitch reports the subscription enabled. Reconnect after correcting the configuration.
- **No chat ideas arrive:** Use `!next` followed by an idea in the connected channel. The story must be live in Twitch mode. Check subscription status and the signed webhook route's deployment logs; then inspect `TwitchEventDelivery` for pending or failed work. Commands are ideas submitted for selection, so acceptance does not guarantee every message generates a clip.
- **Revoked permissions:** A signed Twitch revocation clears local credentials and disables chat intake. The host can reconnect from setup. Token validation also detects revoked access if the notification is missed.
- **Disconnect:** The setup action immediately removes local credentials, stops intake, and discards pending messages. It also attempts to revoke the token and delete the remote subscription. If Twitch is unavailable, the screen asks the host to remove the app in [Twitch Settings → Connections](https://www.twitch.tv/settings/connections).
- **Retries and retention:** Transient processing failures retry up to five attempts, with a short backoff. A failed record remains available for operator investigation; after resolving the cause it can be reset to pending with attempts zero. Successful/discarded inbox payloads are cleared immediately, and terminal receipt IDs are pruned after 24 hours. The accepted story submission remains part of the story's normal history.
- **Changing encryption keys:** Existing tokens require the key that encrypted them. To rotate the key with this implementation, disconnect/reconnect the affected channels; do not simply replace the key while expecting existing connections to keep working.

The automated tests cover OAuth state and identity checks, token encryption and refresh, connection/disconnection, signed challenges and revocations, stale/forged events, duplicate deliveries, channel/story routing, processing leases, and retry behavior. A real Twitch OAuth/chat smoke test still requires the platform owner's registered client ID, client secret, and public deployment; none are supplied by the fal video key.
