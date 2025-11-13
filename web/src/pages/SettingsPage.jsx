import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import notablyLogo from '../assets/notably logo.png';
import './SettingsPage.css';

const SettingsPage = () => {
  const navigate = useNavigate();
  const { lightTheme, darkTheme, setLightTheme, setDarkTheme } = useTheme();
  
  // Load saved profile or use defaults
  const [profileData, setProfileData] = useState(() => {
    const savedProfile = localStorage.getItem('notably-profile');
    return savedProfile ? JSON.parse(savedProfile) : {
      fullName: 'John Doe',
      email: 'john.doe@email.com',
      memberSince: 'January 2024',
      totalNotes: '247',
      storageUsed: '2.4 GB / 10 GB'
    };
  });

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: ''
  });

  // Load saved preferences or use defaults
  const [generalPreferences, setGeneralPreferences] = useState(() => {
    const savedPreferences = localStorage.getItem('notably-preferences');
    return savedPreferences ? JSON.parse(savedPreferences) : {
      language: 'English',
      notifications: true,
      theme: 'dark'
    };
  });

  const [activeTab, setActiveTab] = useState('profile');

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to logout?')) {
      navigate('/login');
    }
  };

  const handleBackToDashboard = () => {
    navigate('/dashboard');
  };

  const handleProfileChange = (field, value) => {
    const updatedProfile = {
      ...profileData,
      [field]: value
    };
    setProfileData(updatedProfile);
    // Save to localStorage
    localStorage.setItem('notably-profile', JSON.stringify(updatedProfile));
  };

  const handlePasswordChange = (field, value) => {
    setPasswordData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleGeneralChange = (key, value) => {
    const updatedPreferences = {
      ...generalPreferences,
      [key]: value
    };
    setGeneralPreferences(updatedPreferences);
    // Save to localStorage
    localStorage.setItem('notably-preferences', JSON.stringify(updatedPreferences));
    
    if (key === 'theme') {
      if (value === 'light') {
        setLightTheme();
      } else {
        setDarkTheme();
      }
    }
    setGeneralPreferences(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSaveChanges = () => {
    alert('Changes saved successfully!');
  };

  const handleCancel = () => {
    // Reset changes
    setPasswordData({ currentPassword: '', newPassword: '' });
    alert('Changes cancelled');
  };

  return (
    <div className="settings-page">
      {/* Header */}
      <header className="settings-header">
        <div className="header-content">
          <button className="logo-btn" onClick={handleBackToDashboard}>
            <img src={notablyLogo} alt="Notably Logo" className="settings-logo" />
          </button>
        </div>
      </header>

      {/* Page Title */}
      <div className="page-title-section">
        <div className="title-row">
          <h1 className="page-title">Settings</h1>
          <button className="back-btn" onClick={handleBackToDashboard}>
            ← Back to Dashboard
          </button>
        </div>
        
        {/* Tab Navigation */}
        <div className="tab-navigation">
          <button 
            className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            Profile Settings
          </button>
          <button 
            className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General Preferences
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="settings-content">
        {activeTab === 'profile' ? (
          <div className="profile-content">
            {/* Left Column - Profile Info */}
            <div className="profile-card">
              <div className="profile-avatar">
                <div className="avatar-circle">
                  <div className="avatar-icon">
                    <div className="avatar-head"></div>
                    <div className="avatar-body"></div>
                  </div>
                </div>
                <button className="change-photo-btn">CHANGE PHOTO</button>
              </div>

              <div className="user-info">
                <h2 className="user-name">{profileData.fullName}</h2>
                <p className="user-email">{profileData.email}</p>
              </div>

              <div className="account-stats">
                <h3 className="stats-title">ACCOUNT STATS</h3>
                <div className="stat-item">
                  <span className="stat-label">Member Since</span>
                  <span className="stat-value">{profileData.memberSince}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Total Notes</span>
                  <span className="stat-value">{profileData.totalNotes}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Storage Used</span>
                  <span className="stat-value">{profileData.storageUsed}</span>
                </div>
              </div>
            </div>

            {/* Right Column - Account Information */}
            <div className="account-form">
              <h2 className="form-section-title">Account Information</h2>
              
              <div className="form-group">
                <label className="form-label">FULL NAME</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={profileData.fullName}
                  onChange={(e) => handleProfileChange('fullName', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">EMAIL ADDRESS</label>
                <input 
                  type="email" 
                  className="form-input"
                  value={profileData.email}
                  onChange={(e) => handleProfileChange('email', e.target.value)}
                />
              </div>

              <div className="form-divider"></div>

              <h2 className="form-section-title">Change Password</h2>

              <div className="form-group">
                <label className="form-label">CURRENT PASSWORD</label>
                <input 
                  type="password" 
                  className="form-input"
                  value={passwordData.currentPassword}
                  onChange={(e) => handlePasswordChange('currentPassword', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">NEW PASSWORD</label>
                <input 
                  type="password" 
                  className="form-input"
                  value={passwordData.newPassword}
                  onChange={(e) => handlePasswordChange('newPassword', e.target.value)}
                />
              </div>

              <div className="form-actions">
                <button className="save-btn" onClick={handleSaveChanges}>
                  SAVE CHANGES
                </button>
                <button className="cancel-btn" onClick={handleCancel}>
                  CANCEL
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="general-content">
            {/* General Preferences Content */}
            <div className="preferences-card">
              <h2 className="form-section-title">General Preferences</h2>
              
              <div className="form-group">
                <label className="form-label">LANGUAGE</label>
                <select 
                  className="form-select"
                  value={generalPreferences.language}
                  onChange={(e) => handleGeneralChange('language', e.target.value)}
                >
                  <option value="English">English</option>
                  <option value="Spanish">Spanish</option>
                  <option value="French">French</option>
                  <option value="German">German</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">THEME</label>
                <div className="radio-group">
                  <label className="radio-option">
                    <input 
                      type="radio" 
                      name="theme" 
                      value="dark"
                      checked={generalPreferences.theme === 'dark'}
                      onChange={(e) => handleGeneralChange('theme', e.target.value)}
                    />
                    <span className="radio-label">Dark Mode</span>
                  </label>
                  <label className="radio-option">
                    <input 
                      type="radio" 
                      name="theme" 
                      value="light"
                      checked={generalPreferences.theme === 'light'}
                      onChange={(e) => handleGeneralChange('theme', e.target.value)}
                    />
                    <span className="radio-label">Light Mode</span>
                  </label>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">NOTIFICATIONS</label>
                <div className="toggle-group">
                  <label className="toggle-switch">
                    <input 
                      type="checkbox"
                      checked={generalPreferences.notifications}
                      onChange={(e) => handleGeneralChange('notifications', e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                    <span className="toggle-label">Enable notifications</span>
                  </label>
                </div>
              </div>

              <div className="form-actions">
                <button className="save-btn" onClick={handleSaveChanges}>
                  SAVE PREFERENCES
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default SettingsPage;