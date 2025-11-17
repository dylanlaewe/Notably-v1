// web/src/components/AppShell.jsx
import React, { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import notablyLogo from "../assets/notably logo.png";
import { getAccessToken, clearAccessToken } from "../lib/authToken";
import "./AppShell.css";

const navItems = [
  { key: "dashboard", label: "My meetings", to: "/dashboard" },
  { key: "api-docs", label: "API docs", to: "/api-docs" },
  { key: "faq", label: "FAQ", to: "/faq" },
  // More later (Billing, Changelog, etc.)
];

export default function AppShell({ children }) {
  const navigate = useNavigate();

  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);

  // ---- Identity lookup (profile → token) ----
  useEffect(() => {
    let email = "";
    let fullName = "";

    // 1) Try profile in localStorage (Signup / Settings)
    try {
      const stored = localStorage.getItem("notably-profile");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.email) email = parsed.email;
        if (parsed?.fullName) fullName = parsed.fullName;
      }
    } catch (e) {
      console.warn("Failed to parse notably-profile", e);
    }

    // 2) Fallback to Supabase JWT (access token)
    if (!email) {
      const token = getAccessToken();
      if (token) {
        const parts = token.split(".");
        if (parts.length === 3) {
          try {
            const payloadJson = atob(
              parts[1].replace(/-/g, "+").replace(/_/g, "/")
            );
            const payload = JSON.parse(payloadJson);
            email =
              payload.email ||
              payload.user_email ||
              payload.preferred_username ||
              email;

            if (!fullName && payload.user_metadata) {
              fullName =
                payload.user_metadata.full_name ||
                payload.user_metadata.name ||
                fullName;
            }
          } catch (e) {
            console.warn("Failed to decode access token payload", e);
          }
        }
      }
    }

    setUserEmail(email || "Notably user");
    setUserName(fullName || "");
  }, []);

  const avatarInitial = (userName || userEmail || "N")
    .charAt(0)
    .toUpperCase();

  const handleLogoClick = () => {
    navigate("/dashboard");
  };

  const handleLogout = () => {
    clearAccessToken();
    setAccountOpen(false);
    navigate("/login", { replace: true });
  };

  const handleGoToSettings = () => {
    setAccountOpen(false);
    navigate("/settings");
  };

  const toggleAccountOpen = () => {
    setAccountOpen((open) => !open);
  };

  return (
    <div className="app-shell">
      <header className="app-shell-header">
        <button
          type="button"
          className="app-shell-logo-button"
          onClick={handleLogoClick}
        >
          <img
            src={notablyLogo}
            alt="Notably logo"
            className="app-shell-logo-image"
          />
          <span className="app-shell-logo-text">Notably</span>
        </button>

        <div className="app-shell-header-spacer" />
        {/* Top-right space reserved if we ever want extra controls */}
      </header>

      <div className="app-shell-body">
        <aside className="app-shell-sidebar">
          <div className="app-shell-sidebar-inner">
            {/* Main nav */}
            <div className="app-shell-sidebar-main">
              <div className="app-shell-sidebar-section-title">
                Navigation
              </div>
                <nav className="app-shell-nav">
                <NavLink
                    to="/dashboard"
                    className={({ isActive }) =>
                    "app-shell-nav-item" +
                    (isActive ? " app-shell-nav-item-active" : "")
                    }
                >
                    <span className="app-shell-nav-dot" />
                    <span className="app-shell-nav-label">My meetings</span>
                </NavLink>

                {/* API docs with hover dropdown */}
                <div className="app-shell-nav-item-wrapper">
                    <NavLink
                    to="/api-docs"
                    className={({ isActive }) =>
                        "app-shell-nav-item" +
                        (isActive ? " app-shell-nav-item-active" : "")
                    }
                    >
                    <span className="app-shell-nav-dot" />
                    <span className="app-shell-nav-label">API documentation</span>
                    </NavLink>

                    <div className="app-shell-subnav">
                    <a href="/api-docs#overview" className="app-shell-subnav-link">
                        Overview
                    </a>
                    <a href="/api-docs#auth" className="app-shell-subnav-link">
                        Authentication
                    </a>
                    <a href="/api-docs#models" className="app-shell-subnav-link">
                        Data models
                    </a>
                    <a href="/api-docs#endpoints" className="app-shell-subnav-link">
                        Endpoints
                    </a>
                    <a href="/api-docs#errors" className="app-shell-subnav-link">
                        Errors
                    </a>
                    <a href="/api-docs#examples" className="app-shell-subnav-link">
                        Examples
                    </a>
                    <a href="/api-docs#openapi" className="app-shell-subnav-link">
                        OpenAPI spec
                    </a>
                    </div>
                </div>

                <NavLink
                    to="/faq"
                    className={({ isActive }) =>
                    "app-shell-nav-item" +
                    (isActive ? " app-shell-nav-item-active" : "")
                    }
                >
                    <span className="app-shell-nav-dot" />
                    <span className="app-shell-nav-label">FAQ</span>
                </NavLink>
                </nav>

            </div>

            {/* Account section at bottom, ChatGPT-style */}
            <div className="app-shell-sidebar-account">
              <div className="app-shell-account-root">
                <button
                  type="button"
                  className="app-shell-account-button"
                  onClick={toggleAccountOpen}
                >
                  <div className="app-shell-account-avatar">
                    {avatarInitial}
                  </div>
                  <div className="app-shell-account-text">
                    <div className="app-shell-account-email">
                      {userEmail}
                    </div>
                    <div className="app-shell-account-subtitle">
                      Account
                    </div>
                  </div>
                  <span className="app-shell-account-chevron">
                    {accountOpen ? "▴" : "▾"}
                  </span>
                </button>

                {accountOpen && (
                  <div className="app-shell-account-menu">
                    <button
                      type="button"
                      className="app-shell-account-menu-item"
                      onClick={handleGoToSettings}
                    >
                      Settings
                    </button>
                    <button
                      type="button"
                      className="app-shell-account-menu-item app-shell-account-menu-danger"
                      onClick={handleLogout}
                    >
                      Log out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>

        <main className="app-shell-content">{children}</main>
      </div>
    </div>
  );
}

