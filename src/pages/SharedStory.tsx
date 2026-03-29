import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Book, Calendar, User, Share2, Copy, CheckCircle2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { db, doc, getDoc } from "../services/firebase";

type SharedContent = {
  title: string;
  content: any;
  created_at: string;
};

export default function SharedStory() {
  const { slug } = useParams<{ slug: string }>();
  const [story, setStory] = useState<SharedContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchStory = async () => {
      if (!slug) return;
      try {
        const docRef = doc(db, 'shared_stories', slug);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          setStory({
            title: data.title,
            content: JSON.parse(data.content),
            created_at: data.created_at
          });
        } else {
          throw new Error("Không tìm thấy truyện hoặc link đã hết hạn.");
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStory();
  }, [slug]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-stone-500 font-medium">Đang tải truyện...</p>
        </div>
      </div>
    );
  }

  if (error || !story) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mb-6">
          <Book size={40} />
        </div>
        <h1 className="text-2xl font-bold text-stone-800 mb-2">Ối! Có lỗi xảy ra</h1>
        <p className="text-stone-500 mb-8 max-w-md">{error || "Không tìm thấy nội dung yêu cầu."}</p>
        <Link to="/" className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200">
          Về trang chủ
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 pb-20">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-stone-600 hover:text-indigo-600 transition-colors">
            <ArrowLeft size={20} />
            <span className="font-medium hidden sm:inline">Trang chủ</span>
          </Link>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleCopyLink}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-bold"
            >
              {copied ? <CheckCircle2 size={18} /> : <Share2 size={18} />}
              {copied ? "Đã chép link" : "Chia sẻ"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 pt-12">
        <article className="bg-white rounded-3xl shadow-xl shadow-stone-200/50 overflow-hidden border border-stone-100">
          {/* Hero Section */}
          <div className="p-8 sm:p-12 border-b border-stone-50 bg-gradient-to-br from-indigo-50/30 to-stone-50/30">
            <h1 className="text-3xl sm:text-4xl font-black text-stone-900 mb-6 leading-tight">
              {story.title}
            </h1>
            <div className="flex flex-wrap gap-4 text-sm text-stone-500">
              <div className="flex items-center gap-1.5">
                <Calendar size={16} />
                <span>{new Date(story.created_at).toLocaleDateString('vi-VN')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <User size={16} />
                <span>Tác giả AI Studio</span>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-8 sm:p-12 prose prose-stone max-w-none">
            {typeof story.content === 'string' ? (
              <div className="whitespace-pre-wrap text-stone-700 leading-relaxed text-lg">
                <ReactMarkdown>{story.content}</ReactMarkdown>
              </div>
            ) : (
              <div className="space-y-12">
                {story.content.map((vol: any) => (
                  <div key={vol.id} className="space-y-8">
                    <h2 className="text-2xl font-bold text-stone-800 border-l-4 border-indigo-500 pl-4">{vol.title}</h2>
                    {vol.chapters.map((chap: any) => (
                      <div key={chap.id} className="space-y-4">
                        <h3 className="text-xl font-bold text-stone-700">{chap.title}</h3>
                        <div className="text-stone-600 leading-relaxed text-lg">
                          <ReactMarkdown>{chap.content}</ReactMarkdown>
                        </div>
                        <div className="h-px bg-stone-100 w-24 mx-auto my-8"></div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-8 bg-stone-50 border-t border-stone-100 text-center">
            <p className="text-stone-400 text-sm mb-4">Được tạo bởi AI Studio - Trình viết truyện thông minh</p>
            <Link to="/" className="inline-flex items-center gap-2 text-indigo-600 font-bold hover:underline">
              Tự tạo truyện của riêng bạn <ArrowLeft size={16} className="rotate-180" />
            </Link>
          </div>
        </article>
      </main>
    </div>
  );
}
