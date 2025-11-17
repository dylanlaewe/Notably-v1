// web/src/pages/SignupPage.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../contexts/ThemeContext";
import { supabase } from "../lib/supabaseClient";
import { setAccessToken } from "../lib/authToken";
import notablyLogo from "../assets/notably logo.png";
import "./LoginPage.css"; // reuse EXACT same styles as login

function SignupPage() {
  const navigate = useNavigate();
  const { theme } = useTheme();

  // Form state
  const [fullName, setFullName] = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");

  // Default profile settings for new accounts (used by Settings page)
  const createDefaultProfile = (userData) => {
    const defaultProfile = {
      fullName: userData.fullName,
      email: userData.email,
      memberSince: new Date().toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      }),
      totalNotes: "0",
      storageUsed: "0 MB / 10 GB",
      preferences: {
        language: "English",
        notifications: true,
        theme: theme || "dark",
      },
      accountSettings: {
        emailNotifications: true,
        twoFactorAuth: false,
        dataBackup: true,
      },
    };

    localStorage.setItem("notably-profile", JSON.stringify(defaultProfile));
    localStorage.setItem(
      "notably-preferences",
      JSON.stringify(defaultProfile.preferences)
    );

    return defaultProfile;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!fullName || !email || !password || !confirmPassword) {
      setError("Please fill in all fields.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
      const trimmedEmail = email.trim().toLowerCase();
      const trimmedName  = fullName.trim();

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: {
            full_name: trimmedName,
          },
        },
      });

      if (signUpError) {
        console.error("Supabase sign-up error:", signUpError);
        setError(
          signUpError.message || "Error creating account. Please try again."
        );
        return;
      }

      createDefaultProfile({
        fullName: trimmedName,
        email: trimmedEmail,
      });

      // If email confirmation is disabled, Supabase returns a session
      if (data?.session?.access_token) {
        setAccessToken(data.session.access_token);
        navigate("/dashboard", { replace: true });
        return;
      }

      // Otherwise email confirmation is required
      setSuccess(
        "Account created! Check your inbox to confirm your email, then log in with your new credentials."
      );
    } catch (err) {
      console.error("Account creation error:", err);
      setError("Error creating account. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const goToLogin = () => {
    navigate("/login");
  };

  return (
    <div className="login-page" data-theme={theme}>
      <div className="login-center-wrapper">
        <div className="login-content">
          {/* Branding section — EXACTLY like login, using the Notably logo */}
          <div className="login-branding">
            <div className="login-logo-section">
              <img
                src={notablyLogo}
                alt="Notably"
                className="login-logo"
              />
            </div>
            {/* Optional: same slogan text as login, or tweak copy */}
            <p className="login-slogan">
              Turn your meetings into action in minutes.
            </p>
          </div>

          {/* Main card – same layout & styles as login */}
          <div className="login-card">
            <h1 className="login-title">Create your account</h1>

            {/* Status message area */}
            {(error || success) && (
              <p
                style={{
                  color: error ? "#ff8080" : "#00FF88",
                  marginBottom: "24px",
                  fontSize: "14px",
                }}
              >
                {error || success}
              </p>
            )}

            <form className="login-form" onSubmit={handleSubmit}>
              {/* Full name */}
              <div>
                <input
                  className="login-input"
                  type="text"
                  placeholder="Full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </div>

              {/* Email */}
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

              {/* Password */}
              <div>
                <input
                  className="login-input"
                  type="password"
                  placeholder="Password (min 6 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>

              {/* Confirm password */}
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

              {/* Sign up button – same style as login-signin-btn */}
              <button
                type="submit"
                className="login-signin-btn"
                disabled={loading}
              >
                {loading ? "CREATING ACCOUNT..." : "CREATE ACCOUNT"}
              </button>
            </form>

            {/* Link back to login – same area as signup link on login page */}
            <div className="login-signup-link">
              <span className="login-signup-text">
                Already have an account?{" "}
              </span>
              <button
                type="button"
                onClick={goToLogin}
                className="login-signup-btn"
              >
                Sign in
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SignupPage;



