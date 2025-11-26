// web/src/pages/LoginPage.jsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../contexts/ThemeContext";
import { supabase } from "../lib/supabaseClient";
import { setAccessToken, isLoggedIn } from "../lib/authToken";
import notablyLogo from "../assets/notably logo.png";
import "./LoginPage.css"; // shared styles with Signup

export default function LoginPage() {
  const navigate = useNavigate();
  const { theme } = useTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  // Forgot password state
  const [resetStatus, setResetStatus] = useState("idle"); // "idle" | "sending" | "sent" | "error"
  const [resetMessage, setResetMessage] = useState("");
  const [resetError, setResetError] = useState("");

  const handleGoToSignup = () => {
    navigate("/signup");
  };

  // If already logged in (we have a token), bounce to dashboard
  useEffect(() => {
    if (isLoggedIn()) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  // Clear reset messages when the email changes
  useEffect(() => {
    if (!email) {
      setResetStatus("idle");
      setResetMessage("");
      setResetError("");
    }
  }, [email]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus("");
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("Supabase login error:", error);
      setStatus(error.message || "Login failed");
      setLoading(false);
      return;
    }

    const session = data.session;
    const accessToken = session?.access_token;

    if (!accessToken) {
      setStatus("No access token returned from Supabase.");
      setLoading(false);
      return;
    }

    // Save the token for backend API use
    setAccessToken(accessToken);

    setStatus("Logged in!");
    setLoading(false);

    // Go to dashboard
    navigate("/dashboard", { replace: true });
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault(); // prevents the form from submitting if this is inside the <form>

    if (!email || !email.trim()) {
      setResetStatus("error");
      setResetError("Please enter your email above first.");
      setResetMessage("");
      return;
    }

    setResetStatus("sending");
    setResetError("");
    setResetMessage("");

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          // For now, send them back to an /update-password route we’ll build next
          redirectTo: `${window.location.origin}/update-password`,
        }
      );

      if (error) throw error;

      setResetStatus("sent");
      setResetMessage(
        "If an account exists for that email, we've sent a password reset link."
      );
    } catch (err) {
      console.error("resetPasswordForEmail error:", err);
      setResetStatus("error");
      setResetError(
        err?.message || "Unable to send reset email. Please try again."
      );
    }
  };

  return (
    <div className="login-page" data-theme={theme}>
      <div className="login-center-wrapper">
        <div className="login-card login-card-centered">
          {/* Logo on top */}
          <div className="login-logo-wrapper">
            <img src={notablyLogo} alt="Notably" className="login-logo" />
          </div>

          {/* Title + slogan */}
          <h1 className="login-title">Sign in to Notably</h1>
          <p className="login-slogan login-slogan-center">
            Turn your meetings into action in minutes.
          </p>

          {/* Status / error */}
          {status && (
            <p
              style={{
                color: "#ff8080",
                marginBottom: "1rem",
                fontSize: "0.85rem",
                textAlign: "center",
              }}
            >
              {status}
            </p>
          )}

          {/* Form */}
          <form className="login-form" onSubmit={handleSubmit}>
            <div>
              <input
                className="login-input"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setStatus("");
                }}
                autoComplete="email"
                required
              />
            </div>

            <div>
              <input
                className="login-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setStatus("");
                }}
                autoComplete="current-password"
                required
              />
            </div>

            <button
              type="submit"
              className="login-signin-btn"
              disabled={loading}
            >
              {loading ? "SIGNING IN..." : "SIGN IN"}
            </button>
          </form>

          {/* Forgot password */}
          <div
            style={{
              marginTop: "0.75rem",
              textAlign: "center",
            }}
          >
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={resetStatus === "sending"}
              style={{
                padding: 0,
                border: "none",
                background: "transparent",
                color: "#16a34a",
                fontSize: "0.85rem",
                cursor: resetStatus === "sending" ? "default" : "pointer",
                textDecoration: "underline",
                textUnderlineOffset: "2px",
              }}
            >
              {resetStatus === "sending"
                ? "Sending reset email…"
                : "Forgot your password?"}
            </button>

            {resetStatus === "sent" && resetMessage && (
              <p
                style={{
                  marginTop: "0.35rem",
                  fontSize: "0.8rem",
                  color: "#16a34a",
                }}
              >
                {resetMessage}
              </p>
            )}

            {resetStatus === "error" && resetError && (
              <p
                style={{
                  marginTop: "0.35rem",
                  fontSize: "0.8rem",
                  color: "#b91c1c",
                }}
              >
                {resetError}
              </p>
            )}
          </div>


          {/* Footer: link to signup */}
          <div className="login-signup-text" style={{ marginTop: "1.25rem" }}>
            <span>Don&apos;t have an account?</span>
            <button
              type="button"
              onClick={handleGoToSignup}
              className="login-signup-btn"
            >
              Create account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

