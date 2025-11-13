// web/src/SupabaseAuthTest.jsx
import React, { useState } from "react";
import { supabase } from "./lib/supabaseClient";

export default function SupabaseAuthTest() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [token, setToken] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setStatus("Logging in...");
    setToken("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("Supabase login error:", error);
      setStatus(`Error: ${error.message}`);
      return;
    }

    const session = data.session;
    const accessToken = session?.access_token;

    console.log("Supabase session:", session);
    setStatus("Logged in!");
    setToken(accessToken || "(no access token found)");
  };

  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Supabase Login Test</h1>
      <p style={{ marginBottom: "1rem" }}>
        Use the email & password of the user you just created in Supabase.
      </p>

      <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", padding: "0.4rem" }}
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%", padding: "0.4rem" }}
            required
          />
        </label>

        <button type="submit" style={{ padding: "0.5rem", marginTop: "0.5rem" }}>
          Log in
        </button>
      </form>

      {status && <p style={{ marginTop: "1rem" }}>{status}</p>}

      {token && (
        <div style={{ marginTop: "1rem" }}>
          <h2>Access token</h2>
          <textarea
            readOnly
            value={token}
            rows={6}
            style={{ width: "100%", fontSize: "0.75rem" }}
          />
        </div>
      )}
    </div>
  );
}
