import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import './TranscriptionPage.css';

const TranscriptionPage = () => {
  const navigate = useNavigate();
  const { filename } = useParams();
  const { theme } = useTheme();
  const [searchTerm, setSearchTerm] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState('00:00');
  const [duration, setDuration] = useState('42:18');

  // Sample transcript data
  const transcriptData = [
    {
      speaker: 'Speaker 1',
      timestamp: '00:00',
      text: 'Good morning, everyone. Today we\'ll be discussing the quarterly results and our upcoming initiatives for the next quarter.'
    },
    {
      speaker: 'Speaker 2', 
      timestamp: '00:15',
      text: 'Hi — thanks for joining. The first item on our agenda is the performance metrics from last month.'
    },
    {
      speaker: 'Speaker 1',
      timestamp: '00:35', 
      text: 'The results were better than expected. We saw a 15% increase in user engagement and a 12% boost in conversion rates.'
    },
    {
      speaker: 'Speaker 3',
      timestamp: '00:58',
      text: 'I\'ll follow up with the metrics breakdown and send the detailed analysis to everyone by end of week.'
    },
    {
      speaker: 'Speaker 2',
      timestamp: '01:20',
      text: 'That sounds great. Let\'s also discuss the marketing campaign performance and how it impacted these numbers.'
    },
    {
      speaker: 'Speaker 1',
      timestamp: '01:45',
      text: 'Absolutely. The new targeting strategy we implemented last month has shown significant improvements across all channels.'
    }
  ];

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleDownloadTranscript = () => {
    alert('Downloading transcript...');
    // Will implement actual download logic later
  };

  const handleExportPDF = () => {
    alert('Exporting as PDF...');
    // Will implement PDF export logic later
  };

  const handleExportTXT = () => {
    alert('Exporting as TXT...');
    // Will implement TXT export logic later
  };

  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
  };

  const goBack = () => {
    navigate('/dashboard');
  };

  return (
    <div className="transcription-container">
      <div className="top-bar"></div>
      
      {/* Header Section */}
      <header className="transcription-header">
        <div className="header-content">
          <h1 className="file-name">{filename || 'Meeting_2024-04-22.mp4'}</h1>
          <p className="view-type">Transcription view</p>
          <button className="back-button" onClick={goBack}>
            ← Back to Dashboard
          </button>
        </div>
      </header>

      {/* Audio Player */}
      <section className="audio-player-section">
        <div className="audio-player">
          <button className="play-button" onClick={handlePlayPause}>
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="#0A0A0A">
                <rect x="6" y="4" width="4" height="16"/>
                <rect x="14" y="4" width="4" height="16"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="#0A0A0A">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
            )}
          </button>
          
          <div className="time-display">
            {currentTime} / {duration}
          </div>
          
          <div className="progress-container">
            <div className="progress-bar">
              <div className="progress-fill"></div>
              <div className="progress-knob"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <main className="main-content">
        {/* Left Panel - Search & Actions */}
        <section className="actions-panel">
          <div className="actions-card">
            <h2 className="actions-title">Search transcript</h2>
            
            <div className="search-section">
              <input
                type="text"
                className="search-input"
                placeholder="Find keywords, speakers, or timestamps"
                value={searchTerm}
                onChange={handleSearch}
              />
            </div>

            <div className="actions-section">
              <button className="download-transcript-btn" onClick={handleDownloadTranscript}>
                Download Transcript
              </button>
              
              <div className="export-buttons">
                <button className="export-btn" onClick={handleExportPDF}>
                  Export PDF
                </button>
                <button className="export-btn" onClick={handleExportTXT}>
                  Export TXT
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Right Panel - Transcript */}
        <section className="transcript-panel">
          <div className="transcript-card">
            <h2 className="transcript-title">Transcript</h2>
            <div className="transcript-content">
              {transcriptData.map((entry, index) => (
                <div key={index} className="transcript-entry">
                  <span className="speaker-label">{entry.speaker}:</span>
                  <span className="transcript-text">{entry.text}</span>
                  <span className="timestamp">{entry.timestamp}</span>
                </div>
              ))}
              <div className="transcript-ellipsis">...</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default TranscriptionPage;