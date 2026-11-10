---
name: BWE-AUTH
description: Explains and drives the Business Web Express sign-in page at /auth (Client Portal and Backoffice): the password form, the Backoffice 6-digit code option, the authenticator step, errors and recovery. Use when the user says "sign in at /auth", "log in to the portal", "log in to the backoffice", or invokes /BWE-AUTH.
---

# BWE-AUTH

How the sign-in page at `https://businesswebexpress.com/auth` works, and how to get through it in a browser session. The page is `src/routes/auth.tsx` in the BWE repository; check that file if the page seems to have changed.

> **Credentials:** the owner types their own email, password and codes. Never ask for them in chat, never store, log, screenshot or write them into a file, and never put them in a commit or PR. If the browser has no saved sign-in, stop and tell the owner to sign in themselves and then say when to continue.

## Which sign-in you get
- **Client Portal** (`/auth`): heading "Client Portal". Customers use it. Ends in `/portal`.
- **Backoffice** (`/owner`, or `/auth?next=/admin...`): heading "Backoffice". Admin only. Ends in `/admin`.
- `?next=/some/path` sends the user to that same-site path after sign-in. Anything that is not a relative path on this site is ignored.
- The page is `noindex`. Staging uses the same page on the staging host; use staging first unless the owner says production.

## Steps
1. **Password form (both):** fields Email and Password (the "Show" button reveals the password), a "Remember my email" checkbox (only the email is remembered, never the password), then "Sign in". Links: "Forgot your password?" (goes to `/forgot-password`) and "← Back to site" (the home page).
2. **Client Portal only:** under the form, "Need access? Our team creates your portal account and sends you an invitation." with a "Contact our team" button. It opens a "Send us an email" dialog (their email, subject, message). There is no self sign-up. Do not send that message for the owner without being asked.
3. **Backoffice only:** the link "Sign in with my 6-digit code" swaps the form for Email plus a "6-digit code" box (the code the admin set in Account settings). "Sign in" stays disabled until six digits are entered. "Use my password instead" goes back.
4. **Authenticator step:** if the account has two-factor sign-in, a code challenge appears after the password or the 6-digit code is accepted. Cancelling signs the user out and returns to the form. The owner reads the code from their authenticator app.
5. **Done:** the page redirects to `next` if given, else `/portal` (Backoffice: `/admin`). A user who is already signed in is forwarded straight away.

## Driving it in a browser
- Open the page with the browser tools, take one screenshot to confirm the heading (Client Portal or Backoffice) matches what the owner wanted.
- Let the owner enter the secrets. Wait for them, then check the URL changed to `/portal` or `/admin`.
- Reading the page text is enough to confirm state; do not read the password box.

## Errors
- A wrong password and an unknown email show the same message on purpose: "We couldn't sign you in. Check your email and password and try again." Do not try to tell which one it was.
- Messages about too many attempts or a lockout are real: stop, do not retry in a loop, and tell the owner to wait or use "Forgot your password?".
- A bad 6-digit code says "That code didn't work." Offer "Use my password instead".

## Do not
- Do not try other passwords, guess codes, or retry after a lockout.
- Do not use the support override that lets an admin password open a customer's portal unless the owner explicitly asks for it and supplies the password themselves.
- Do not change the page, the Supabase auth settings or any account from this skill; it only explains and walks through sign-in.
