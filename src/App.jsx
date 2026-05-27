import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import SignIn from './pages/SignIn.jsx';

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="app-shell centered">Loading your calendar...</div>;
  }

  return user ? <Dashboard /> : <SignIn />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
