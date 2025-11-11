import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './DashboardPage.css';
import notablyLogo from '../assets/notably logo.png';

const DashboardPage = () => {
  const navigate = useNavigate();
  const [selectedFile, setSelectedFile] = useState(null);

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to logout?')) {
      // Will implement logout logic later
      navigate('/login');
    }
  };

  const navigateTo = (page) => {
    alert(`Navigating to: ${page}`);
    // Will implement navigation logic later
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      alert(`File selected: ${file.name}\nSize: ${(file.size / 1024 / 1024).toFixed(2)} MB\nType: ${file.type}`);
      // Will implement actual upload logic later
    }
  };

  const handleDownload = (filename) => {
    alert(`Downloading: ${filename}`);
    // Will implement actual download logic later
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
      // Simulate file input change
      const fakeEvent = {
        target: {
          files: [file]
        }
      };
      handleFileUpload(fakeEvent);
    }
  };

  return (
    <div className="dashboard-container">
      <div className="top-bar"></div>

      <header className="dashboard-header">
        <div className="logo-container">
          <div className="logo-icon">
            <img src={notablyLogo} alt="Notably Logo" />
          </div>
        </div>
        <button className="logout-btn" onClick={handleLogout}>
          Logout
        </button>
      </header>

      <div className="main-container">
        <aside className="sidebar">
          <button className="nav-btn" onClick={() => navigateTo('home')}>
            Home
          </button>
          <button className="nav-btn" onClick={() => navigateTo('settings')}>
            Settings
          </button>
          <button className="nav-btn" onClick={() => navigateTo('api')}>
            API Documentations
          </button>
          <button className="nav-btn" onClick={() => navigateTo('faq')}>
            FAQ
          </button>
        </aside>

        <main className="content">
          <section className="upload-section">
            <div className="upload-title"></div>
            <label 
              htmlFor="fileUpload" 
              className="upload-box"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <svg className="upload-icon" viewBox="0 0 24 24" fill="none" stroke="#00ff88" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <h3>Drop files here or click to browse</h3>
              <p>Upload your audio or video file</p>
              <p className="file-types">Supported formats: MP3, MP4, WAV, M4A</p>
            </label>
            <input 
              type="file" 
              id="fileUpload" 
              accept="audio/*,video/*" 
              onChange={handleFileUpload}
            />
          </section>

          <section className="dashboard-section">
            <h2>Dashboard</h2>
            <div className="file-list">
              <div className="file-item">
                <div className="file-info">
                  <h3>Team_Meeting_2024-11-10.mp4</h3>
                  <p>Status: Transcript Ready • 45:23 min</p>
                </div>
                <button className="download-btn" onClick={() => handleDownload('Team_Meeting_2024-11-10.mp4')}>
                  Download
                </button>
              </div>
              <div className="file-item">
                <div className="file-info">
                  <h3>Client_Call_2024-11-09.wav</h3>
                  <p>Status: Transcript Ready • 32:15 min</p>
                </div>
                <button className="download-btn" onClick={() => handleDownload('Client_Call_2024-11-09.wav')}>
                  Download
                </button>
              </div>
              <div className="file-item">
                <div className="file-info">
                  <h3>Board_Meeting_2024-11-08.mp3</h3>
                  <p>Status: Transcript Ready • 1:23:45 min</p>
                </div>
                <button className="download-btn" onClick={() => handleDownload('Board_Meeting_2024-11-08.mp3')}>
                  Download
                </button>
              </div>
              <div className="file-item">
                <div className="file-info">
                  <h3>Weekly_Standup_2024-11-07.m4a</h3>
                  <p>Status: Transcript Ready • 28:12 min</p>
                </div>
                <button className="download-btn" onClick={() => handleDownload('Weekly_Standup_2024-11-07.m4a')}>
                  Download
                </button>
              </div>
              <div className="file-item">
                <div className="file-info">
                  <h3>Product_Review_2024-11-06.mp4</h3>
                  <p>Status: Transcript Ready • 56:33 min</p>
                </div>
                <button className="download-btn" onClick={() => handleDownload('Product_Review_2024-11-06.mp4')}>
                  Download
                </button>
              </div>
              <div className="file-item">
                <div className="file-info">
                  <h3>Interview_Sarah_2024-11-05.wav</h3>
                  <p>Status: Transcript Ready • 41:27 min</p>
                </div>
                <button className="download-btn" onClick={() => handleDownload('Interview_Sarah_2024-11-05.wav')}>
                  Download
                </button>
              </div>
              <div className="file-item">
                <div className="file-info">
                  <h3>Sales_Pitch_2024-11-04.mp3</h3>
                  <p>Status: Transcript Ready • 37:18 min</p>
                </div>
                <button className="download-btn" onClick={() => handleDownload('Sales_Pitch_2024-11-04.mp3')}>
                  Download
                </button>
              </div>
              <div className="file-item">
                <div className="file-info">
                  <h3>Training_Session_2024-11-03.mp4</h3>
                  <p>Status: Transcript Ready • 1:15:22 min</p>
                </div>
                <button className="download-btn" onClick={() => handleDownload('Training_Session_2024-11-03.mp4')}>
                  Download
                </button>
              </div>
              <div className="file-item">
                <div className="file-info">
                  <h3>Investor_Call_2024-11-02.wav</h3>
                  <p>Status: Transcript Ready • 52:44 min</p>
                </div>
                <button className="download-btn" onClick={() => handleDownload('Investor_Call_2024-11-02.wav')}>
                  Download
                </button>
              </div>
              <div className="file-item">
                <div className="file-info">
                  <h3>Marketing_Strategy_2024-11-01.m4a</h3>
                  <p>Status: Transcript Ready • 43:17 min</p>
                </div>
                <button className="download-btn" onClick={() => handleDownload('Marketing_Strategy_2024-11-01.m4a')}>
                  Download
                </button>
              </div>
              <div className="file-item">
                <div className="file-info">
                  <h3>Customer_Feedback_2024-10-31.mp3</h3>
                  <p>Status: Transcript Ready • 29:55 min</p>
                </div>
                <button className="download-btn" onClick={() => handleDownload('Customer_Feedback_2024-10-31.mp3')}>
                  Download
                </button>
              </div>
              <div className="file-item">
                <div className="file-info">
                  <h3>Budget_Planning_2024-10-30.mp4</h3>
                  <p>Status: Transcribing... • 38:42 min</p>
                </div>
                <button className="download-btn disabled" disabled>
                  Download
                </button>
              </div>
              <div className="file-item">
                <div className="file-info">
                  <h3>Code_Review_2024-10-29.wav</h3>
                  <p>Status: Processing... • 25:33 min</p>
                </div>
                <button className="download-btn disabled" disabled>
                  Download
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>

      <aside className="bottom-sidebar">
        <button className="bottom-btn" onClick={() => navigateTo('general')}>
          <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="#00ff88" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 1v6m0 6v6m5.2-13.2l-4.2 4.2m0 6l4.2 4.2m6-10.2h-6m-6 0H1m13.2 5.2l-4.2-4.2m0-6l-4.2-4.2"/>
          </svg>
          General
        </button>
        <button className="bottom-btn" onClick={() => navigateTo('account')}>
          <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="#00ff88" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          Account
        </button>
      </aside>
    </div>
  );
};

export default DashboardPage;