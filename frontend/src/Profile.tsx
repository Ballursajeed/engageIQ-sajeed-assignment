import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { post, errorMessage } from "./api";
import type { Challenge, User } from "./api";

type Props = {
  user: User;
  onResetComplete: () => void;
};

export default function Profile({ user, onResetComplete }: Props) {
  const [open, setOpen] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [resetToken, setResetToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = window.setTimeout(
      () => setCooldown((value) => value - 1),
      1000,
    );

    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");

    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function sendCode() {
    void run(async () => {
      const result = challenge
        ? await post<Challenge>("/auth/resend-otp", {
            challengeId: challenge.challengeId,
            purpose: "password-reset",
          })
        : await post<Challenge>("/auth/request-password-reset", {
            phone: user.phone,
          });

      setChallenge(result);
      setCooldown(60);
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    void run(async () => {
      if (resetToken) {
        const password = String(form.get("password") ?? "");
        const confirmation = String(form.get("confirmation") ?? "");

        if (password !== confirmation) {
          throw new Error("Passwords do not match");
        }

        await post("/auth/reset-password", {
          resetToken,
          password,
        });

        // The backend has revoked all existing sessions.
        onResetComplete();
        return;
      }

      if (!challenge) return;

      const result = await post<{ resetToken: string }>(
        "/auth/verify-password-reset",
        {
          challengeId: challenge.challengeId,
          otp: String(form.get("otp") ?? ""),
        },
      );

      setResetToken(result.resetToken);
      setChallenge(null);
    });
  }

  return (
    <section className="panel profile">
      <h2>Your profile</h2>

      <dl>
        <dt>Name</dt>
        <dd>{user.fullName}</dd>

        <dt>Email</dt>
        <dd>{user.email}</dd>

        <dt>Phone</dt>
        <dd>{user.phone}</dd>
      </dl>

      <button
        type="button"
        className="secondary"
        disabled={busy}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide password reset" : "Reset password"}
      </button>

      {open && (
        <div className="profile-reset">
          <p>
            Verify your registered phone, then choose a new password.
            You will need to sign in again afterward.
          </p>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {!challenge && !resetToken && (
            <button disabled={busy} onClick={sendCode}>
              {busy ? "Please wait…" : "Request verification code"}
            </button>
          )}

          {challenge && (
            <>
              {challenge.delivery === "fake" ? (
                <p className="demo">
                  <strong>Development OTP: {challenge.devOtp}</strong>
                  <br />
                  Simulated delivery. No WhatsApp message was sent.
                </p>
              ) : (
                <p className="message">
                  If eligible, verification can continue on your registered phone.
                </p>
              )}

              <p className="muted">
                Expires at{" "}
                {new Date(challenge.otpExpiresAt).toLocaleTimeString()}.
              </p>
            </>
          )}

          {(challenge || resetToken) && (
            <form
              key={resetToken ? "password" : challenge?.challengeId}
              onSubmit={submit}
            >
              <fieldset disabled={busy}>
                {resetToken ? (
                  <>
                    <label>
                      New password
                      <input
                        name="password"
                        type="password"
                        minLength={12}
                        autoComplete="new-password"
                        required
                      />
                      <small>
                        At least 12 characters; at most 72 UTF-8 bytes.
                      </small>
                    </label>

                    <label>
                      Confirm new password
                      <input
                        name="confirmation"
                        type="password"
                        minLength={12}
                        autoComplete="new-password"
                        required
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    Six-digit code
                    <input
                      name="otp"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      autoComplete="one-time-code"
                      required
                    />
                  </label>
                )}

                <button type="submit">
                  {busy
                    ? "Please wait…"
                    : resetToken
                      ? "Update password"
                      : "Verify code"}
                </button>
              </fieldset>
            </form>
          )}

          {challenge && (
            <button
              type="button"
              className="secondary"
              disabled={busy || cooldown > 0}
              onClick={sendCode}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}