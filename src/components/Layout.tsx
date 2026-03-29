import { Link, Outlet } from "react-router-dom";
import { BookOpen, LogIn, LogOut, User, Check, Smartphone, Info, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useState } from "react";

export default function Layout() {
  const { user, signIn, signOut, loading: authLoading } = useAuth();
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-stone-50 font-sans text-stone-900 flex flex-col">
      <nav className="bg-white border-b border-stone-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="bg-indigo-600 text-white p-2 rounded-xl">
                <BookOpen size={24} />
              </div>
              <span className="text-xl font-bold tracking-tight text-stone-800">StoryCraft</span>
            </Link>

            <div className="flex items-center gap-4">
              {authLoading ? (
                <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              ) : user ? (
                <div className="relative">
                  <button
                    onClick={() => setIsProfileOpen(!isProfileOpen)}
                    className="flex items-center gap-2 p-1 pr-3 bg-stone-100 rounded-full hover:bg-stone-200 transition-colors"
                  >
                    {user.photoURL ? (
                      <img src={user.photoURL} alt={user.displayName || ""} className="w-8 h-8 rounded-full border border-white" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center">
                        <User size={16} />
                      </div>
                    )}
                    <span className="text-sm font-medium text-stone-700 hidden sm:inline">{user.displayName?.split(' ')[0]}</span>
                  </button>

                  {isProfileOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-stone-100 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="px-4 py-2 border-b border-stone-50 mb-2">
                        <p className="text-xs font-bold text-stone-400 uppercase tracking-wider">Tài khoản</p>
                        <p className="text-sm font-medium text-stone-800 truncate">{user.email}</p>
                      </div>
                      <button
                        onClick={() => {
                          signOut();
                          setIsProfileOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <LogOut size={16} />
                        Đăng xuất
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => signIn()}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 active:scale-95"
                >
                  <LogIn size={18} />
                  <span>Đăng nhập</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {authLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] animate-in fade-in duration-500">
            <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
            <p className="text-stone-500 font-medium animate-pulse">Đang đồng bộ dữ liệu...</p>
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}

