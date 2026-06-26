// web/src/App.jsx
import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import LoginPage from "./pages/LoginPage.jsx";
import SignupPage from "./pages/SignupPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import MeetingDetailPage from "./pages/MeetingDetailPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import ApiDocsPage from "./pages/ApiDocsPage.jsx";
import FAQPage from "./pages/FAQPage.jsx";

import {
  clearAccessToken,
  isLoggedIn,
  setAccessToken,
  subscribeToAuthChanges,
} from "./lib/authToken";
import AppShell from "./components/AppShell.jsx";
import { supabase } from "./lib/supabaseClient";

import UpdatePasswordPage from "./pages/UpdatePasswordPage";


function App() {
  const [authed, setAuthed] = useState(() => isLoggedIn());

  useEffect(() => {
    return subscribeToAuthChanges(() => {
      setAuthed(isLoggedIn());
    });
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active || error) return;
      const token = data.session?.access_token || null;
      if (token) {
        setAccessToken(token);
      } else {
        clearAccessToken();
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        setAccessToken(session.access_token);
      } else {
        clearAccessToken();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const withShell = (element) =>
    authed ? <AppShell>{element}</AppShell> : <Navigate to="/login" replace />;

  return (
    <BrowserRouter>
      <Routes>
        {/* Public auth pages (no shell) */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        {/* Authed pages (inside AppShell) */}
        <Route path="/dashboard" element={withShell(<DashboardPage />)} />

        <Route
          path="/meetings/:meetingId"
          element={withShell(<MeetingDetailPage />)}
        />

        <Route path="/settings" element={withShell(<SettingsPage />)} />

        <Route
          path="/api-docs"
          element={withShell(<ApiDocsPage />)}
        />

        <Route path="/faq" element={withShell(<FAQPage />)} />

        {/* Default: send people to dashboard or login */}
        <Route
          path="*"
          element={
            authed ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route path="/update-password" element={<UpdatePasswordPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
