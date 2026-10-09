import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, post, errorMessage, isUnauthorized } from "./api";
import type {
  Challenge,
  LoginResult,
  Movie,
  MoviePage,
} from "./api";
import Profile from "./Profile";

type Mode = "login" | "signup" | "phone" | "reset";
type Purpose = "signup" | "login" | "password-reset";

type Verification = Challenge & {
  purpose: Purpose;
};

const labels: Record<Mode, string> = {
  login: "Email login",
  signup: "Sign up",
  phone: "Phone login",
  reset: "Reset password",
};

export default function App() {
  // Keep the bearer token in memory, not persistent browser storage.
  const [session, setSession] = useState<LoginResult | null>(null);
  const [notice, setNotice] = useState("");

  function expired() {
    setSession(null);
    setNotice("Your session expired. Please sign in again.");
  }

  return (
    <div className="container">
      <header>
        <div>
          <h1>EngageIQ Movies</h1>
          <p>Find movies. Keep your favourites.</p>
        </div>
      </header>

      {session ? (
        <Dashboard
          session={session}
          onExpired={expired}
          onLogout={() => {
            setSession(null);
            setNotice("You have signed out.");
          }}
        />
      ) : (
        <Auth
          notice={notice}
          onLogin={(result) => {
            setSession(result);
            setNotice("");
          }}
        />
      )}
    </div>
  );
}

