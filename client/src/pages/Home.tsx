import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Copy, Trash2, Check, Plus, Image as ImageIcon, 
  FileText, Link2, Search, Settings, Star, Clock, 
  MoreHorizontal, Scissors, Download, Share2
} from "lucide-react";
import { format } from "date-fns";

// Mock Data
type ClipType = 'text' | 'link' | 'image' | 'code';

interface Clip {
  id: string;
  type: ClipType;
  content: string;
  preview?: string;
  timestamp: Date;
  isStarred: boolean;
  metadata?: string;
}

const MOCK_CLIPS: Clip[] = [
  {
    id: "1",
    type: "image",
    content: "Design inspiration",
    preview: "/images/background.jpg",
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    isStarred: true,
    metadata: "1920x1080 • 1.2MB"
  },
  {
    id: "2",
    type: "text",
    content: "Meeting notes: Discuss the new fluid glassmorphism design system for the web clipboard project. Need to ensure animations are butter smooth.",
    timestamp: new Date(Date.now() - 1000 * 60 * 30),
    isStarred: false,
    metadata: "132 words"
  },
  {
    id: "3",
    type: "link",
    content: "https://replit.com/~",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
    isStarred: true,
  },
  {
    id: "4",
    type: "code",
    content: "const glassmorphism = {\n  backdropFilter: 'blur(16px)',\n  backgroundColor: 'rgba(255, 255, 255, 0.1)',\n  border: '1px solid rgba(255, 255, 255, 0.2)'\n};",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5),
    isStarred: false,
    metadata: "JavaScript • 4 lines"
  }
];

