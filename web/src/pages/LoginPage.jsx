// web/src/pages/LoginPage.jsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { setAccessToken, isLoggedIn } from "../lib/authToken";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        background: "#0f172a",
        color: "#f9fafb",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          padding: "2rem",
          borderRadius: "1rem",
          background: "rgba(15, 23, 42, 0.9)",
          boxShadow: "0 20px 45px rgba(15, 23, 42, 0.6)",
        }}
      >
        <h1 style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>Notably</h1>
        <p style={{ marginBottom: "1.5rem", color: "#cbd5f5" }}>
          Sign in to see your meetings and uploads.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <label style={{ fontSize: "0.9rem" }}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                marginTop: "0.25rem",
                width: "100%",
                padding: "0.6rem 0.75rem",
                borderRadius: "0.5rem",
                border: "1px solid #1f2937",
                background: "#020617",
                color: "#f9fafb",
              }}
            />
          </label>

          <label style={{ fontSize: "0.9rem" }}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                marginTop: "0.25rem",
                width: "100%",
                padding: "0.6rem 0.75rem",
                borderRadius: "0.5rem",
                border: "1px solid #1f2937",
                background: "#020617",
                color: "#f9fafb",
              }}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: "0.75rem",
              padding: "0.7rem 0.75rem",
              borderRadius: "0.5rem",
              border: "none",
              cursor: loading ? "default" : "pointer",
              background: loading ? "#1e293b" : "#4f46e5",
              color: "#f9fafb",
              fontWeight: 500,
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {status && (
          <p style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: "#f97373" }}>
            {status}
          </p>
        )}

        <p style={{ marginTop: "1.5rem", fontSize: "0.8rem", color: "#64748b" }}>
          Use the same email & password you created in Supabase.
        </p>
      </div>
    </div>
  );
}
