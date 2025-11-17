import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../contexts/ThemeContext";
import { apiFetch } from "../lib/apiClient";
import { clearAccessToken } from "../lib/authToken";
import { supabase } from "../lib/supabaseClient";
import "./SettingsPage.css";

const STORAGE_PROFILE_KEY = "notably-profile";
const STORAGE_PREFS_KEY = "notably-preferences";

const SettingsPage = () => {
  const navigate = useNavigate();
  const { theme, setLightTheme, setDarkTheme, isLight, isDark } = useTheme();

  const [status, setStatus] = useState("loading"); // "loading" | "ok" | "error"
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState("general"); // "general" | "preferences"

  // Local profile display (name is local-only, email comes from auth)
  const [profileData, setProfileData] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_PROFILE_KEY);
      return saved
        ? JSON.parse(saved)
        : {
            fullName: "",
            email: "",
          };
    } catch {
      return {
        fullName: "",
        email: "",
      };
    }
  });

  // User preferences (language + notifications)
  const [preferences, setPreferences] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_PREFS_KEY);
      if (saved) {
        return {
          language: "en",
          notifyOnUploadComplete: false,
          ...JSON.parse(saved),
        };
      }
    } catch {
      // ignore
    }
    return {
      language: "en",
      notifyOnUploadComplete: false,
    };
  });

  // Change password form state
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordStatus, setPasswordStatus] = useState("idle"); // "idle" | "saving"
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  // Load current user from backend
  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      setStatus("loading");
      setError("");

      try {
        const res = await apiFetch("/v1/auth/ping");

        if (res.status === 401) {
          clearAccessToken();
          if (!cancelled) {
            navigate("/login", { replace: true });
          }
          return;
        }

        if (!res.ok) {
          let detail = "";
          try {
            const body = await res.json();
            detail = body.detail || JSON.stringify(body);
          } catch {
            // ignore parse error
          }
          const msg = detail || `HTTP ${res.status}`;
          throw new Error(msg);
        }

        const data = await res.json();
        if (cancelled) return;

        setUser(data);
        setStatus("ok");

        // Sync email into profileData and persist to localStorage
        setProfileData((prev) => {
          const next = {
            ...prev,
            email: data.email || prev.email || "",
          };
          try {
            localStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(next));
          } catch {
            // ignore
          }
          return next;
        });
      } catch (err) {
        console.error("settings auth ping failed:", err);
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load your account"
          );
          setStatus("error");
        }
      }
    }

    loadUser();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleProfileNameChange = (value) => {
    setProfileData((prev) => {
      const next = { ...prev, fullName: value };
      try {
        localStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleThemeChange = (value) => {
    if (value === "light") {
      setLightTheme();
    } else {
      setDarkTheme();
    }
  };

  const handlePreferenceChange = (key, value) => {
    setPreferences((prev) => {
      const next = {
        ...prev,
        [key]: value,
      };
      try {
        localStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handlePasswordFieldChange = (field, value) => {
    setPasswordData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (!passwordData.currentPassword || !passwordData.newPassword) {
      setPasswordError("Please fill in your current and new password.");
      return;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }
    if (passwordData.newPassword.length < 8) {
      setPasswordError("New password should be at least 8 characters long.");
      return;
    }

    setPasswordStatus("saving");

    try {
      // Get the current user from Supabase
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user?.email) {
        throw new Error("Could not load your account. Please sign in again.");
      }
      const email = userData.user.email;

      // Verify current password by attempting a sign-in
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: passwordData.currentPassword,
      });
      if (signInError) {
        throw new Error("Your current password is incorrect.");
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: passwordData.newPassword,
      });
      if (updateError) {
        throw new Error(updateError.message || "Failed to update password.");
      }

      setPasswordSuccess("Password updated successfully.");
      setPasswordData({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    } catch (err) {
      console.error("change password failed:", err);
      setPasswordError(
        err instanceof Error ? err.message : "Failed to update password."
      );
    } finally {
      setPasswordStatus("idle");
    }
  };

  const displayName =
    profileData.fullName && profileData.fullName.trim().length > 0
      ? profileData.fullName.trim()
      : user?.email
      ? user.email.split("@")[0]
      : "Your account";

  const displayEmail = profileData.email || user?.email || "";

  const initials =
    displayName && displayName.trim().length > 0
      ? displayName
          .split(" ")
          .map((part) => part[0])
          .join("")
          .slice(0, 2)
          .toUpperCase()
      : displayEmail
      ? displayEmail[0].toUpperCase()
      : "?";

  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <main
        className="settings-content"
        style={{
          flex: 1,
          padding: 0,
          maxWidth: "960px",
          width: "100%",
          margin: "0 auto",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            marginTop: "1.5rem",
            marginBottom: "1.5rem",
            width: "100%",
            maxWidth: "840px",
            display: "flex",
            gap: "1.25rem",
            borderRadius: "0.75rem",
            border: "1px solid #111827",
            background: "#020617",
            padding: "1rem 1.25rem",
          }}
        >
          {/* Left side: account + tab nav (ChatGPT-style) */}
          <aside
            style={{
              width: "230px",
              borderRight: "1px solid #111827",
              paddingRight: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            {/* Profile summary (avatar like bottom-right pill) */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                }}
              >
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "999px",
                    background:
                      "radial-gradient(circle at 30% 0, var(--accent-primary) 0, #065f46 40%, #020617 100%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.9rem",
                    fontWeight: 600,
                    color: "#f9fafb",
                    border: "1px solid rgba(0,255,136,0.6)",
                  }}
                >
                  {initials}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "0.95rem",
                      fontWeight: 500,
                    }}
                  >
                    {displayName}
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "#9ca3af",
                    }}
                  >
                    {displayEmail || "loading…"}
                  </div>
                </div>
              </div>
              <p
                style={{
                  fontSize: "0.75rem",
                  color: "#6b7280",
                  marginTop: "0.25rem",
                }}
              >
                Update your profile and appearance. Email and account ID are
                managed by Supabase.
              </p>
            </div>

            {/* Tab navigation */}
            <nav className="tab-navigation">
              <button
                type="button"
                className={`tab-btn ${activeTab === "general" ? "active" : ""}`}
                onClick={() => setActiveTab("general")}
              >
                <span className="tab-btn-icon">⚙️</span>
                <span className="tab-btn-label">General</span>
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === "preferences" ? "active" : ""}`}
                onClick={() => setActiveTab("preferences")}
              >
                <span className="tab-btn-icon">⭐</span>
                <span className="tab-btn-label">Preferences</span>
              </button>
            </nav>
          </aside>

          {/* Right side: settings panels */}
          <section
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            {status === "loading" && (
              <p
                style={{
                  fontSize: "0.9rem",
                  color: "#9ca3af",
                }}
              >
                Loading your settings…
              </p>
            )}

            {status === "error" && (
              <div
                style={{
                  fontSize: "0.85rem",
                  color: "#fecaca",
                  background: "#450a0a",
                  padding: "0.6rem 0.8rem",
                  borderRadius: "0.5rem",
                }}
              >
                Failed to load account: {error}
              </div>
            )}

            {status === "ok" && (
              <>
                {activeTab === "general" ? (
                  <>
                    {/* Profile name (read-only email, editable name) */}
                    <section
                      style={{
                        padding: "0.75rem 0.9rem",
                        borderRadius: "0.6rem",
                        background: "var(--card-bg, #020617)",
                        border: "1px solid var(--card-border, #111827)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.75rem",
                      }}
                    >
                      <div>
                        <h2
                          className="form-section-title"
                          style={{
                            fontSize: "1.05rem",
                            marginBottom: "0.25rem",
                          }}
                        >
                          Profile
                        </h2>
                        <p
                          style={{
                            fontSize: "0.8rem",
                            color: "#9ca3af",
                          }}
                        >
                          Your name is used only inside Notably. Your email
                          comes from your Supabase account and can&apos;t be
                          changed here.
                        </p>
                      </div>

                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">FULL NAME</label>
                        <input
                          type="text"
                          className="form-input"
                          value={profileData.fullName}
                          placeholder="Add your name"
                          onChange={(e) =>
                            handleProfileNameChange(e.target.value)
                          }
                        />
                      </div>

                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">EMAIL</label>
                        <div
                          style={{
                            height: "54px",
                            borderRadius: "0.5rem",
                            border: "1.5px solid #111827",
                            background: "#020617",
                            display: "flex",
                            alignItems: "center",
                            padding: "0 0.75rem",
                            fontSize: "0.9rem",
                            color: "#e5e7eb",
                          }}
                        >
                          {displayEmail || "Unknown email"}
                        </div>
                      </div>
                    </section>

                    {/* Appearance / Theme */}
                    <section
                      style={{
                        padding: "0.75rem 0.9rem",
                        borderRadius: "0.6rem",
                        background: "var(--card-bg, #020617)",
                        border: "1px solid var(--card-border, #111827)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.75rem",
                      }}
                    >
                      <div>
                        <h2
                          className="form-section-title"
                          style={{
                            fontSize: "1.05rem",
                            marginBottom: "0.25rem",
                          }}
                        >
                          Appearance
                        </h2>
                        <p
                          style={{
                            fontSize: "0.8rem",
                            color: "#9ca3af",
                          }}
                        >
                          Switch between light and dark modes. This applies to
                          the entire Notably UI.
                        </p>
                      </div>

                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">THEME</label>
                        <div className="radio-group">
                          <label className="radio-option">
                            <input
                              type="radio"
                              name="theme"
                              value="dark"
                              checked={isDark}
                              onChange={() => handleThemeChange("dark")}
                            />
                            <span className="radio-label">Dark mode</span>
                          </label>
                          <label className="radio-option">
                            <input
                              type="radio"
                              name="theme"
                              value="light"
                              checked={isLight}
                              onChange={() => handleThemeChange("light")}
                            />
                            <span className="radio-label">Light mode</span>
                          </label>
                        </div>
                      </div>
                    </section>

                    {/* Change password */}
                    <section
                      style={{
                        padding: "0.75rem 0.9rem",
                        borderRadius: "0.6rem",
                        background: "var(--card-bg, #020617)",
                        border: "1px solid var(--card-border, #111827)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.75rem",
                      }}
                    >
                      <div>
                        <h2
                          className="form-section-title"
                          style={{
                            fontSize: "1.05rem",
                            marginBottom: "0.25rem",
                          }}
                        >
                          Change password
                        </h2>
                        <p
                          style={{
                            fontSize: "0.8rem",
                            color: "#9ca3af",
                          }}
                        >
                          Update the password for your Supabase account.
                        </p>
                      </div>

                      <form
                        onSubmit={handlePasswordSubmit}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.5rem",
                        }}
                      >
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">CURRENT PASSWORD</label>
                          <input
                            type="password"
                            className="form-input"
                            value={passwordData.currentPassword}
                            onChange={(e) =>
                              handlePasswordFieldChange(
                                "currentPassword",
                                e.target.value
                              )
                            }
                          />
                        </div>

                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">NEW PASSWORD</label>
                          <input
                            type="password"
                            className="form-input"
                            value={passwordData.newPassword}
                            onChange={(e) =>
                              handlePasswordFieldChange(
                                "newPassword",
                                e.target.value
                              )
                            }
                          />
                        </div>

                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">
                            CONFIRM NEW PASSWORD
                          </label>
                          <input
                            type="password"
                            className="form-input"
                            value={passwordData.confirmPassword}
                            onChange={(e) =>
                              handlePasswordFieldChange(
                                "confirmPassword",
                                e.target.value
                              )
                            }
                          />
                        </div>

                        {passwordError && (
                          <div
                            style={{
                              fontSize: "0.8rem",
                              color: "#fecaca",
                              background: "#450a0a",
                              padding: "0.4rem 0.6rem",
                              borderRadius: "0.5rem",
                              marginTop: "0.25rem",
                            }}
                          >
                            {passwordError}
                          </div>
                        )}

                        {passwordSuccess && (
                          <div
                            style={{
                              fontSize: "0.8rem",
                              color: "#bbf7d0",
                              background: "#064e3b",
                              padding: "0.4rem 0.6rem",
                              borderRadius: "0.5rem",
                              marginTop: "0.25rem",
                            }}
                          >
                            {passwordSuccess}
                          </div>
                        )}

                        <div
                          className="form-actions"
                          style={{ marginTop: "0.5rem" }}
                        >
                          <button
                            type="submit"
                            className="save-btn"
                            disabled={passwordStatus === "saving"}
                          >
                            {passwordStatus === "saving"
                              ? "Updating…"
                              : "UPDATE PASSWORD"}
                          </button>
                        </div>
                      </form>
                    </section>
                  </>
                ) : (
                  <>
                    {/* Preferences tab: language + notifications */}
                    <section
                      style={{
                        padding: "0.75rem 0.9rem",
                        borderRadius: "0.6rem",
                        background: "var(--card-bg, #020617)",
                        border: "1px solid var(--card-border, #111827)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.75rem",
                      }}
                    >
                      <div>
                        <h2
                          className="form-section-title"
                          style={{
                            fontSize: "1.05rem",
                            marginBottom: "0.25rem",
                          }}
                        >
                          Language
                        </h2>
                        <p
                          style={{
                            fontSize: "0.8rem",
                            color: "#9ca3af",
                          }}
                        >
                          Choose your preferred interface language. (Content is
                          still primarily in English today.)
                        </p>
                      </div>

                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">INTERFACE LANGUAGE</label>
                        <div className="select-wrapper">
                          <select
                            className="form-select"
                            value={preferences.language}
                            onChange={(e) =>
                              handlePreferenceChange("language", e.target.value)
                            }
                          >
                            <option value="en">English</option>
                            <option value="es">Spanish</option>
                            <option value="fr">French</option>
                            <option value="de">German</option>
                          </select>
                          <span className="select-chevron">▾</span>
                        </div>
                      </div>
                    </section>

                    <section
                      style={{
                        padding: "0.75rem 0.9rem",
                        borderRadius: "0.6rem",
                        background: "var(--card-bg, #020617)",
                        border: "1px solid var(--card-border, #111827)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.75rem",
                      }}
                    >
                      <div>
                        <h2
                          className="form-section-title"
                          style={{
                            fontSize: "1.05rem",
                            marginBottom: "0.25rem",
                          }}
                        >
                          Notifications
                        </h2>
                        <p
                          style={{
                            fontSize: "0.8rem",
                            color: "#9ca3af",
                          }}
                        >
                          Control how Notably contacts you. Email notifications
                          for finished uploads will require backend support, but
                          this preference is stored for when it&apos;s ready.
                        </p>
                      </div>

                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">
                          EMAIL NOTIFICATIONS
                        </label>
                        <div className="toggle-group">
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={preferences.notifyOnUploadComplete}
                              onChange={(e) =>
                                handlePreferenceChange(
                                  "notifyOnUploadComplete",
                                  e.target.checked
                                )
                              }
                            />
                            <span className="toggle-label">
                              Email me when an upload has finished processing
                            </span>
                          </label>
                        </div>
                      </div>
                    </section>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

export default SettingsPage;