export default function Home() {
  const [clips, setClips] = useState<Clip[]>(MOCK_CLIPS);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<'all' | 'starred' | ClipType>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleStar = (id: string) => {
    setClips(clips.map(clip => 
      clip.id === id ? { ...clip, isStarred: !clip.isStarred } : clip
    ));
  };

  const deleteClip = (id: string) => {
    setClips(clips.filter(clip => clip.id !== id));
  };

  const filteredClips = clips.filter(clip => {
    const matchesSearch = clip.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = 
      activeFilter === 'all' ? true :
      activeFilter === 'starred' ? clip.isStarred :
      clip.type === activeFilter;
    return matchesSearch && matchesFilter;
  });

  const getIconForType = (type: ClipType) => {
    switch (type) {
      case 'text': return <FileText className="w-4 h-4 text-blue-500" />;
      case 'link': return <Link2 className="w-4 h-4 text-green-500" />;
      case 'image': return <ImageIcon className="w-4 h-4 text-purple-500" />;
      case 'code': return <Scissors className="w-4 h-4 text-orange-500" />;
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 lg:p-12 flex items-center justify-center font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-6xl h-[85vh] glass-panel rounded-3xl overflow-hidden flex flex-col md:flex-row shadow-2xl"
      >
        {/* Sidebar */}
        <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-white/20 p-6 flex flex-col bg-white/10 dark:bg-black/10">
          <div className="flex items-center gap-3 mb-8 px-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-500 to-purple-500 flex items-center justify-center shadow-lg">
              <Scissors className="w-4 h-4 text-white" />
            </div>
            <h1 className="font-bold text-xl tracking-tight text-gray-900 dark:text-white">CloudClip</h1>
          </div>

          <nav className="space-y-2 flex-1">
            <NavItem 
              icon={<Clock />} 
              label="Recent" 
              active={activeFilter === 'all'} 
              onClick={() => setActiveFilter('all')} 
            />
            <NavItem 
              icon={<Star />} 
              label="Favorites" 
              active={activeFilter === 'starred'} 
              onClick={() => setActiveFilter('starred')} 
            />
            <div className="h-px w-full bg-white/20 my-4" />
            <NavItem 
              icon={<FileText />} 
              label="Texts" 
              active={activeFilter === 'text'} 
              onClick={() => setActiveFilter('text')} 
              count={clips.filter(c => c.type === 'text').length}
            />
            <NavItem 
              icon={<Link2 />} 
              label="Links" 
              active={activeFilter === 'link'} 
              onClick={() => setActiveFilter('link')} 
              count={clips.filter(c => c.type === 'link').length}
            />
            <NavItem 
              icon={<ImageIcon />} 
              label="Images" 
              active={activeFilter === 'image'} 
              onClick={() => setActiveFilter('image')} 
              count={clips.filter(c => c.type === 'image').length}
            />
            <NavItem 
              icon={<Scissors />} 
              label="Snippets" 
              active={activeFilter === 'code'} 
              onClick={() => setActiveFilter('code')} 
              count={clips.filter(c => c.type === 'code').length}
            />
          </nav>

          <div className="mt-auto pt-4">
            <button className="flex items-center gap-3 px-4 py-3 rounded-xl w-full text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-white/20 dark:hover:bg-white/5 transition-colors">
              <Settings className="w-4 h-4" />
              Settings
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="p-6 pb-4 flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input 
                type="text" 
                placeholder="Search your clipboard..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3 rounded-2xl glass-input text-sm text-gray-800 dark:text-white placeholder-gray-500 outline-none"
              />
            </div>
            <button className="bg-gray-900 text-white dark:bg-white dark:text-gray-900 p-3 px-5 rounded-2xl text-sm font-medium shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-2">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New Note</span>
            </button>
          </header>

          {/* Grid Content */}
          <div className="flex-1 overflow-y-auto p-6 pt-2">
            <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              <AnimatePresence>
                {filteredClips.map((clip) => (
                  <motion.div
                    key={clip.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9, filter: "blur(10px)" }}
                    transition={{ duration: 0.3 }}
                    className="glass-card rounded-2xl p-5 flex flex-col group relative overflow-hidden h-[240px]"
                  >
                    {/* Top Bar */}
                    <div className="flex items-center justify-between mb-4 relative z-10">
                      <div className="flex items-center gap-2 bg-white/40 dark:bg-black/40 px-3 py-1.5 rounded-lg backdrop-blur-md">
                        {getIconForType(clip.type)}
                        <span className="text-xs font-semibold capitalize text-gray-700 dark:text-gray-200">
                          {clip.type}
                        </span>
                      </div>
                      <button 
                        onClick={() => toggleStar(clip.id)}
                        className={`p-2 rounded-full transition-colors ${clip.isStarred ? 'text-yellow-500' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-white/30 dark:hover:bg-black/30'}`}
                      >
                        <Star className="w-4 h-4" fill={clip.isStarred ? "currentColor" : "none"} />
                      </button>
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 overflow-hidden relative z-10">
                      {clip.type === 'image' && clip.preview ? (
                        <div className="absolute inset-0 -mx-5 -my-4 pt-16">
                           <img src={clip.preview} alt="preview" className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-700" />
                           <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                        </div>
                      ) : clip.type === 'code' ? (
                        <pre className="text-sm text-gray-800 dark:text-gray-300 font-mono p-3 bg-white/30 dark:bg-black/30 rounded-xl overflow-hidden h-full">
                          <code>{clip.content}</code>
                        </pre>
                      ) : (
                        <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-200 font-medium line-clamp-5">
                          {clip.content}
                        </p>
                      )}
                    </div>

                    {/* Bottom Bar - Appears on Hover for non-images usually, but let's make it always visible or sleekly integrated */}
                    <div className={`mt-4 flex items-center justify-between pt-3 border-t border-white/20 relative z-10 ${clip.type === 'image' ? 'text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                      <span className="text-xs font-medium">
                        {format(clip.timestamp, 'h:mm a')}
                      </span>
                      
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity translate-y-2 group-hover:translate-y-0">
                        <button 
                          onClick={() => handleCopy(clip.id, clip.content)}
                          className="p-2 rounded-lg hover:bg-white/40 dark:hover:bg-black/40 backdrop-blur-md transition-colors"
                          title="Copy"
                        >
                          {copiedId === clip.id ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                        <button className="p-2 rounded-lg hover:bg-white/40 dark:hover:bg-black/40 backdrop-blur-md transition-colors">
                          <Share2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => deleteClip(clip.id)}
                          className="p-2 rounded-lg hover:bg-red-500/20 text-red-500 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
            
            {filteredClips.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                <Search className="w-12 h-12 mb-4" />
                <p className="text-lg font-medium text-gray-900 dark:text-white">No clips found</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">Try a different search term or category</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, count }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void, count?: number }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200
        ${active 
          ? 'bg-white/40 dark:bg-black/40 text-gray-900 dark:text-white shadow-sm backdrop-blur-md' 
          : 'text-gray-600 dark:text-gray-400 hover:bg-white/20 dark:hover:bg-white/5'
        }
      `}
    >
      <div className="flex items-center gap-3">
        <div className={`opacity-80 ${active ? 'opacity-100' : ''}`}>
          {icon}
        </div>
        {label}
      </div>
      {count !== undefined && (
        <span className={`text-xs py-0.5 px-2 rounded-full ${active ? 'bg-white/50 dark:bg-black/50' : 'bg-white/20 dark:bg-white/10'}`}>
          {count}
        </span>
      )}
    </button>
  );
}