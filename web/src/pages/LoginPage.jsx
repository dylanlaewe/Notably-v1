import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import notablyLogo from '../assets/notably logo.png';
import './LoginPage.css';

function LoginPage() {
  const navigate = useNavigate();
  
  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    if (email && password) {
      setTimeout(() => {
        // Navigate to dashboard on successful login
        navigate('/dashboard');
      }, 1000);
    } else {
      setLoading(false);
      alert('Please enter email and password');
    }
  };

  // Navigate to signup page
  const goToSignup = () => {
    navigate('/signup');
  };

  // Login form
  return (
    <div className="login-page">
      <div className="login-center-wrapper">
        <div className="login-content">
          {/* Logo and Slogan Container - Same width as card */}
          <div className="login-branding">
            {/* Logo Section */}
            <div className="login-logo-section">
              <img 
                src={notablyLogo} 
                alt="Notably Logo" 
                className="login-logo"
              />
            </div>

            {/* Slogan */}
            <h2 className="login-slogan">
              We take the notes, you take the credit
            </h2>
          </div>

          {/* Login Card */}
          <div className="login-card">
            {/* Title */}
            <h1 className="login-title">
              Sign In
            </h1>

            <form onSubmit={handleSubmit} className="login-form">
              {/* Email field */}
              <div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="login-input"
                  placeholder="Enter your email"
                  required
                />
              </div>

              {/* Password field */}
              <div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="login-input"
                  placeholder="Enter your password"
                  required
                />
              </div>

              {/* Forgot Password link */}
              <div className="login-forgot-password">
                <button
                  type="button"
                  onClick={() => alert('Password reset coming soon!')}
                  className="login-forgot-btn"
                >
                  Forgot Password?
                </button>
              </div>

              {/* Sign In Button */}
              <button
                type="submit"
                disabled={loading}
                className="login-signin-btn"
              >
                {loading ? 'SIGNING IN...' : 'SIGN IN'}
              </button>
            </form>

            {/* Sign up link */}
            <div className="login-signup-link">
              <span className="login-signup-text">
                Don't have an account?{' '}
              </span>
              <button
                type="button"
                onClick={() => navigate('/signup')}
                className="login-signup-btn"
              >
                Sign up
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;