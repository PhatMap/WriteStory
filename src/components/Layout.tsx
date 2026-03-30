import { Link, Outlet } from "react-router-dom";
import { BookOpen, FolderOpen } from "lucide-react";
import { texts } from "../constants/texts";

export default function Layout() {
  return (
    <div className="min-h-screen bg-stone-50 font-sans text-stone-900 flex flex-col">
      <nav className="z-50 border-b border-stone-200 bg-white/95 shadow-sm backdrop-blur supports-[padding:max(0px)]:pt-[env(safe-area-inset-top)]">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex min-h-16 items-center justify-between gap-3 py-2">
            <Link to="/" className="flex min-w-0 items-center gap-2">
              <div className="bg-indigo-600 text-white p-2 rounded-xl shrink-0">
                <BookOpen size={22} />
              </div>
              <span className="truncate text-lg sm:text-xl font-bold tracking-tight text-stone-800">
                {texts.common.appName}
              </span>
            </Link>
            <Link
              to="/library"
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-indigo-200 hover:text-indigo-600"
            >
              <FolderOpen size={16} />
              <span className="hidden xs:inline">{texts.layout.libraryLink}</span>
            </Link>
          </div>
        </div>
      </nav>
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
