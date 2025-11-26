// web/src/App.jsx
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import LoginPage from "./pages/LoginPage.jsx";
import SignupPage from "./pages/SignupPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import MeetingDetailPage from "./pages/MeetingDetailPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import ApiDocsPage from "./pages/ApiDocsPage.jsx";
import FAQPage from "./pages/FAQPage.jsx";

import { isLoggedIn } from "./lib/authToken";
import AppShell from "./components/AppShell.jsx";

import UpdatePasswordPage from "./pages/UpdatePasswordPage";


function App() {
  const authed = isLoggedIn();

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

