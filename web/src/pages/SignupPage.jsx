// web/src/pages/SignupPage.jsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../contexts/ThemeContext";
import { supabase } from "../lib/supabaseClient";
import { setAccessToken, isLoggedIn } from "../lib/authToken";
import notablyLogo from "../assets/notably logo.png";
import "./LoginPage.css";

export default function SignupPage() {
  const navigate = useNavigate();
  const { theme } = useTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  // If already logged in, bounce to dashboard
  useEffect(() => {
    if (isLoggedIn()) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  const handleGoToLogin = () => {
    navigate("/login");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus("");

    if (!email.trim() || !password.trim()) {
      setStatus("Please enter an email and password.");
      return;
    }

    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      console.error("Supabase signup error:", error);
      setStatus(error.message || "Sign up failed.");
      setLoading(false);
      return;
    }

    const session = data.session;
    const accessToken = session?.access_token;

    if (accessToken) {
      // If email confirmation is disabled, Supabase will give us a session
      setAccessToken(accessToken);
      setStatus("Account created! Redirecting…");
      setLoading(false);
      navigate("/dashboard", { replace: true });
    } else {
      // If email confirmation is enabled, no session yet
      setStatus(
        "Account created! Check your email to confirm, then sign in."
      );
      setLoading(false);
    }
  };

  return (
    <div className="login-page" data-theme={theme}>
      <div className="login-center-wrapper">
        <div className="login-card login-card-centered">
          {/* Logo */}
          <div className="login-logo-wrapper">
            <img
              src={notablyLogo}
              alt="Notably"
              className="login-logo"
            />
          </div>

          {/* Title + slogan */}
          <h1 className="login-title">Create your Notably account</h1>
          <p className="login-slogan login-slogan-center">
            Sign up to turn your meetings into searchable, actionable notes.
          </p>

          {/* Status / error */}
          {status && (
            <p
              style={{
                color: status.startsWith("Account created")
                  ? "#4ade80"
                  : "#ff8080",
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
                onChange={(e) => setEmail(e.target.value)}
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
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <div>
              <input
                className="login-input"
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <button
              type="submit"
              className="login-signin-btn"
              disabled={loading}
            >
              {loading ? "CREATING…" : "CREATE ACCOUNT"}
            </button>
          </form>

          {/* Footer: link to login */}
          <div className="login-signup-text">
            <span>Already have an account?</span>
            <button
              type="button"
              onClick={handleGoToLogin}
              className="login-signup-btn"
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
