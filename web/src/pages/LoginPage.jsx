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

  const handleGoToSignup = () => {
    navigate("/signup");
  };

  // If already logged in (we have a token), bounce to dashboard
  useEffect(() => {
    if (isLoggedIn()) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

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

    return (
    <div className="login-page" data-theme={theme}>
      <div className="login-center-wrapper">
        <div className="login-card login-card-centered">
          {/* Logo on top */}
          <div className="login-logo-wrapper">
            <img
              src={notablyLogo}
              alt="Notably"
              className="login-logo"
            />
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

          {/* Footer: link to signup */}
          <div className="login-signup-text">
            <span>Don&apos;t have an account?</span>
            <button
              type="button"
              onClick={handleGoToSignup}
              className="login-signup-btn"
            >
              Create account
            </button>
          </div>

          <p className="login-helper-text">
            Use the same email &amp; password you created in Supabase.
          </p>
        </div>
      </div>
    </div>
  );
}
