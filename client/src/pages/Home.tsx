import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Copy, Trash2, Check, Plus, Image as ImageIcon, 
  FileText, Link2, Search, Settings, Star, Clock, 
  MoreHorizontal, Scissors, Download, Share2,
  Lock, Eye, EyeOff, Flame, Shield, Smartphone, Monitor,
  Moon, Sun, Ghost, Send, X, QrCode, LogOut, CheckCircle2,
  RefreshCw, ClipboardPaste, Maximize2, Type
} from "lucide-react";
import { format } from "date-fns";

// Mock Data Types
type ClipType = 'text' | 'link' | 'image' | 'code';

interface Device {
  id: string;
  name: string;
  type: 'desktop' | 'mobile';
  isOnline: boolean;
  lastActive: Date;
}

interface Clip {
  id: string;
  type: ClipType;
  content: string;
  preview?: string;
  timestamp: Date;
  isStarred: boolean;
  metadata?: string;
  isSensitive?: boolean;
  burnAfterRead?: boolean;
  sourceDevice?: string;
}

const MOCK_DEVICES: Device[] = [
  { id: 'd1', name: 'MacBook Pro (Current)', type: 'desktop', isOnline: true, lastActive: new Date() },
  { id: 'd2', name: 'iPhone 15 Pro', type: 'mobile', isOnline: true, lastActive: new Date() },
  { id: 'd3', name: 'iPad Air', type: 'mobile', isOnline: false, lastActive: new Date(Date.now() - 1000 * 60 * 60 * 24) },
];

const MOCK_CLIPS: Clip[] = [
  {
    id: "1",
    type: "image",
    content: "Design inspiration",
    preview: "/images/background.jpg",
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    isStarred: true,
    metadata: "1920x1080 • 1.2MB",
    sourceDevice: "MacBook Pro"
  },
  {
    id: "2",
    type: "text",
    content: "MySecretPassword123!",
    timestamp: new Date(Date.now() - 1000 * 60 * 30),
    isStarred: false,
    isSensitive: true,
    burnAfterRead: true,
    sourceDevice: "iPhone 15 Pro"
  },
  {
    id: "3",
    type: "link",
    content: "https://replit.com/~",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
    isStarred: true,
    sourceDevice: "MacBook Pro"
  },
  {
    id: "4",
    type: "code",
    content: "const glassmorphism = {\n  backdropFilter: 'blur(16px)'\n};",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5),
    isStarred: false,
    metadata: "JavaScript • 3 lines",
    sourceDevice: "iPad Air"
  }
];

