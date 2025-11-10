import React, { useState } from 'react';

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    // Simple validation - any email/password works
    if (email && password) {
      setTimeout(() => {
        onLogin({ email, name: email.split('@')[0] });
      }, 1000);
    } else {
      setLoading(false);
      alert('Please enter email and password');
    }
  };

  return (
    <div className="min-h-screen bg-black">
      {/* Top Blue Bar */}
      <div className="w-full h-2" style={{ backgroundColor: '#0a4a6e' }}></div>

      {/* Logo Section */}
      <div className="flex justify-center pt-12 pb-16">
        <div className="text-center">
          <div className="notably-primary text-6xl font-bold mb-2">Notably</div>
          <div className="notably-secondary text-lg">AI Meeting Intelligence</div>
        </div>
      </div>

      {/* Login Card */}
      <div className="flex justify-center px-8">
        <div className="w-full max-w-md">
          <div className="notably-card-container">
            <h1 className="text-3xl font-semibold notably-primary mb-8 text-center">
              Sign In
            </h1>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Email Field */}
              <div>
                <label className="block text-sm font-medium notably-primary mb-3 tracking-wide">
                  EMAIL
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="notably-input"
                  placeholder="Enter your email"
                  required
                />
              </div>

              {/* Password Field */}
              <div>
                <label className="block text-sm font-medium notably-primary mb-3 tracking-wide">
                  PASSWORD
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="notably-input"
                  placeholder="Enter your password"
                  required
                />
              </div>

              {/* Sign In Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full notably-button py-4 text-lg font-bold tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'SIGNING IN...' : 'SIGN IN'}
              </button>
            </form>

            {/* Sign Up Link */}
            <div className="mt-8 text-center">
              <p className="notably-secondary">
                Don't have an account?{' '}
                <button
                  onClick={() => alert('Sign up functionality coming soon!')}
                  className="notably-primary font-semibold hover:notably-secondary transition-colors"
                >
                  Sign up
                </button>
              </p>
            </div>
          </div>

          {/* Demo Credentials */}
          <div className="mt-6 p-4 notably-dark rounded-lg">
            <div className="text-center">
              <p className="notably-secondary text-sm mb-2">Demo Credentials:</p>
              <p className="notably-text text-xs">
                Email: any@email.com | Password: anything
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center mt-16 pb-8">
        <p className="notably-tertiary text-sm">
          © 2024 Notably. All rights reserved.
        </p>
      </div>
    </div>
  );
}

export default LoginScreen;