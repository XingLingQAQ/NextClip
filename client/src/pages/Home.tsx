import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Copy, Trash2, Plus, Search, Settings, Star, Clock,
  Scissors, Lock, Moon, Sun, Ghost, Send, X,
  RefreshCw, ClipboardPaste, FileText, Link2, Image as ImageIcon,
  Shield, Flame, CheckCircle2, Eye, EyeOff, Type, Users,
  LogIn, Smartphone, Hash, Monitor, LogOut, QrCode
} from "lucide-react";
import { io, Socket } from "socket.io-client";
import type { Clip, RoomMessage } from "@shared/schema";

function detectType(text: string): Clip["type"] {
  if (/^https?:\/\//.test(text.trim())) return "link";
  if (/[{}\[\];]|function\s|const\s|let\s|var\s|import\s|=>/.test(text)) return "code";
  return "text";
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux";
  return "Browser";
}

export default function Home() {
  const [isLocked, setIsLocked] = useState(false);
  const [pin, setPin] = useState("");

  const [roomCode, setRoomCode] = useState(() => localStorage.getItem("cloudclip-room") || "");
  const [roomInput, setRoomInput] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  const [clips, setClips] = useState<Clip[]>([]);
  const [starredIds, setStarredIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem("cloudclip-starred");
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "starred" | Clip["type"]>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isIncognito, setIsIncognito] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [composeText, setComposeText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [composeSettings, setComposeSettings] = useState({ sensitive: false, burn: false });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deviceName = useRef(getDeviceName());

  useEffect(() => {
    localStorage.setItem("cloudclip-starred", JSON.stringify([...starredIds]));
  }, [starredIds]);

  const connectToRoom = useCallback((code: string) => {
    if (!code.trim()) return;
    const trimmed = code.trim();

    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    const socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
      path: "/socket.io",
    });

    socket.on("connect", () => {
      setIsConnected(true);
      socket.emit("join-room", trimmed);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("room-message", (msg: RoomMessage) => {
      switch (msg.type) {
        case "clip:history":
          setClips(msg.clips || []);
          break;
        case "clip:new":
          if (msg.clip) {
            setClips((prev) => [msg.clip!, ...prev]);
          }
          break;
        case "clip:delete":
          if (msg.clipId) {
            setClips((prev) => prev.filter((c) => c.id !== msg.clipId));
          }
          break;
        case "clip:clear":
          setClips([]);
          break;
      }
    });

    socket.on("room-users", (count: number) => {
      setOnlineCount(count);
    });

    socketRef.current = socket;
    setRoomCode(trimmed);
    localStorage.setItem("cloudclip-room", trimmed);
  }, []);

  useEffect(() => {
    if (roomCode) {
      connectToRoom(roomCode);
    }
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  const handleReadClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setComposeText(text);
    } catch {
      alert("Clipboard access denied. Please allow clipboard permissions in your browser settings.");
    }
  };

  const handleCopy = async (id: string, content: string, burn: boolean = false) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      if (burn) {
        setTimeout(() => {
          socketRef.current?.emit("delete-clip", id);
        }, 500);
      }
    } catch {
      alert("Failed to copy. Please allow clipboard permissions.");
    }
  };

  const handleSend = () => {
    if (!composeText.trim() || !socketRef.current) return;
    const type = detectType(composeText);
    socketRef.current.emit("send-clip", {
      content: composeText.trim(),
      type,
      sourceDevice: deviceName.current,
      isSensitive: composeSettings.sensitive,
      burnAfterRead: composeSettings.burn,
    });
    setComposeText("");
    setComposeSettings({ sensitive: false, burn: false });
  };

  const handleSendImage = (dataUrl: string, fileName: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit("send-clip", {
      content: dataUrl,
      type: "image",
      sourceDevice: deviceName.current,
      metadata: fileName,
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          handleSendImage(ev.target.result as string, file.name);
        }
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          setComposeText(ev.target.result as string);
        }
      };
      reader.readAsText(file);
    }
    e.target.value = "";
  };

  const handleDelete = (id: string) => {
    socketRef.current?.emit("delete-clip", id);
  };

  const handleClearAll = () => {
    socketRef.current?.emit("clear-room");
  };

  const handleLeaveRoom = () => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setRoomCode("");
    setClips([]);
    setIsConnected(false);
    setOnlineCount(0);
    localStorage.removeItem("cloudclip-room");
  };

  const handleToggleStar = (id: string) => {
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

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
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (ev.target?.result) {
            handleSendImage(ev.target.result as string, file.name);
          }
        };
        reader.readAsDataURL(file);
        return;
      }
    }
    const text = e.dataTransfer.getData("text/plain");
    if (text) {
      setComposeText(text);
    }
  };

  const filteredClips = clips.filter((clip) => {
    const matchesSearch = clip.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (clip.metadata || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter =
      activeFilter === "all" ? true :
      activeFilter === "starred" ? starredIds.has(clip.id) :
      clip.type === activeFilter;
    return matchesSearch && matchesFilter;
  });

  if (isLocked) {
    return (
      <div className="min-h-screen min-h-[100dvh] p-4 flex items-center justify-center font-sans relative overflow-hidden bg-black/50">
        <div className="absolute inset-0 backdrop-blur-xl z-0" />
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-panel p-8 rounded-3xl w-full max-w-sm z-10 flex flex-col items-center shadow-2xl border border-white/20"
        >
          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-6 shadow-inner">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">App Locked</h2>
          <p className="text-gray-300 text-sm mb-8 text-center">
            Enter your PIN or master password to access your clipboard
          </p>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setIsLocked(false);
            }}
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-center text-white tracking-[0.5em] text-xl outline-none focus:bg-white/20 transition-colors mb-6"
            placeholder="••••"
            data-testid="input-pin"
          />
          <button
            onClick={() => setIsLocked(false)}
            className="w-full py-3 rounded-xl bg-white text-black font-semibold shadow-lg hover:bg-gray-100 transition-colors"
            data-testid="button-unlock"
          >
            Unlock
          </button>
        </motion.div>
      </div>
    );
  }

  if (!roomCode) {
    return (
      <div className="min-h-screen min-h-[100dvh] p-4 flex items-center justify-center font-sans relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-panel p-8 rounded-3xl w-full max-w-sm z-10 flex flex-col items-center shadow-2xl border border-white/20"
        >
          <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-500 to-cyan-400 flex items-center justify-center mb-6 shadow-lg">
            <Scissors className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2" data-testid="text-app-title">CloudClip</h2>
          <p className="text-gray-300 text-sm mb-8 text-center">
            Enter a Room Code to start syncing clipboard across devices
          </p>
          <div className="w-full space-y-4">
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") connectToRoom(roomInput);
                }}
                className="w-full bg-white/10 border border-white/20 rounded-xl pl-10 pr-4 py-3 text-white text-lg outline-none focus:bg-white/20 transition-colors placeholder-gray-400"
                placeholder="e.g. 1234"
                data-testid="input-room-code"
              />
            </div>
            <button
              onClick={() => connectToRoom(roomInput)}
              disabled={!roomInput.trim()}
              className="w-full py-3 rounded-xl bg-white text-black font-semibold shadow-lg hover:bg-gray-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              data-testid="button-join-room"
            >
              <LogIn className="w-5 h-5" /> Join Room
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-0 md:p-4 lg:p-12 flex items-center justify-center font-sans text-gray-900 dark:text-white transition-colors duration-500 overflow-hidden">
      <AnimatePresence>
        {isIncognito && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
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
              <div className={`w-8 h-8 rounded-xl bg-gradient-to-tr ${isIncognito ? "from-purple-500 to-indigo-600" : "from-blue-500 to-cyan-400"} flex items-center justify-center shadow-lg transition-colors`}>
                {isIncognito ? <Ghost className="w-4 h-4 text-white" /> : <Scissors className="w-4 h-4 text-white" />}
              </div>
              <div>
                <h1 className="font-bold text-lg tracking-tight leading-tight">CloudClip</h1>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
                  <span className="opacity-60">Room: {roomCode}</span>
                  {onlineCount > 0 && (
                    <span className="opacity-60 flex items-center gap-0.5">
                      <Users className="w-2.5 h-2.5" /> {onlineCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <nav className="flex-row overflow-x-auto md:flex-col space-y-0 md:space-y-1 flex-none md:flex-1 md:overflow-y-auto pb-1 md:pb-4 scrollbar-hide flex md:block gap-2 items-center -mx-4 px-4 md:mx-0 md:px-0">
            <div className="hidden md:block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-3 mt-4">Library</div>
            <NavItem icon={<Clock />} label="Recent" active={activeFilter === "all"} onClick={() => setActiveFilter("all")} />
            <NavItem icon={<Star />} label="Favorites" active={activeFilter === "starred"} onClick={() => setActiveFilter("starred")} />
            <div className="hidden md:block h-px w-full bg-white/20 my-4" />
            <div className="hidden md:block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-3">Types</div>
            <NavItem icon={<FileText />} label="Texts" active={activeFilter === "text"} onClick={() => setActiveFilter("text")} count={clips.filter((c) => c.type === "text").length} />
            <NavItem icon={<Link2 />} label="Links" active={activeFilter === "link"} onClick={() => setActiveFilter("link")} count={clips.filter((c) => c.type === "link").length} />
            <NavItem icon={<ImageIcon />} label="Images" active={activeFilter === "image"} onClick={() => setActiveFilter("image")} count={clips.filter((c) => c.type === "image").length} />
            <NavItem icon={<Scissors />} label="Snippets" active={activeFilter === "code"} onClick={() => setActiveFilter("code")} count={clips.filter((c) => c.type === "code").length} />
          </nav>

          <div className="hidden md:block mt-4 pt-4 space-y-2 border-t border-white/20 md:mt-auto">
            <div className="flex gap-2">
              <button
                onClick={() => setIsIncognito(!isIncognito)}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-xl transition-all ${isIncognito ? "bg-purple-500/20 text-purple-600 dark:text-purple-400" : "bg-white/10 hover:bg-white/20 text-gray-600 dark:text-gray-300"}`}
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
              <span className="hidden md:inline">Settings & Room</span>
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
              className={`relative rounded-2xl glass-input overflow-hidden transition-all duration-300 ${isDragging ? "ring-2 ring-blue-500 bg-blue-500/10" : ""}`}
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
                  }}
                  placeholder="Type, paste, or drop files here to sync... (Ctrl+Enter to send)"
                  className="w-full bg-transparent resize-none outline-none min-h-[60px] text-sm sm:text-base placeholder-gray-500"
                  data-testid="input-compose"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 p-2 px-3 bg-black/5 dark:bg-white/5 border-t border-white/10">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-lg hover:bg-white/20 text-gray-500 dark:text-gray-400 transition-colors"
                    title="Upload File / Image"
                    data-testid="button-upload-file"
                  >
                    <Plus className="w-4 h-4" />
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept="image/*,text/*,.json,.csv,.md,.js,.ts,.py,.html,.css"
                      onChange={handleFileUpload}
                    />
                  </button>
                  <button
                    onClick={handleReadClipboard}
                    className="p-2 rounded-lg hover:bg-white/20 text-gray-500 dark:text-gray-400 transition-colors"
                    title="Read Local Clipboard"
                    data-testid="button-read-clipboard"
                  >
                    <ClipboardPaste className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setComposeSettings((s) => ({ ...s, sensitive: !s.sensitive }))}
                    className={`p-2 rounded-lg transition-colors ${composeSettings.sensitive ? "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400" : "hover:bg-white/20 text-gray-500 dark:text-gray-400"}`}
                    title="Mark as Sensitive (Masked)"
                    data-testid="button-sensitive"
                  >
                    <Shield className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setComposeSettings((s) => ({ ...s, burn: !s.burn }))}
                    className={`p-2 rounded-lg transition-colors ${composeSettings.burn ? "bg-red-500/20 text-red-600 dark:text-red-400" : "hover:bg-white/20 text-gray-500 dark:text-gray-400"}`}
                    title="Burn After Read"
                    data-testid="button-burn"
                  >
                    <Flame className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {!isConnected && (
                    <span className="text-xs text-red-400 flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin" /> Reconnecting...
                    </span>
                  )}
                  <button
                    onClick={handleSend}
                    disabled={!composeText.trim() || !isConnected}
                    className="bg-blue-600 text-white dark:bg-blue-500 p-1.5 px-4 rounded-lg text-sm font-medium shadow-lg hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 disabled:active:scale-100"
                    data-testid="button-send"
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
                data-testid="input-search"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleClearAll}
                className="text-xs font-medium text-red-500 hover:bg-red-500/10 px-3 py-2 rounded-lg transition-colors"
                data-testid="button-clear-all"
              >
                Clear All
              </button>
            </div>
          </div>

          {/* Grid Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 pt-2">
            <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
              <AnimatePresence mode="popLayout">
                {filteredClips.map((clip) => (
                  <ClipCard
                    key={clip.id}
                    clip={clip}
                    isStarred={starredIds.has(clip.id)}
                    onCopy={(burn) => handleCopy(clip.id, clip.content, burn)}
                    onDelete={() => handleDelete(clip.id)}
                    onToggleStar={() => handleToggleStar(clip.id)}
                    isCopied={copiedId === clip.id}
                  />
                ))}
              </AnimatePresence>
            </motion.div>

            {filteredClips.length === 0 && (
              <div className="h-[40vh] flex flex-col items-center justify-center text-center opacity-50">
                <Search className="w-12 h-12 mb-4" />
                <p className="text-lg font-medium">
                  {clips.length === 0 ? "No clips yet" : "No clips found"}
                </p>
                <p className="text-sm">
                  {clips.length === 0 ? "Send something to get started" : "Try a different search term"}
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Mobile Bottom Bar */}
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 px-4 pt-3 bg-white/80 dark:bg-black/80 backdrop-blur-xl border-t border-white/20 z-40 flex justify-around items-center"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0.75rem))" }}
      >
        <button
          onClick={() => setIsIncognito(!isIncognito)}
          className={`p-3 rounded-xl transition-all ${isIncognito ? "bg-purple-500/20 text-purple-600 dark:text-purple-400" : "text-gray-600 dark:text-gray-300"}`}
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

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/40 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowSettings(false);
            }}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
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
                {/* Connection Section */}
                <section>
                  <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Connection</h3>
                  <div className="space-y-3">
                    <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
                      <div>
                        <div className="font-medium flex items-center gap-2"><Hash className="w-4 h-4 text-blue-500" /> Room Code</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Share this code with other devices</div>
                      </div>
                      <span className="text-lg font-mono font-bold tracking-wider bg-white/20 dark:bg-white/10 px-4 py-1.5 rounded-xl">{roomCode}</span>
                    </div>
                    <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
                      <div>
                        <div className="font-medium flex items-center gap-2"><Users className="w-4 h-4 text-green-500" /> Online Devices</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Devices connected to this room</div>
                      </div>
                      <span className="text-lg font-bold">{onlineCount}</span>
                    </div>
                    <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
                      <div>
                        <div className="font-medium flex items-center gap-2"><Smartphone className="w-4 h-4 text-purple-500" /> This Device</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{deviceName.current}</div>
                      </div>
                      <span className={`text-xs font-medium px-3 py-1.5 rounded-lg ${isConnected ? "bg-green-500/20 text-green-600 dark:text-green-400" : "bg-red-500/20 text-red-600 dark:text-red-400"}`}>
                        {isConnected ? "Connected" : "Disconnected"}
                      </span>
                    </div>
                  </div>
                </section>

                {/* Security Section */}
                <section>
                  <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Security & Privacy</h3>
                  <div className="space-y-3">
                    <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
                      <div>
                        <div className="font-medium flex items-center gap-2"><Shield className="w-4 h-4 text-green-500" /> Sensitive Masking</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Mark clips as sensitive to hide content by default</div>
                      </div>
                      <Shield className="w-5 h-5 text-green-500" />
                    </div>
                    <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
                      <div>
                        <div className="font-medium flex items-center gap-2"><Lock className="w-4 h-4 text-blue-500" /> App Lock</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Require PIN/Password to access on this device</div>
                      </div>
                      <button
                        onClick={() => {
                          setIsLocked(true);
                          setShowSettings(false);
                        }}
                        className="text-xs bg-gray-900 text-white dark:bg-white dark:text-black px-3 py-1.5 rounded-lg font-medium"
                      >
                        Lock Now
                      </button>
                    </div>
                    <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
                      <div>
                        <div className="font-medium flex items-center gap-2"><Flame className="w-4 h-4 text-red-500" /> Burn After Read</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Clips marked burn are deleted after copying</div>
                      </div>
                      <Flame className="w-5 h-5 text-red-500" />
                    </div>
                  </div>
                </section>

                {/* Stats */}
                <section>
                  <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Stats</h3>
                  <div className="glass-card p-4 rounded-2xl">
                    <div className="grid grid-cols-4 gap-4 text-center">
                      <div>
                        <div className="text-2xl font-bold">{clips.length}</div>
                        <div className="text-xs text-gray-500">Total</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold">{clips.filter((c) => c.type === "text").length}</div>
                        <div className="text-xs text-gray-500">Texts</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold">{clips.filter((c) => c.type === "link").length}</div>
                        <div className="text-xs text-gray-500">Links</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold">{clips.filter((c) => c.type === "image").length}</div>
                        <div className="text-xs text-gray-500">Images</div>
                      </div>
                    </div>
                  </div>
                </section>

                <button
                  onClick={() => {
                    handleLeaveRoom();
                    setShowSettings(false);
                  }}
                  className="w-full py-3 rounded-xl bg-red-500/10 text-red-500 font-semibold hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
                  data-testid="button-leave-room-modal"
                >
                  <LogOut className="w-4 h-4" /> Leave Room
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, count }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap flex-none md:w-full flex items-center justify-center md:justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
        ${active
          ? "bg-white/40 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm"
          : "text-gray-600 dark:text-gray-400 hover:bg-white/20 dark:hover:bg-white/5"
        }
      `}
    >
      <div className="flex items-center gap-2 md:gap-3">
        <div className={`opacity-80 ${active ? "opacity-100 text-blue-600 dark:text-blue-400" : ""}`}>{icon}</div>
        <span className="md:inline">{label}</span>
      </div>
      {count !== undefined && (
        <span className={`hidden md:inline-block text-[10px] font-bold py-0.5 px-2 rounded-full ${active ? "bg-white/50 dark:bg-white/20" : "bg-black/5 dark:bg-white/5"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function ClipCard({
  clip,
  isStarred,
  onCopy,
  onDelete,
  onToggleStar,
  isCopied,
}: {
  clip: Clip;
  isStarred: boolean;
  onCopy: (burn?: boolean) => void;
  onDelete: () => void;
  onToggleStar: () => void;
  isCopied: boolean;
}) {
  const [showSensitive, setShowSensitive] = useState(!clip.isSensitive);

  const getIconForType = (type: Clip["type"]) => {
    switch (type) {
      case "text": return <FileText className="w-4 h-4 text-blue-500" />;
      case "link": return <Link2 className="w-4 h-4 text-green-500" />;
      case "image": return <ImageIcon className="w-4 h-4 text-purple-500" />;
      case "code": return <Scissors className="w-4 h-4 text-orange-500" />;
    }
  };

  const formattedTime = new Date(clip.timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const isImage = clip.type === "image" && clip.content.startsWith("data:image");

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: "blur(10px)" }}
      transition={{ duration: 0.3 }}
      className={`glass-card rounded-2xl p-5 flex flex-col group relative overflow-hidden h-[220px] ${clip.burnAfterRead ? "border-red-500/30" : ""}`}
      data-testid={`card-clip-${clip.id}`}
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white/50 dark:bg-black/50 px-2.5 py-1 rounded-lg backdrop-blur-md shadow-sm">
            {getIconForType(clip.type)}
            <span className="text-xs font-semibold capitalize opacity-80">{clip.type}</span>
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
          className={`p-1.5 rounded-full transition-colors ${isStarred ? "text-yellow-500" : "text-gray-400 hover:bg-black/5 dark:hover:bg-white/10"}`}
        >
          <Star className="w-4 h-4" fill={isStarred ? "currentColor" : "none"} />
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative z-10 flex flex-col">
        {isImage ? (
          <div className="absolute inset-0 -mx-5 -my-4 pt-14 pb-12">
            <img src={clip.content} alt={clip.metadata || "image"} className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-700" />
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
        ) : clip.type === "code" ? (
          <pre className="text-xs sm:text-sm font-mono p-3 bg-black/5 dark:bg-black/30 rounded-xl overflow-hidden h-full">
            <code>{clip.content}</code>
          </pre>
        ) : clip.type === "link" ? (
          <a href={clip.content} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline break-all line-clamp-4">
            {clip.content}
          </a>
        ) : (
          <p className="text-sm leading-relaxed font-medium line-clamp-5 whitespace-pre-wrap">{clip.content}</p>
        )}
      </div>

      {/* Bottom Bar */}
      <div className={`mt-3 flex items-center justify-between relative z-10 ${isImage ? "text-white" : "text-gray-500 dark:text-gray-400"}`}>
        <div className="flex flex-col">
          <span className="text-[10px] font-medium opacity-80">{formattedTime}</span>
          <span className="text-[10px] opacity-60 flex items-center gap-1">
            <Smartphone className="w-2.5 h-2.5" /> {clip.sourceDevice}
          </span>
        </div>

        <div className="flex items-center gap-1 bg-white/40 dark:bg-black/40 backdrop-blur-md rounded-xl p-1 shadow-sm opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
          {clip.isSensitive && showSensitive && (
            <button onClick={() => setShowSensitive(false)} className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors" title="Hide">
              <EyeOff className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => onCopy(clip.burnAfterRead)}
            className={`p-1.5 rounded-lg transition-colors flex items-center gap-1 ${isCopied ? "bg-green-500/20 text-green-600 dark:text-green-400" : "hover:bg-black/10 dark:hover:bg-white/10"}`}
            title={clip.burnAfterRead ? "Copy & Burn" : "Copy to Clipboard"}
            data-testid={`button-copy-${clip.id}`}
          >
            {isCopied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-500 transition-colors"
            title="Delete"
            data-testid={`button-delete-${clip.id}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