function Auth({
  onLogin,
  notice,
}: {
  onLogin: (result: LoginResult) => void;
  notice: string;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [challenge, setChallenge] = useState<Verification | null>(null);
  const [resetToken, setResetToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(notice);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setChallenge(null);
    setResetToken("");
    setError("");
    setMessage("");
  }

  function beginVerification(data: Challenge, purpose: Purpose) {
    setChallenge({ ...data, purpose });
    setCooldown(60);
    setMessage(
      data.delivery === "fake"
        ? "Development mode: no message was sent."
        : "If eligible, you can continue with your verification code.",
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");

    void run(async () => {
      if (resetToken) {
        await post("/auth/reset-password", {
          resetToken,
          password: value("password"),
        });
        setResetToken("");
        setMode("login");
        setMessage("Password updated. Sign in with your new password.");
        return;
      }

      if (challenge) {
        const body = {
          challengeId: challenge.challengeId,
          otp: value("otp"),
        };

        if (challenge.purpose === "signup") {
          await post("/auth/verify-phone", body);
          setChallenge(null);
          setMode("login");
          setMessage("Account created. You can now sign in.");
        } else if (challenge.purpose === "login") {
          onLogin(await post<LoginResult>("/auth/verify-login-otp", body));
        } else {
          const result = await post<{ resetToken: string }>(
            "/auth/verify-password-reset",
            body,
          );
          setChallenge(null);
          setResetToken(result.resetToken);
        }

        return;
      }

      if (mode === "login") {
        onLogin(
          await post<LoginResult>("/auth/login", {
            email: value("email"),
            password: value("password"),
          }),
        );
        return;
      }

      if (mode === "signup") {
        const result = await post<Challenge>("/auth/signup", {
          fullName: value("fullName"),
          email: value("email"),
          phone: value("phone"),
          password: value("password"),
        });
        beginVerification(result, "signup");
        return;
      }

      const purpose = mode === "phone" ? "login" : "password-reset";
      const endpoint =
        mode === "phone"
          ? "/auth/request-login-otp"
          : "/auth/request-password-reset";

      const result = await post<Challenge>(endpoint, {
        phone: value("phone"),
      });

      beginVerification(result, purpose);
    });
  }

  function resend() {
    if (!challenge) return;

    void run(async () => {
      const result = await post<Challenge>("/auth/resend-otp", {
        challengeId: challenge.challengeId,
        purpose: challenge.purpose,
      });

      beginVerification(result, challenge.purpose);
    });
  }

  const title = resetToken
    ? "Choose a new password"
    : challenge
      ? "Verify your phone"
      : labels[mode];

  return (
    <main className="panel auth">
      <nav aria-label="Authentication options">
        {(Object.keys(labels) as Mode[]).map((item) => (
          <button
            key={item}
            type="button"
            className={mode === item ? "selected" : "secondary"}
            disabled={busy}
            onClick={() => changeMode(item)}
          >
            {labels[item]}
          </button>
        ))}
      </nav>

      <h2>{title}</h2>

      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="message" role="status">{message}</p>}

      {challenge?.delivery === "fake" && (
        <p className="demo">
          <strong>Development OTP:</strong> {challenge.devOtp}
          <br />
          This is simulated delivery, not WhatsApp verification.
        </p>
      )}

      {challenge && (
        <p className="muted">
          Code expires at{" "}
          {new Date(challenge.otpExpiresAt).toLocaleTimeString()}.
        </p>
      )}

      <form
        key={resetToken ? "new-password" : challenge ? challenge.challengeId : mode}
        onSubmit={submit}
      >
        <fieldset disabled={busy}>
          {resetToken ? (
            <label>
              New password
              <input
                name="password"
                type="password"
                minLength={12}
                autoComplete="new-password"
                required
              />
              <small>At least 12 characters; at most 72 UTF-8 bytes.</small>
            </label>
          ) : challenge ? (
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
          ) : (
            <>
              {mode === "signup" && (
                <label>
                  Full name
                  <input
                    name="fullName"
                    autoComplete="name"
                    minLength={2}
                    maxLength={100}
                    required
                  />
                </label>
              )}

              {(mode === "login" || mode === "signup") && (
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                  />
                </label>
              )}

              {mode !== "login" && (
                <label>
                  Phone with country code
                  <input
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="+919876543210"
                    required
                  />
                </label>
              )}

              {(mode === "login" || mode === "signup") && (
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    minLength={mode === "signup" ? 12 : undefined}
                    autoComplete={
                      mode === "signup" ? "new-password" : "current-password"
                    }
                    required
                  />
                  {mode === "signup" && (
                    <small>At least 12 characters; at most 72 UTF-8 bytes.</small>
                  )}
                </label>
              )}
            </>
          )}

          <button type="submit">
            {busy
              ? "Please wait…"
              : resetToken
                ? "Update password"
                : challenge
                  ? "Verify code"
                  : mode === "login"
                    ? "Sign in"
                    : "Continue"}
          </button>
        </fieldset>
      </form>

      {challenge && (
        <button
          className="secondary"
          type="button"
          onClick={resend}
          disabled={busy || cooldown > 0}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </button>
      )}
    </main>
  );
}

function Dashboard({
  session,
  onExpired,
  onLogout,
}: {
  session: LoginResult;
  onExpired: () => void;
  onLogout: () => void;
}) {
  const [view, setView] = useState<"browse" | "saved">("browse");
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]);
  const [page, setPage] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  const token = session.accessToken;
  const cursor = cursors[page] ?? "";

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError("");
    setNextCursor(null);

    const timer = window.setTimeout(async () => {
      try {
        if (view === "browse" && query.trim().length === 1) {
          throw new Error("Enter at least two characters to search.");
        }

        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (cursor) params.set("cursor", cursor);

        const options = { signal: controller.signal };

        const [saved, result] = await Promise.all([
          api<{ movies: Movie[]; total: number }>(
            "/movies/saved",
            token,
            options,
          ),
          view === "browse"
            ? api<MoviePage>(`/movies?${params}`, token, options)
            : Promise.resolve(null),
        ]);

        if (!active) return;

        setSavedIds(new Set(saved.movies.map((movie) => movie.externalMovieId)));
        setMovies(result ? result.movies : saved.movies);
        setTotal(result ? result.total : saved.total);
        setNextCursor(result?.nextCursor ?? null);
      } catch (err) {
        if (!active) return;
        if (isUnauthorized(err)) {
          onExpired();
          return;
        }
        setError(errorMessage(err));
        setMovies([]);
      } finally {
        if (active) setLoading(false);
      }
    }, view === "browse" ? 350 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
    // onExpired is handled through the parent; fetch inputs are listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, cursor, view, refresh, token]);

  async function toggleSaved(movie: Movie) {
    setBusy(true);
    setError("");

    try {
      const id = movie.externalMovieId;
      const removing = savedIds.has(id);

      if (removing) {
        await api<void>(`/movies/saved/${encodeURIComponent(id)}`, token, {
          method: "DELETE",
        });
      } else {
        await post("/movies/saved", { externalMovieId: id }, token);
      }

      setSavedIds((previous) => {
        const updated = new Set(previous);
        if (removing) updated.delete(id);
        else updated.add(id);
        return updated;
      });

      if (view === "saved" && removing) {
        setMovies((previous) =>
          previous.filter((item) => item.externalMovieId !== id),
        );
        setTotal((previous) => Math.max(0, previous - 1));
      }
    } catch (err) {
      if (isUnauthorized(err)) onExpired();
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");

    try {
      await post("/auth/logout", {}, token);
      onLogout();
    } catch (err) {
      if (isUnauthorized(err)) onLogout();
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function changeView(next: "browse" | "saved") {
    setView(next);
    setPage(0);
    setCursors([""]);
  }

  return (
    <main>
      <div className="toolbar">
        <span>Hello, {session.user.fullName}</span>
        <button className="secondary" disabled={busy} onClick={logout}>
          Sign out
        </button>
      </div>
      <Profile
      user={session.user}
      onResetComplete={onLogout}
    />

      <nav aria-label="Movie navigation">
        <button
          className={view === "browse" ? "selected" : "secondary"}
          disabled={busy}
          onClick={() => changeView("browse")}
        >
          Browse movies
        </button>
        <button
          className={view === "saved" ? "selected" : "secondary"}
          disabled={busy}
          onClick={() => changeView("saved")}
        >
          Saved movies
        </button>
      </nav>

      {view === "browse" && (
        <label className="search">
          Search movies
          <input
            type="search"
            value={query}
            maxLength={100}
            placeholder="Search by title…"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
              setCursors([""]);
            }}
          />
        </label>
      )}

      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="secondary"
            disabled={loading || busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div aria-busy="true" aria-label="Loading movies">
          <p role="status">Loading movies…</p>
          <div className="grid">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="skeleton" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <p className="muted">{total.toLocaleString()} movies</p>

          {movies.length === 0 && !error && (
            <div className="panel">
              {view === "saved"
                ? "No saved movies yet. Browse movies and save one."
                : "No movies found. Try another title."}
            </div>
          )}

          <div className="grid">
            {movies.map((movie) => (
              <article className="movie" key={movie.externalMovieId}>
                <Poster movie={movie} />
                <div className="movie-body">
                  <h3>{movie.title}</h3>
                  <p className="muted">
                    {movie.publishedYear ?? "Year unknown"} · Rating:{" "}
                    {movie.imdbRating ?? "N/A"}
                  </p>
                  <button
                    disabled={busy}
                    className={
                      savedIds.has(movie.externalMovieId) ? "secondary" : ""
                    }
                    onClick={() => toggleSaved(movie)}
                  >
                    {savedIds.has(movie.externalMovieId)
                      ? "Remove from saved"
                      : "Save movie"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {view === "browse" && (
        <div className="pagination">
          <button
            className="secondary"
            disabled={page === 0 || loading || busy}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <span>Page {page + 1}</span>
          <button
            disabled={!nextCursor || loading || busy}
            onClick={() => {
              if (!nextCursor) return;
              setCursors((previous) => [
                ...previous.slice(0, page + 1),
                nextCursor,
              ]);
              setPage((value) => value + 1);
            }}
          >
            Next
          </button>
        </div>
      )}
    </main>
  );
}

function Poster({ movie }: { movie: Movie }) {
  const [failed, setFailed] = useState(false);

  if (!movie.poster || failed) {
    return <div className="poster placeholder">No poster available</div>;
  }

  return (
    <img
      className="poster"
      src={movie.poster}
      alt={`${movie.title} poster`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}