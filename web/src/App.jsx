// web/src/App.jsx
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import { isLoggedIn } from "./lib/authToken";
import MeetingDetailPage from "./pages/MeetingDetailPage.jsx";

function App() {
  const authed = isLoggedIn();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        
        <Route
          path="/dashboard"
          element={
            authed ? <DashboardPage /> : <Navigate to="/login" replace />
          }
        />

        <Route path="/meetings/:meetingId" element={<MeetingDetailPage />} /> 
        {/* Default: send people to login or dashboard based on auth */}
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
      </Routes>
    </BrowserRouter>
  );
}

export default App;