export default function Home() {
  const [isLocked, setIsLocked] = useState(false);
  const [pin, setPin] = useState("");
  
  const [clips, setClips] = useState<Clip[]>(MOCK_CLIPS);
  const [devices, setDevices] = useState<Device[]>(MOCK_DEVICES);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<'all' | 'starred' | ClipType>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  const [isDarkMode, setIsDarkMode] = useState(false);
  // Settings & Modals State
  const [showSettings, setShowSettings] = useState(false);
  const [showPairing, setShowPairing] = useState(false);
  const [showQR, setShowQR] = useState<{show: boolean, content: string}>({show: false, content: ""});
  const [encryptionKey, setEncryptionKey] = useState("my-secret-key-123");
  const [retentionHours, setRetentionHours] = useState("24");

  // Compose State
  const [composeText, setComposeText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [targetDevice, setTargetDevice] = useState<string>("all");
  const [composeSettings, setComposeSettings] = useState({ sensitive: false, burn: false });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Read Local Clipboard
  const handleReadClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setComposeText(text);
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("Read from clipboard", { body: "Pasted content into compose box." });
        }
      }
    } catch (err) {
      console.error('Failed to read clipboard contents: ', err);
    }
  };

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const handleCopy = (id: string, content: string, burn: boolean = false, asPlainText: boolean = false) => {
    // If asPlainText, we would typically strip HTML, but since it's mostly text in mockup, we just write it
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Copied to clipboard", { body: asPlainText ? "Copied as plain text." : "Content successfully copied." });
    }

    if (burn) {
      setTimeout(() => {
        setClips(clips.filter(c => c.id !== id));
      }, 500);
    }
  };

  const handleSend = () => {
    if (!composeText.trim()) return;
    
    // Auto detect link or code
    let type: ClipType = 'text';
    if (composeText.startsWith('http://') || composeText.startsWith('https://')) {
      type = 'link';
    } else if (composeText.includes('{') || composeText.includes('function') || composeText.includes('const ')) {
      type = 'code';
    }

    const newClip: Clip = {
      id: Date.now().toString(),
      type,
      content: composeText,
      timestamp: new Date(),
      isStarred: false,
      isSensitive: composeSettings.sensitive,
      burnAfterRead: composeSettings.burn,
      sourceDevice: "MacBook Pro"
    };

    setClips([newClip, ...clips]);
    setComposeText("");
    setComposeSettings({ sensitive: false, burn: false });

    // Mockup Notification
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Sent to Devices", { body: `Sent to ${targetDevice === 'all' ? 'All Online Devices' : devices.find(d=>d.id===targetDevice)?.name}` });
    } else if ("Notification" in window && Notification.permission !== "denied") {
      Notification.requestPermission();
    }
  };

  // Drag and Drop mockup handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      // Mock uploading image
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const newClip: Clip = {
            id: Date.now().toString(),
            type: 'image',
            content: file.name,
            preview: e.target?.result as string,
            timestamp: new Date(),
            isStarred: false,
            sourceDevice: "MacBook Pro"
          };
          setClips([newClip, ...clips]);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const filteredClips = clips.filter(clip => {
    const matchesSearch = clip.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = 
      activeFilter === 'all' ? true :
      activeFilter === 'starred' ? clip.isStarred :
      clip.type === activeFilter;
    return matchesSearch && matchesFilter;
  });

  if (isLocked) {
    return (
      <div className="min-h-screen min-h-[100dvh] p-4 flex items-center justify-center font-sans relative overflow-hidden bg-black/50">
        <div className="absolute inset-0 backdrop-blur-xl z-0" />
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          className="glass-panel p-8 rounded-3xl w-full max-w-sm z-10 flex flex-col items-center shadow-2xl border border-white/20"
        >
          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-6 shadow-inner">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">App Locked</h2>
          <p className="text-gray-300 text-sm mb-8 text-center">Enter your PIN or master password to access your clipboard</p>
          
          <input 
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setIsLocked(false) }}
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-center text-white tracking-[0.5em] text-xl outline-none focus:bg-white/20 transition-colors mb-6"
            placeholder="••••"
          />
          <button 
            onClick={() => setIsLocked(false)}
            className="w-full py-3 rounded-xl bg-white text-black font-semibold shadow-lg hover:bg-gray-100 transition-colors"
          >
            Unlock
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-0 md:p-4 lg:p-12 flex items-center justify-center font-sans text-gray-900 dark:text-white transition-colors duration-500 overflow-hidden">
      
      {/* Background incognito indicator */}
      <AnimatePresence>
        {isIncognito && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 pointer-events-none z-0 border-[8px] border-purple-500/30 transition-all duration-500"
          />
        )}
      </AnimatePresence>

      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-7xl h-[100dvh] md:h-[90vh] md:rounded-3xl overflow-hidden flex flex-col md:flex-row glass-panel shadow-2xl relative z-10"
      >
        {/* Sidebar */}
        <div className="w-full md:w-64 md:flex-shrink-0 border-b md:border-b-0 md:border-r border-white/20 p-4 md:p-5 flex flex-col bg-white/10 dark:bg-black/20 backdrop-blur-xl">
          <div className="flex items-center justify-between mb-2 md:mb-8 px-2">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-xl bg-gradient-to-tr ${isIncognito ? 'from-purple-500 to-indigo-600' : 'from-blue-500 to-cyan-400'} flex items-center justify-center shadow-lg transition-colors`}>
                {isIncognito ? <Ghost className="w-4 h-4 text-white" /> : <Scissors className="w-4 h-4 text-white" />}
              </div>
              <h1 className="font-bold text-xl tracking-tight">CloudClip</h1>
            </div>
          </div>

          <nav className="flex-row overflow-x-auto md:flex-col space-y-0 md:space-y-1 flex-none md:flex-1 md:overflow-y-auto pb-1 md:pb-4 scrollbar-hide flex md:block gap-2 items-center -mx-4 px-4 md:mx-0 md:px-0">
            <div className="hidden md:block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-3 mt-4">Library</div>
            <NavItem icon={<Clock />} label="Recent" active={activeFilter === 'all'} onClick={() => setActiveFilter('all')} />
            <NavItem icon={<Star />} label="Favorites" active={activeFilter === 'starred'} onClick={() => setActiveFilter('starred')} />
            
            <div className="hidden md:block h-px w-full bg-white/20 my-4" />
            <div className="hidden md:block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-3">Types</div>
            <NavItem icon={<FileText />} label="Texts" active={activeFilter === 'text'} onClick={() => setActiveFilter('text')} count={clips.filter(c => c.type === 'text').length} />
            <NavItem icon={<Link2 />} label="Links" active={activeFilter === 'link'} onClick={() => setActiveFilter('link')} count={clips.filter(c => c.type === 'link').length} />
            <NavItem icon={<ImageIcon />} label="Images" active={activeFilter === 'image'} onClick={() => setActiveFilter('image')} count={clips.filter(c => c.type === 'image').length} />
            <NavItem icon={<Scissors />} label="Snippets" active={activeFilter === 'code'} onClick={() => setActiveFilter('code')} count={clips.filter(c => c.type === 'code').length} />
          </nav>

          <div className="hidden md:block mt-4 pt-4 space-y-2 border-t border-white/20 md:mt-auto">
            <div className="flex gap-2">
              <button 
                onClick={() => setIsIncognito(!isIncognito)}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-xl transition-all ${isIncognito ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400' : 'bg-white/10 hover:bg-white/20 text-gray-600 dark:text-gray-300'}`}
                title="Incognito Mode"
              >
                <Ghost className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="flex-1 flex items-center justify-center py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-600 dark:text-gray-300 transition-all"
                title="Toggle Theme"
              >
                {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button 
                onClick={() => setIsLocked(true)}
                className="flex-1 flex items-center justify-center py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-600 dark:text-gray-300 transition-all"
                title="Lock App"
              >
                <Lock className="w-4 h-4" />
              </button>
            </div>
            <button 
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center md:justify-start gap-3 px-4 py-3 rounded-xl w-full text-sm font-medium bg-white/10 hover:bg-white/20 text-gray-700 dark:text-gray-200 transition-colors"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden md:inline">Settings & Devices</span>
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0 bg-white/5 dark:bg-black/5 pb-[80px] md:pb-0 h-full">
          {/* Header & Compose Area */}
          <header className="p-4 sm:p-6 pb-2">
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative rounded-2xl glass-input overflow-hidden transition-all duration-300 ${isDragging ? 'ring-2 ring-blue-500 bg-blue-500/10' : ''}`}
            >
              {isDragging && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-blue-500/20 backdrop-blur-sm text-blue-600 dark:text-blue-400 font-medium">
                  Drop to upload and send to devices
                </div>
              )}
              
              <div className="p-3">
                <textarea 
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  placeholder="Type, paste, or drop files here to sync..."
                  className="w-full bg-transparent resize-none outline-none min-h-[60px] text-sm sm:text-base placeholder-gray-500"
                />
              </div>
              
              <div className="flex flex-wrap items-center justify-between gap-2 p-2 px-3 bg-black/5 dark:bg-white/5 border-t border-white/10">
                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-lg hover:bg-white/20 text-gray-500 dark:text-gray-400 transition-colors"
                    title="Upload File"
                  >
                    <Plus className="w-4 h-4" />
                    <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => {
                      // Mock handle file
                      if(e.target.files && e.target.files.length > 0) {
                         const file = e.target.files[0];
                         setComposeText(`[File Attached]: ${file.name}`);
                      }
                    }}/>
                  </button>
                  <button 
                    onClick={handleReadClipboard}
                    className="p-2 rounded-lg hover:bg-white/20 text-gray-500 dark:text-gray-400 transition-colors"
                    title="Read Local Clipboard"
                  >
                    <ClipboardPaste className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setComposeSettings(s => ({...s, sensitive: !s.sensitive}))}
                    className={`p-2 rounded-lg transition-colors ${composeSettings.sensitive ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' : 'hover:bg-white/20 text-gray-500 dark:text-gray-400'}`}
                    title="Mark as Sensitive (Masked)"
                  >
                    <Shield className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setComposeSettings(s => ({...s, burn: !s.burn}))}
                    className={`p-2 rounded-lg transition-colors ${composeSettings.burn ? 'bg-red-500/20 text-red-600 dark:text-red-400' : 'hover:bg-white/20 text-gray-500 dark:text-gray-400'}`}
                    title="Burn After Read"
                  >
                    <Flame className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <select 
                    value={targetDevice}
                    onChange={(e) => setTargetDevice(e.target.value)}
                    className="bg-transparent border border-white/20 rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 ring-blue-500 text-gray-700 dark:text-gray-300"
                  >
                    <option value="all" className="text-black">All Devices</option>
                    {devices.filter(d => d.isOnline).map(d => (
                      <option key={d.id} value={d.id} className="text-black">{d.name}</option>
                    ))}
                  </select>
                  <button 
                    onClick={handleSend}
                    disabled={!composeText.trim()}
                    className="bg-blue-600 text-white dark:bg-blue-500 p-1.5 px-4 rounded-lg text-sm font-medium shadow-lg hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 disabled:active:scale-100"
                  >
                    <Send className="w-4 h-4" />
                    <span className="hidden sm:inline">Send</span>
                  </button>
                </div>
              </div>
            </div>
          </header>

          {/* Filter & Search */}
          <div className="px-4 sm:px-6 py-2 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input 
                type="text" 
                placeholder="Search history..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl glass-input text-sm text-gray-800 dark:text-white placeholder-gray-500 outline-none"
              />
            </div>
            
            <div className="flex gap-2">
               <button onClick={() => setClips([])} className="text-xs font-medium text-red-500 hover:bg-red-500/10 px-3 py-2 rounded-lg transition-colors">
                 Clear All
               </button>
            </div>
          </div>

          {/* Grid Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 pt-2">
            <motion.layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
              <AnimatePresence mode="popLayout">
                {filteredClips.map((clip) => (
                  <ClipCard 
                    key={clip.id} 
                    clip={clip} 
                    onCopy={() => handleCopy(clip.id, clip.content, clip.burnAfterRead)}
                    onDelete={() => setClips(clips.filter(c => c.id !== clip.id))}
                    onToggleStar={() => setClips(clips.map(c => c.id === clip.id ? { ...c, isStarred: !c.isStarred } : c))}
                    isCopied={copiedId === clip.id}
                  />
                ))}
              </AnimatePresence>
            </motion.layout>
            
            {filteredClips.length === 0 && (
              <div className="h-[40vh] flex flex-col items-center justify-center text-center opacity-50">
                <Search className="w-12 h-12 mb-4" />
                <p className="text-lg font-medium">No clips found</p>
                <p className="text-sm">Try a different search term or send something new</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Mobile Bottom Bar for Settings/Lock (since hidden in sidebar) */}
      <div 
        className="md:hidden fixed bottom-0 left-0 right-0 px-4 pt-3 bg-white/80 dark:bg-black/80 backdrop-blur-xl border-t border-white/20 z-40 flex justify-around items-center"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))' }}
      >
         <button 
            onClick={() => setIsIncognito(!isIncognito)}
            className={`p-3 rounded-xl transition-all ${isIncognito ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400' : 'text-gray-600 dark:text-gray-300'}`}
          >
            <Ghost className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-3 rounded-xl text-gray-600 dark:text-gray-300 transition-all"
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-3 rounded-xl text-gray-600 dark:text-gray-300 transition-all"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsLocked(true)}
            className="p-3 rounded-xl text-gray-600 dark:text-gray-300 transition-all"
          >
            <Lock className="w-5 h-5" />
          </button>
      </div>

      {/* Settings & Devices Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/40 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="bg-white/80 dark:bg-black/80 backdrop-blur-2xl border border-white/20 w-full max-w-2xl rounded-t-3xl md:rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] md:max-h-[85vh]"
            >
              <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Settings className="w-5 h-5" /> Settings & Network
                </h2>
                <button onClick={() => setShowSettings(false)} className="p-2 rounded-full hover:bg-white/20 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto flex-1 space-y-8">
                
                {/* Security Section */}
                <section>
                  <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Security & Privacy</h3>
                  <div className="space-y-3">
                    <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
                      <div>
                        <div className="font-medium flex items-center gap-2"><Shield className="w-4 h-4 text-green-500" /> End-to-End Encryption</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Data is encrypted locally before syncing</div>
                      </div>
                      <button className="text-xs bg-gray-900 text-white dark:bg-white dark:text-black px-3 py-1.5 rounded-lg font-medium">Manage Key</button>
                    </div>
                    
                    <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
                      <div>
                        <div className="font-medium flex items-center gap-2"><Lock className="w-4 h-4 text-blue-500" /> App Lock</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Require PIN/Password to access on this device</div>
                      </div>
                      <div className="w-10 h-6 bg-blue-500 rounded-full flex items-center p-1 justify-end">
                        <div className="w-4 h-4 bg-white rounded-full"></div>
                      </div>
                    </div>
                    
                    <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
                      <div>
                        <div className="font-medium flex items-center gap-2"><Clock className="w-4 h-4 text-orange-500" /> Data Retention</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Automatically clear unpinned items</div>
                      </div>
                      <select 
                        value={retentionHours}
                        onChange={(e) => setRetentionHours(e.target.value)}
                        className="text-xs bg-black/5 dark:bg-white/10 px-2 py-1.5 rounded-lg font-medium outline-none text-gray-900 dark:text-white"
                      >
                        <option value="1">1 Hour</option>
                        <option value="24">24 Hours</option>
                        <option value="168">7 Days</option>
                        <option value="never">Never</option>
                      </select>
                    </div>
                  </div>
                </section>

                {/* Devices Section */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Connected Devices</h3>
                    <button 
                      onClick={() => setShowPairing(true)}
                      className="text-xs flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium hover:underline"
                    >
                      <QrCode className="w-3 h-3" /> Pair New Device
                    </button>
                  </div>
                  <div className="space-y-2">
                    {devices.map(device => (
                      <div key={device.id} className="glass-card p-3 rounded-2xl flex items-center justify-between group">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-xl ${device.type === 'desktop' ? 'bg-blue-500/10 text-blue-500' : 'bg-green-500/10 text-green-500'}`}>
                            {device.type === 'desktop' ? <Monitor className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
                          </div>
                          <div>
                            <div className="font-medium text-sm flex items-center gap-2">
                              {device.name}
                              {device.name.includes('Current') && <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded-md">This Device</span>}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
                              <span className={`w-2 h-2 rounded-full ${device.isOnline ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                              {device.isOnline ? 'Online' : `Last seen ${format(device.lastActive, 'MMM d, h:mm a')}`}
                            </div>
                          </div>
                        </div>
                        {!device.name.includes('Current') && (
                          <button 
                            onClick={() => setDevices(devices.filter(d => d.id !== device.id))}
                            className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-all" 
                            title="Unbind Device"
                          >
                            <LogOut className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

// Subcomponents
function NavItem({ icon, label, active, onClick, count }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void, count?: number }) {
  return (
    <button 
      onClick={onClick}
      className={`whitespace-nowrap flex-none md:w-full flex items-center justify-center md:justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
        ${active 
          ? 'bg-white/40 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm' 
          : 'text-gray-600 dark:text-gray-400 hover:bg-white/20 dark:hover:bg-white/5'
        }
      `}
    >
      <div className="flex items-center gap-2 md:gap-3">
        <div className={`opacity-80 ${active ? 'opacity-100 text-blue-600 dark:text-blue-400' : ''}`}>
          {icon}
        </div>
        <span className="md:inline">{label}</span>
      </div>
      {count !== undefined && (
        <span className={`hidden md:inline-block text-[10px] font-bold py-0.5 px-2 rounded-full ${active ? 'bg-white/50 dark:bg-white/20' : 'bg-black/5 dark:bg-white/5'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function ClipCard({ clip, onCopy, onDelete, onToggleStar, isCopied }: { clip: Clip, onCopy: (asPlainText?: boolean) => void, onDelete: () => void, onToggleStar: () => void, isCopied: boolean }) {
  const [showSensitive, setShowSensitive] = useState(!clip.isSensitive);

  const getIconForType = (type: ClipType) => {
    switch (type) {
      case 'text': return <FileText className="w-4 h-4 text-blue-500" />;
      case 'link': return <Link2 className="w-4 h-4 text-green-500" />;
      case 'image': return <ImageIcon className="w-4 h-4 text-purple-500" />;
      case 'code': return <Scissors className="w-4 h-4 text-orange-500" />;
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: "blur(10px)" }}
      transition={{ duration: 0.3 }}
      className={`glass-card rounded-2xl p-5 flex flex-col group relative overflow-hidden h-[220px] ${clip.burnAfterRead ? 'border-red-500/30' : ''}`}
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white/50 dark:bg-black/50 px-2.5 py-1 rounded-lg backdrop-blur-md shadow-sm">
            {getIconForType(clip.type)}
            <span className="text-xs font-semibold capitalize opacity-80">
              {clip.type}
            </span>
          </div>
          {clip.isSensitive && (
            <div className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 p-1 rounded-md" title="Sensitive Content">
              <Shield className="w-3 h-3" />
            </div>
          )}
          {clip.burnAfterRead && (
            <div className="bg-red-500/20 text-red-600 dark:text-red-400 p-1 rounded-md" title="Burn After Read">
              <Flame className="w-3 h-3" />
            </div>
          )}
        </div>
        <button 
          onClick={onToggleStar}
          className={`p-1.5 rounded-full transition-colors ${clip.isStarred ? 'text-yellow-500' : 'text-gray-400 hover:bg-black/5 dark:hover:bg-white/10'}`}
        >
          <Star className="w-4 h-4" fill={clip.isStarred ? "currentColor" : "none"} />
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative z-10 flex flex-col">
        {clip.type === 'image' && clip.preview ? (
          <div className="absolute inset-0 -mx-5 -my-4 pt-14 pb-12">
             <img src={clip.preview} alt="preview" className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-700" />
             <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" />
          </div>
        ) : clip.isSensitive && !showSensitive ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <p className="text-2xl tracking-[0.3em] font-mono opacity-50">••••••••</p>
            <button 
              onClick={() => setShowSensitive(true)}
              className="mt-2 text-xs flex items-center gap-1 text-blue-500 hover:underline"
            >
              <Eye className="w-3 h-3" /> Tap to reveal
            </button>
          </div>
        ) : clip.type === 'code' ? (
          <pre className="text-xs sm:text-sm font-mono p-3 bg-black/5 dark:bg-black/30 rounded-xl overflow-hidden h-full">
            <code>{clip.content}</code>
          </pre>
        ) : clip.type === 'link' ? (
          <a href={clip.content} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline break-all line-clamp-4">
            {clip.content}
          </a>
        ) : (
          <p className="text-sm leading-relaxed font-medium line-clamp-5 whitespace-pre-wrap">
            {clip.content}
          </p>
        )}
      </div>

      {/* Bottom Bar */}
      <div className={`mt-3 flex items-center justify-between relative z-10 ${clip.type === 'image' ? 'text-white' : 'text-gray-500 dark:text-gray-400'}`}>
        <div className="flex flex-col">
          <span className="text-[10px] font-medium opacity-80">
            {format(clip.timestamp, 'MMM d, h:mm a')}
          </span>
          <span className="text-[10px] opacity-60 flex items-center gap-1">
            <Smartphone className="w-2.5 h-2.5" /> {clip.sourceDevice}
          </span>
        </div>
        
        <div className="flex items-center gap-1 bg-white/40 dark:bg-black/40 backdrop-blur-md rounded-xl p-1 shadow-sm opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
          <button 
            onClick={() => {
               if ("Notification" in window && Notification.permission === "granted") {
                 new Notification("QR Code Generated", { body: "Ready to scan from other devices." });
               }
            }}
            className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors" title="Generate QR Code"
          >
            <QrCode className="w-4 h-4" />
          </button>
          
          {clip.isSensitive && showSensitive && (
            <button onClick={() => setShowSensitive(false)} className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors" title="Hide">
              <EyeOff className="w-4 h-4" />
            </button>
          )}
          
          {clip.type === 'text' && !clip.isSensitive && (
             <button 
               onClick={() => onCopy(true)}
               className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors" title="Copy as Plain Text"
             >
               <Type className="w-4 h-4" />
             </button>
          )}

          <button 
            onClick={() => onCopy(false)}
            className={`p-1.5 rounded-lg transition-colors flex items-center gap-1 ${isCopied ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'hover:bg-black/10 dark:hover:bg-white/10'}`}
            title={clip.burnAfterRead ? "Copy & Burn" : "Copy"}
          >
            {isCopied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
          <button 
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-500 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}