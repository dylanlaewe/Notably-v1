import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import notablyLogo from '../assets/notably logo.png';
import './SignupPage.css';

function SignupPage() {
  const navigate = useNavigate();
  
  // User state
  const [user, setUser] = useState(null);
  
  // Form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    // Validation
    if (!fullName || !email || !password || !confirmPassword) {
      setLoading(false);
      alert('Please fill in all fields');
      return;
    }
    
    if (password !== confirmPassword) {
      setLoading(false);
      alert('Passwords do not match');
      return;
    }
    
    if (password.length < 6) {
      setLoading(false);
      alert('Password must be at least 6 characters');
      return;
    }

    // Simulate account creation
    setTimeout(() => {
      setUser({ email, name: fullName });
    }, 1000);
  };

  // Navigate to login page
  const goToLogin = () => {
    navigate('/login');
  };

  // If user is created, show success screen
  if (user) {
    return (
      <div className="signup-success-container">
        <div className="signup-success-card">
          <h1 className="signup-success-title">
            Account Created!
          </h1>
          <p className="signup-success-message">Welcome {user.name}! Your account has been created successfully.</p>
          <button 
            onClick={goToLogin}
            className="signup-goto-login-btn"
          >
            GO TO LOGIN
          </button>
        </div>
      </div>
    );
  }

  // Sign up form
  return (
    <div className="signup-page">
      <div className="signup-center-wrapper">
        <div className="signup-content">
          {/* Logo Section */}
          <div className="signup-branding">
            <div className="signup-logo-section">
              <button 
                onClick={goToLogin}
                className="signup-logo-button"
                type="button"
                aria-label="Go to login page"
              >
                <img 
                  src={notablyLogo} 
                  alt="Notably Logo" 
                  className="signup-logo"
                />
              </button>
            </div>
          </div>

          {/* Sign up Card */}
          <div className="signup-card">
        {/* Title */}
        <h1 className="signup-title">
          Create an Account
        </h1>

        <form onSubmit={handleSubmit} className="signup-form">
          {/* Full Name field */}
          <div>
            <label className="signup-label">
              FULL NAME
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="signup-input"
              placeholder="Enter your full name"
              required
              autoComplete="name"
              onFocus={(e) => e.target.style.borderColor = '#00FF88'}
              onBlur={(e) => e.target.style.borderColor = '#2A2A2A'}
            />
          </div>

          {/* Email field */}
          <div>
            <label className="signup-label">
              EMAIL
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="signup-input"
              placeholder="Enter your email"
              required
              onFocus={(e) => e.target.style.borderColor = '#00FF88'}
              onBlur={(e) => e.target.style.borderColor = '#2A2A2A'}
            />
          </div>

          {/* Password field */}
          <div>
            <label className="signup-label">
              PASSWORD
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="signup-input"
              placeholder="Enter your password"
              required
              minLength={6}
              onFocus={(e) => e.target.style.borderColor = '#00FF88'}
              onBlur={(e) => e.target.style.borderColor = '#2A2A2A'}
            />
          </div>

          {/* Confirm Password field */}
          <div>
            <label className="signup-label">
              CONFIRM PASSWORD
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="signup-input"
              placeholder="Confirm your password"
              required
              onFocus={(e) => e.target.style.borderColor = '#00FF88'}
              onBlur={(e) => e.target.style.borderColor = '#2A2A2A'}
            />
          </div>

          {/* Create Account Button */}
          <button
            type="submit"
            disabled={loading}
            className="signup-button"
          >
            {loading ? 'CREATING ACCOUNT...' : 'CREATE ACCOUNT'}
          </button>
        </form>

          {/* Login link */}
          <div className="signup-login-link">
            <span className="signup-login-text">
              Already have an account?{' '}
            </span>
            <button
              type="button"
              onClick={goToLogin}
              className="signup-login-button"
            >
              Log in
            </button>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SignupPage; 