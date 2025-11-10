import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import TranscriptionPage from './pages/TranscriptionPage';
import SettingsPage from './pages/SettingsPage';
import ProfilePage from './pages/ProfilePage';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<LoginPage />} />
        
        {/* Protected Routes */}
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        } />
        
        <Route path="/transcription/:meetingId" element={
          <ProtectedRoute>
            <TranscriptionPage />
          </ProtectedRoute>
        } />
        
        <Route path="/settings" element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        } />
        
        <Route path="/profile" element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        } />
        
        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
