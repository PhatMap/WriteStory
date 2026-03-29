import { Link, Outlet } from "react-router-dom";
import { BookOpen, FolderOpen } from "lucide-react";

export default function Layout() {
  return (
    <div className="min-h-screen bg-stone-50 font-sans text-stone-900 flex flex-col">
      <nav className="bg-white border-b border-stone-200 z-50 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="bg-indigo-600 text-white p-2 rounded-xl">
                <BookOpen size={24} />
              </div>
              <span className="text-xl font-bold tracking-tight text-stone-800">
                StoryCraft
              </span>
            </Link>
          </div>
        </div>
      </nav>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
