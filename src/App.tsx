import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from './store/auth'
import Login from './pages/Login'
import Register from './pages/Register'
import Home from './pages/Home'
import Reader from './pages/Reader'

function App() {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore()

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <Router>
      <Routes>
        <Route
          path="/login"
          element={
            isAuthenticated ? <Navigate to="/" replace /> : <Login />
          }
        />
        <Route
          path="/register"
          element={
            isAuthenticated ? <Navigate to="/" replace /> : <Register />
          }
        />
        <Route
          path="/"
          element={
            isAuthenticated ? <Home /> : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/reader/:bookId"
          element={
            isAuthenticated ? <Reader /> : <Navigate to="/login" replace />
          }
        />
        <Route
          path="*"
          element={<Navigate to="/" replace />}
        />
      </Routes>
    </Router>
  )
}

export default App