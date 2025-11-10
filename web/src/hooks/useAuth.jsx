import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is logged in (e.g., check localStorage, JWT token, etc.)
    const token = localStorage.getItem('notably-token');
    const savedUser = localStorage.getItem('notably-user');
    
    if (token && savedUser) {
      setIsAuthenticated(true);
      setUser(JSON.parse(savedUser));
    }
    
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    try {
      // For now, simulate login - replace with actual API call
      if (email && password) {
        const mockUser = {
          id: '1',
          name: 'John Doe',
          email: email
        };
        
        // Save to localStorage
        localStorage.setItem('notably-token', 'mock-jwt-token');
        localStorage.setItem('notably-user', JSON.stringify(mockUser));
        
        setIsAuthenticated(true);
        setUser(mockUser);
        
        return { success: true };
      } else {
        return { success: false, error: 'Invalid credentials' };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  const logout = () => {
    localStorage.removeItem('notably-token');
    localStorage.removeItem('notably-user');
    setIsAuthenticated(false);
    setUser(null);
  };

  const value = {
    isAuthenticated,
    user,
    login,
    logout,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}