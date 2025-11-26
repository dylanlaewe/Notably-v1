// web/src/pages/UpdatePasswordPage.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../contexts/ThemeContext";
import { supabase } from "../lib/supabaseClient";
import notablyLogo from "../assets/notably logo.png";
import "./LoginPage.css"; // reuse login/signup styles

export default function UpdatePasswordPage() {
  const navigate = useNavigate();
  const { theme } = useTheme();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState(""); // success message
  const [error, setError] = useState("");   // error message
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus("");
    setError("");

    if (!newPassword || !confirmPassword) {
      setError("Please fill in both password fields.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const { data, error: supabaseError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (supabaseError) {
        console.error("updateUser error:", supabaseError);
        setError(
          supabaseError.message ||
            "Unable to update password. Your reset link may have expired."
        );
        setLoading(false);
        return;
      }

      console.log("Password updated for user:", data?.user?.id);
      setStatus("Your password has been updated. You can now sign in.");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      console.error("Unexpected error updating password:", err);
      setError("Unexpected error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoToLogin = () => {
    navigate("/login");
  };

  return (
    <div className="login-page" data-theme={theme}>
      <div className="login-center-wrapper">
        <div className="login-card login-card-centered">
          {/* Logo */}
          <div className="login-logo-wrapper">
            <img src={notablyLogo} alt="Notably" className="login-logo" />
          </div>

          <h1 className="login-title">Reset your password</h1>
          <p className="login-slogan login-slogan-center">
            Enter a new password to finish resetting your account.
          </p>

          {/* Error / success messages */}
          {error && (
            <p
              style={{
                color: "#ff8080",
                marginBottom: "1rem",
                fontSize: "0.85rem",
                textAlign: "center",
              }}
            >
              {error}
            </p>
          )}

          {status && (
            <p
              style={{
                color: "#16a34a",
                marginBottom: "1rem",
                fontSize: "0.85rem",
                textAlign: "center",
              }}
            >
              {status}
            </p>
          )}

          <form className="login-form" onSubmit={handleSubmit}>
            <div>
              <input
                className="login-input"
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError("");
                  setStatus("");
                }}
                autoComplete="new-password"
                required
              />
            </div>

            <div>
              <input
                className="login-input"
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError("");
                  setStatus("");
                }}
                autoComplete="new-password"
                required
              />
            </div>

            <button
              type="submit"
              className="login-signin-btn"
              disabled={loading}
            >
              {loading ? "UPDATING..." : "UPDATE PASSWORD"}
            </button>
          </form>

          <div
            style={{
              marginTop: "1.25rem",
              textAlign: "center",
              fontSize: "0.85rem",
            }}
          >
            <button
              type="button"
              onClick={handleGoToLogin}
              style={{
                border: "none",
                background: "transparent",
                color: "#16a34a",
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: "2px",
              }}
            >
              Back to login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
