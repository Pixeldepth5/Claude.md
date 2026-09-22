import { AuthProvider, useAuth } from "./AuthContext";
import { AuthPage } from "./pages/AuthPage";
import { MainApp } from "./pages/MainApp";

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Loading…</div>;
  return user ? <MainApp /> : <AuthPage />;
}

function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

export default App;
