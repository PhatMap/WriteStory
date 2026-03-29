/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route } from "react-router-dom";
import React from "react";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Page1 from "./pages/Page1";
import Page2 from "./pages/Page2";
import PageWorld from "./pages/PageWorld";
import Page3 from "./pages/Page3";
import Page4 from "./pages/Page4";
import StoryEditor from "./pages/StoryEditor";
import SharedStory from "./pages/SharedStory";
import { AuthProvider } from "./contexts/AuthContext";

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-lg w-full text-center">
            <h1 className="text-2xl font-bold text-rose-600 mb-4">Đã xảy ra lỗi hệ thống</h1>
            <p className="text-stone-600 mb-6">Xin lỗi, đã có lỗi không mong muốn xảy ra. Vui lòng tải lại trang để tiếp tục.</p>
            <div className="bg-stone-100 p-4 rounded-lg text-left overflow-auto max-h-40 text-sm text-stone-500 mb-6 font-mono">
              {this.state.error?.message || "Unknown error"}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="page1" element={<Page1 />} />
              <Route path="page-world" element={<PageWorld />} />
              <Route path="page2" element={<Page2 />} />
              <Route path="page3" element={<Page3 />} />
              <Route path="page4" element={<Page4 />} />
              <Route path="editor" element={<StoryEditor />} />
              <Route path="share/:slug" element={<SharedStory />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}

