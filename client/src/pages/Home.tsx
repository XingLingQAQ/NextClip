import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Copy, Trash2, Plus, Search, Settings, Star, Clock,
  Scissors, Lock, Moon, Sun, Ghost, Send, X,
  RefreshCw, ClipboardPaste, FileText, Link2, Image as ImageIcon,
  Shield, Flame, CheckCircle2, Eye, EyeOff, Users,
  LogIn, Smartphone, Hash, LogOut, Download, Maximize2,
  Paperclip, File, User as UserIcon, Timer, Unlock,
  ArrowRight, Globe
} from "lucide-react";
import { io, Socket } from "socket.io-client";
import type { Clip, RoomMessage, Attachment, User } from "@shared/schema";
import { useT, type Lang } from "../i18n";

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function PinInput({ value, onChange, length = 6 }: { value: string; onChange: (v: string) => void; length?: number }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (i: number, raw: string) => {
    const char = raw.replace(/\D/g, "").slice(-1);
    const arr = value.split("");
    while (arr.length < length) arr.push("");
    arr[i] = char;
    const newVal = arr.join("").slice(0, length);
    onChange(newVal);
    if (char && i < length - 1) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !value[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    onChange(pasted);
    const nextIdx = Math.min(pasted.length, length - 1);
    refs.current[nextIdx]?.focus();
  };

  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length }).map((_, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }}
          type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={1}
          value={value[i] || ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className="w-11 h-13 bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/20 rounded-xl text-center text-gray-900 dark:text-white text-xl font-bold outline-none focus:bg-black/10 dark:focus:bg-white/20 focus:border-blue-400 transition-all"
          data-testid={`input-pin-${i}`} />
      ))}
    </div>
  );
}

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <button onClick={() => setLang(lang === "zh" ? "en" : "zh")}
      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
      data-testid="button-lang-toggle">
      <Globe className="w-3.5 h-3.5" />
      <span>{lang === "zh" ? "EN" : "中文"}</span>
    </button>
  );
}

const EXPIRY_OPTIONS_KEYS: Array<{ labelKey: "hour1" | "hours24" | "days7" | "days30" | "permanent"; value: string }> = [
  { labelKey: "hour1", value: "1" },
  { labelKey: "hours24", value: "24" },
  { labelKey: "days7", value: "168" },
  { labelKey: "days30", value: "720" },
  { labelKey: "permanent", value: "permanent" },
];

export default function Home() {
  const { t, lang, setLang } = useT();

  const [isLocked, setIsLocked] = useState(false);
  const [lockPin, setLockPin] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem("cloudclip-onboarded"));
  const [onboardingStep, setOnboardingStep] = useState(0);

  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem("cloudclip-user");
    return saved ? JSON.parse(saved) : null;
  });

  const [roomCode, setRoomCode] = useState(() => localStorage.getItem("cloudclip-room") || "");
  const [roomInput, setRoomInput] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);
  const [needPassword, setNeedPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [pendingRoomCode, setPendingRoomCode] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const roomTokenRef = useRef<string>("");

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
  const [composeAttachments, setComposeAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [composeSettings, setComposeSettings] = useState({ sensitive: false, burn: false });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deviceName = useRef(getDeviceName());

  const [detailClip, setDetailClip] = useState<Clip | null>(null);
  const [detailEditContent, setDetailEditContent] = useState("");
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);

  useEffect(() => {
    localStorage.setItem("cloudclip-starred", JSON.stringify([...starredIds]));
  }, [starredIds]);

  const connectSocket = useCallback((code: string, token?: string) => {
    if (token) roomTokenRef.current = token;
    if (socketRef.current) socketRef.current.disconnect();
    const socket = io(window.location.origin, { transports: ["websocket", "polling"], path: "/socket.io" });
    socket.on("connect", () => { setIsConnected(true); socket.emit("join-room", { roomCode: code, token: roomTokenRef.current }); });
    socket.on("disconnect", () => setIsConnected(false));
    socket.on("room-error", () => { handleLeaveRoom(); });
    socket.on("room-message", (msg: RoomMessage) => {
      switch (msg.type) {
        case "clip:history": setClips(msg.clips || []); break;
        case "clip:new": if (msg.clip) setClips((p) => [msg.clip!, ...p]); break;
        case "clip:delete": if (msg.clipId) setClips((p) => p.filter((c) => c.id !== msg.clipId)); break;
        case "clip:clear": setClips([]); break;
        case "clip:update": if (msg.clip) setClips((p) => p.map((c) => c.id === msg.clip!.id ? msg.clip! : c)); break;
      }
    });
    socket.on("room-users", (count: number) => setOnlineCount(count));
    socketRef.current = socket;
  }, []);

  const handleJoinRoom = async () => {
    const code = roomInput.trim();
    if (!code) return;
    setJoining(true);
    setJoinError("");

    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser?.id }),
      });

      const data = await res.json();

      if (res.status === 401 && data.needPassword) {
        setPendingRoomCode(code);
        setNeedPassword(true);
        setPasswordInput("");
        setPasswordError("");
        setJoining(false);
        return;
      }

      if (!res.ok) {
        setJoinError(data.message || t("failedJoinRoom"));
        setJoining(false);
        return;
      }

      setRoomCode(code);
      localStorage.setItem("cloudclip-room", code);
      localStorage.removeItem("cloudclip-room-pwd");
      localStorage.setItem("cloudclip-room-token", data.token);
      connectSocket(code, data.token);
    } catch {
      setJoinError(t("networkError"));
    }
    setJoining(false);
  };

  const handlePasswordSubmit = async () => {
    if (passwordInput.length !== 6) return;
    setJoining(true);
    setPasswordError("");
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(pendingRoomCode)}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      });
      if (!res.ok) {
        const data = await res.json();
        setPasswordError(data.message || t("incorrectPassword"));
        setPasswordInput("");
        setJoining(false);
        return;
      }
      const data = await res.json();
      setRoomCode(pendingRoomCode);
      localStorage.setItem("cloudclip-room", pendingRoomCode);
      localStorage.setItem("cloudclip-room-pwd", passwordInput);
      localStorage.setItem("cloudclip-room-token", data.token);
      setNeedPassword(false);
      setPendingRoomCode("");
      connectSocket(pendingRoomCode, data.token);
    } catch {
      setPasswordError(t("networkError"));
    }
    setJoining(false);
  };

  useEffect(() => {
    if (roomCode) {
      const savedPwd = localStorage.getItem("cloudclip-room-pwd") || "";
      const savedToken = localStorage.getItem("cloudclip-room-token") || "";
      if (savedToken) {
        roomTokenRef.current = savedToken;
        connectSocket(roomCode, savedToken);
      } else {
        fetch(`/api/rooms/${encodeURIComponent(roomCode)}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: savedPwd || undefined }),
        }).then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            localStorage.setItem("cloudclip-room-token", data.token);
            connectSocket(roomCode, data.token);
          } else {
            const data = await res.json();
            if (data.needPassword) {
              setPendingRoomCode(roomCode);
              setNeedPassword(true);
              setRoomCode("");
              localStorage.removeItem("cloudclip-room");
            } else {
              setRoomCode("");
              localStorage.removeItem("cloudclip-room");
              localStorage.removeItem("cloudclip-room-pwd");
            }
          }
        }).catch(() => {});
      }
    }
    return () => { socketRef.current?.disconnect(); };
  }, []);

  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [isDarkMode]);

  const handleReadClipboard = async () => {
    try { const text = await navigator.clipboard.readText(); if (text) setComposeText(text); }
    catch { alert(t("clipboardDenied")); }
  };

  const handleCopy = async (id: string, content: string, burn: boolean = false) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      if (burn) setTimeout(() => socketRef.current?.emit("delete-clip", id), 500);
    } catch { alert(t("failedCopy")); }
  };

  const handleSend = () => {
    if ((!composeText.trim() && composeAttachments.length === 0) || !socketRef.current) return;
    let type: Clip["type"] = "text";
    if (composeAttachments.length > 0 && composeText.trim()) type = "mixed";
    else if (composeAttachments.length > 0) {
      type = composeAttachments[0].mimeType.startsWith("image/") ? "image" : "file";
    } else type = detectType(composeText);

    socketRef.current.emit("send-clip", {
      content: composeText.trim(), type, sourceDevice: deviceName.current,
      isSensitive: composeSettings.sensitive, burnAfterRead: composeSettings.burn,
      attachments: composeAttachments.length > 0 ? composeAttachments : undefined,
    });
    setComposeText("");
    setComposeAttachments([]);
    setComposeSettings({ sensitive: false, burn: false });
  };

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          setComposeAttachments((prev) => [...prev, {
            name: file.name, mimeType: file.type || "application/octet-stream",
            data: ev.target!.result as string, size: file.size,
          }]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleDelete = (id: string) => socketRef.current?.emit("delete-clip", id);
  const handleClearAll = () => socketRef.current?.emit("clear-room");

  const handleLeaveRoom = () => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setRoomCode("");
    setClips([]);
    setIsConnected(false);
    setOnlineCount(0);
    localStorage.removeItem("cloudclip-room");
    localStorage.removeItem("cloudclip-room-pwd");
    localStorage.removeItem("cloudclip-room-token");
    roomTokenRef.current = "";
  };

  const handleToggleStar = (id: string) => {
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSaveEdit = () => {
    if (!detailClip || !socketRef.current) return;
    socketRef.current.emit("update-clip", { clipId: detailClip.id, content: detailEditContent, type: detectType(detailEditContent) });
    setDetailClip(null);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files?.length) { handleFileSelect(e.dataTransfer.files); return; }
    const text = e.dataTransfer.getData("text/plain");
    if (text) setComposeText(text);
  };

  const filteredClips = clips.filter((clip) => {
    const searchTarget = (clip.content + " " + (clip.metadata || "") + (clip.attachments?.map((a) => a.name).join(" ") || "")).toLowerCase();
    const matchesSearch = searchTarget.includes(searchQuery.toLowerCase());
    const matchesFilter = activeFilter === "all" ? true : activeFilter === "starred" ? starredIds.has(clip.id) : clip.type === activeFilter;
    return matchesSearch && matchesFilter;
  });

  // ==================== LOCK SCREEN ====================
  if (isLocked) {
    return (
      <div className="min-h-screen min-h-[100dvh] p-4 flex items-center justify-center font-sans relative overflow-hidden bg-black/50">
        <div className="absolute inset-0 backdrop-blur-xl z-0" />
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          className="glass-panel p-8 rounded-3xl w-full max-w-sm z-10 flex flex-col items-center shadow-2xl border border-white/20">
          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-6 shadow-inner">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">{t("appLocked")}</h2>
          <p className="text-gray-300 text-sm mb-8 text-center">{t("enterPin")}</p>
          <input type="password" value={lockPin} onChange={(e) => setLockPin(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setIsLocked(false); }}
            className="w-full bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/20 rounded-xl px-4 py-3 text-center text-gray-900 dark:text-white tracking-[0.5em] text-xl outline-none focus:bg-black/10 dark:focus:bg-white/20 transition-colors mb-6"
            placeholder="••••" data-testid="input-lock-pin" />
          <button onClick={() => setIsLocked(false)}
            className="w-full py-3 rounded-xl bg-white text-black font-semibold shadow-lg hover:bg-gray-100 transition-colors"
            data-testid="button-unlock">{t("unlock")}</button>
        </motion.div>
      </div>
    );
  }

  // ==================== PASSWORD PROMPT MODAL ====================
  if (needPassword) {
    return (
      <div className="min-h-screen min-h-[100dvh] p-4 flex items-center justify-center font-sans relative overflow-hidden">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          className="glass-panel p-8 rounded-3xl w-full max-w-sm z-10 flex flex-col items-center shadow-2xl border border-white/20">
          <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-yellow-500 to-orange-400 flex items-center justify-center mb-6 shadow-lg">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2" data-testid="text-password-title">{t("roomPassword")}</h2>
          <p className="text-gray-300 text-sm mb-2 text-center">
            <span className="font-mono font-bold text-white">{pendingRoomCode}</span> {t("roomProtected")}
          </p>
          <p className="text-gray-400 text-xs mb-6 text-center">{t("enter6Digit")}</p>

          <div className="mb-4">
            <PinInput value={passwordInput} onChange={(v) => {
              setPasswordInput(v);
              setPasswordError("");
            }} />
          </div>

          {passwordError && <p className="text-red-400 text-xs text-center mb-4">{passwordError}</p>}

          <button onClick={handlePasswordSubmit}
            disabled={passwordInput.length !== 6 || joining}
            className="w-full py-3 rounded-xl bg-white text-black font-semibold shadow-lg hover:bg-gray-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 mb-3"
            data-testid="button-submit-password">
            {joining ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Unlock className="w-5 h-5" />}
            {joining ? t("verifying") : t("unlockRoom")}
          </button>

          <button onClick={() => { setNeedPassword(false); setPendingRoomCode(""); setPasswordInput(""); }}
            className="text-sm text-gray-400 hover:text-white transition-colors">
            {t("back")}
          </button>
          <div className="mt-4"><LangToggle lang={lang} setLang={setLang} /></div>
        </motion.div>
      </div>
    );
  }

  // ==================== ROOM JOIN SCREEN (with interactive onboarding) ====================
  if (!roomCode) {
    const finishOnboarding = () => { localStorage.setItem("cloudclip-onboarded", "1"); setShowOnboarding(false); };
    return (
      <div className="min-h-screen min-h-[100dvh] p-4 flex items-center justify-center font-sans relative overflow-hidden">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          className="glass-panel p-8 rounded-3xl w-full max-w-sm z-10 flex flex-col items-center shadow-2xl border border-white/20 relative">
          <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-500 to-cyan-400 flex items-center justify-center mb-6 shadow-lg">
            <Scissors className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2" data-testid="text-app-title">CloudClip</h2>
          <p className="text-gray-500 dark:text-gray-300 text-sm mb-6 text-center">
            {t("enterRoomCode")}
          </p>

          <div className="w-full space-y-3">
            <div className="relative" data-testid="onboard-target-input">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input type="text" value={roomInput} onChange={(e) => setRoomInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleJoinRoom(); }}
                className="w-full bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/20 rounded-xl pl-10 pr-4 py-3 text-gray-900 dark:text-white text-lg outline-none focus:bg-black/10 dark:focus:bg-white/20 transition-colors placeholder-gray-400"
                placeholder={t("roomCode")} data-testid="input-room-code" />

              {showOnboarding && onboardingStep === 0 && (
                <OnboardingTooltip position="bottom" step={1} total={2}
                  title={t("onboard1Title")} desc={t("onboard1Desc")}
                  onNext={() => setOnboardingStep(1)} onSkip={finishOnboarding} t={t} />
              )}
            </div>

            {joinError && <p className="text-red-400 text-xs text-center">{joinError}</p>}

            <div className="relative" data-testid="onboard-target-join">
              <button onClick={handleJoinRoom}
                disabled={!roomInput.trim() || joining}
                className="w-full py-3 rounded-xl bg-white text-black font-semibold shadow-lg hover:bg-gray-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                data-testid="button-join-room">
                {joining ? <RefreshCw className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
                {joining ? t("joining") : t("joinRoom")}
              </button>

              {showOnboarding && onboardingStep === 1 && (
                <OnboardingTooltip position="bottom" step={2} total={2}
                  title={t("onboard2Title")} desc={t("onboard2Desc")}
                  onNext={finishOnboarding} onSkip={finishOnboarding} isLast t={t} />
              )}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/10 w-full text-center">
            {currentUser ? (
              <div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-300">
                <UserIcon className="w-4 h-4 text-blue-400" />
                <span className="font-medium text-gray-900 dark:text-white">{currentUser.username}</span>
                <button onClick={() => { setCurrentUser(null); localStorage.removeItem("cloudclip-user"); }}
                  className="text-xs text-gray-500 hover:text-red-400 ml-1 transition-colors">{t("logOut")}</button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3 text-sm">
                <a href="/login" className="text-blue-400 hover:text-blue-300 font-medium transition-colors" data-testid="link-login">{t("logIn")}</a>
                <span className="text-gray-600">|</span>
                <a href="/register" className="text-blue-400 hover:text-blue-300 font-medium transition-colors" data-testid="link-register">{t("signUp")}</a>
              </div>
            )}
          </div>
          <div className="mt-3"><LangToggle lang={lang} setLang={setLang} /></div>
        </motion.div>
      </div>
    );
  }

  // ==================== MAIN APP ====================
  const mainOnboardFinish = () => { localStorage.setItem("cloudclip-onboarded", "1"); setShowOnboarding(false); };
  return (
    <div className="min-h-screen p-0 md:p-4 lg:p-12 flex items-center justify-center font-sans text-gray-900 dark:text-white transition-colors duration-500 overflow-hidden">
      <AnimatePresence>
        {isIncognito && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 pointer-events-none z-0 border-[8px] border-purple-500/30" />
        )}
      </AnimatePresence>

      <motion.div initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-7xl h-[100dvh] md:h-[90vh] md:rounded-3xl overflow-hidden flex flex-col md:flex-row glass-panel shadow-2xl relative z-10">

        {/* ===== Sidebar ===== */}
        <div className="w-full md:w-64 md:flex-shrink-0 border-b md:border-b-0 md:border-r border-white/20 p-4 md:p-5 flex flex-col bg-white/10 dark:bg-black/20 backdrop-blur-xl">
          <div className="flex items-center justify-between mb-2 md:mb-8 px-2">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-xl bg-gradient-to-tr ${isIncognito ? "from-purple-500 to-indigo-600" : "from-blue-500 to-cyan-400"} flex items-center justify-center shadow-lg`}>
                {isIncognito ? <Ghost className="w-4 h-4 text-white" /> : <Scissors className="w-4 h-4 text-white" />}
              </div>
              <div>
                <h1 className="font-bold text-lg tracking-tight leading-tight">CloudClip</h1>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
                  <span className="opacity-60">{t("room")}: {roomCode}</span>
                  {onlineCount > 0 && <span className="opacity-60 flex items-center gap-0.5"><Users className="w-2.5 h-2.5" /> {onlineCount}</span>}
                </div>
              </div>
            </div>
          </div>

          <nav className="flex-row overflow-x-auto md:flex-col space-y-0 md:space-y-1 flex-none md:flex-1 md:overflow-y-auto pb-1 md:pb-4 scrollbar-hide flex md:block gap-2 items-center -mx-4 px-4 md:mx-0 md:px-0">
            <div className="hidden md:block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-3 mt-4">{t("library")}</div>
            <NavItem icon={<Clock />} label={t("recent")} active={activeFilter === "all"} onClick={() => setActiveFilter("all")} />
            <NavItem icon={<Star />} label={t("favorites")} active={activeFilter === "starred"} onClick={() => setActiveFilter("starred")} />
            <div className="hidden md:block h-px w-full bg-white/20 my-4" />
            <div className="hidden md:block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-3">{t("types")}</div>
            <NavItem icon={<FileText />} label={t("texts")} active={activeFilter === "text"} onClick={() => setActiveFilter("text")} count={clips.filter((c) => c.type === "text").length} />
            <NavItem icon={<Link2 />} label={t("links")} active={activeFilter === "link"} onClick={() => setActiveFilter("link")} count={clips.filter((c) => c.type === "link").length} />
            <NavItem icon={<ImageIcon />} label={t("images")} active={activeFilter === "image"} onClick={() => setActiveFilter("image")} count={clips.filter((c) => c.type === "image").length} />
            <NavItem icon={<File />} label={t("files")} active={activeFilter === "file"} onClick={() => setActiveFilter("file")} count={clips.filter((c) => c.type === "file").length} />
            <NavItem icon={<Scissors />} label={t("mixed")} active={activeFilter === "mixed"} onClick={() => setActiveFilter("mixed")} count={clips.filter((c) => c.type === "mixed").length} />
          </nav>

          <div className="hidden md:block mt-4 pt-4 space-y-2 border-t border-white/20 md:mt-auto">
            {currentUser && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400">
                <UserIcon className="w-3.5 h-3.5 text-blue-400" />
                <span className="font-medium text-white/80">{currentUser.username}</span>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setIsIncognito(!isIncognito)}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-xl transition-all ${isIncognito ? "bg-purple-500/20 text-purple-600 dark:text-purple-400" : "bg-white/10 hover:bg-white/20 text-gray-600 dark:text-gray-300"}`}
                title={t("incognitoMode")}><Ghost className="w-4 h-4" /></button>
              <button onClick={() => setIsDarkMode(!isDarkMode)}
                className="flex-1 flex items-center justify-center py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-600 dark:text-gray-300 transition-all"
                title={t("toggleTheme")}>{isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>
            </div>
            <div className="relative" data-testid="onboard-target-settings">
              <button onClick={() => setShowSettings(true)}
                className="flex items-center justify-center md:justify-start gap-3 px-4 py-3 rounded-xl w-full text-sm font-medium bg-white/10 hover:bg-white/20 text-gray-700 dark:text-gray-200 transition-colors">
                <Settings className="w-4 h-4" /><span className="hidden md:inline">{t("settingsRoom")}</span>
              </button>
              {showOnboarding && onboardingStep === 2 && (
                <OnboardingTooltip position="top" step={3} total={3}
                  title={t("onboard5Title")} desc={t("onboard5Desc")}
                  onNext={mainOnboardFinish} onSkip={mainOnboardFinish} isLast t={t} />
              )}
            </div>
          </div>
        </div>

        {/* ===== Main Content ===== */}
        <div className="flex-1 flex flex-col min-w-0 bg-white/5 dark:bg-black/5 pb-[80px] md:pb-0 h-full">
          <header className="p-4 sm:p-6 pb-2">
            <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
              className={`relative rounded-2xl glass-input overflow-hidden transition-all duration-300 ${isDragging ? "ring-2 ring-blue-500 bg-blue-500/10" : ""}`}
              data-testid="onboard-target-compose">
              {isDragging && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-blue-500/20 backdrop-blur-sm text-blue-600 dark:text-blue-400 font-medium">
                  {t("dropHere")}
                </div>
              )}
              <div className="p-3">
                <textarea value={composeText} onChange={(e) => setComposeText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(); }}
                  placeholder={t("composeHint")}
                  className="w-full bg-transparent resize-none outline-none min-h-[50px] text-sm sm:text-base placeholder-gray-500"
                  data-testid="input-compose" />

                {composeAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-white/10">
                    {composeAttachments.map((att, i) => (
                      <div key={i} className="relative group/att flex items-center gap-2 bg-white/10 rounded-lg p-2 pr-8">
                        {att.mimeType.startsWith("image/") ? (
                          <img src={att.data} alt={att.name} className="w-12 h-12 rounded object-cover" />
                        ) : (
                          <div className="w-12 h-12 rounded bg-white/10 flex items-center justify-center"><File className="w-6 h-6 text-gray-400" /></div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate max-w-[120px]">{att.name}</p>
                          <p className="text-[10px] opacity-60">{formatFileSize(att.size)}</p>
                        </div>
                        <button onClick={() => setComposeAttachments((prev) => prev.filter((_, j) => j !== i))}
                          className="absolute top-1 right-1 p-0.5 rounded-full bg-black/20 hover:bg-red-500/30 transition-colors"><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 p-2 px-3 bg-black/5 dark:bg-white/5 border-t border-white/10">
                <div className="flex items-center gap-1">
                  <button onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-lg hover:bg-white/20 text-gray-500 dark:text-gray-400 transition-colors" title={t("uploadFile")} data-testid="button-upload-file">
                    <Plus className="w-4 h-4" />
                    <input type="file" ref={fileInputRef} className="hidden" multiple onChange={(e) => { handleFileSelect(e.target.files); e.target.value = ""; }} />
                  </button>
                  <button onClick={handleReadClipboard} className="p-2 rounded-lg hover:bg-white/20 text-gray-500 dark:text-gray-400 transition-colors" title={t("readClipboard")} data-testid="button-read-clipboard">
                    <ClipboardPaste className="w-4 h-4" />
                  </button>
                  <button onClick={() => setComposeSettings((s) => ({ ...s, sensitive: !s.sensitive }))}
                    className={`p-2 rounded-lg transition-colors ${composeSettings.sensitive ? "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400" : "hover:bg-white/20 text-gray-500 dark:text-gray-400"}`}
                    title={t("sensitive")} data-testid="button-sensitive"><Shield className="w-4 h-4" /></button>
                  <button onClick={() => setComposeSettings((s) => ({ ...s, burn: !s.burn }))}
                    className={`p-2 rounded-lg transition-colors ${composeSettings.burn ? "bg-red-500/20 text-red-600 dark:text-red-400" : "hover:bg-white/20 text-gray-500 dark:text-gray-400"}`}
                    title={t("burnAfterRead")} data-testid="button-burn"><Flame className="w-4 h-4" /></button>
                </div>
                <div className="flex items-center gap-2">
                  {!isConnected && <span className="text-xs text-red-400 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> {t("reconnecting")}</span>}
                  <div className="relative" data-testid="onboard-target-send">
                    <button onClick={handleSend}
                      disabled={(!composeText.trim() && composeAttachments.length === 0) || !isConnected}
                      className="bg-blue-600 text-white dark:bg-blue-500 p-1.5 px-4 rounded-lg text-sm font-medium shadow-lg hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                      data-testid="button-send"><Send className="w-4 h-4" /><span className="hidden sm:inline">{t("send")}</span></button>
                    {showOnboarding && onboardingStep === 1 && (
                      <OnboardingTooltip position="bottom" step={2} total={3}
                        title={t("onboard4Title")} desc={t("onboard4Desc")}
                        onNext={() => setOnboardingStep(2)} onSkip={mainOnboardFinish} t={t} />
                    )}
                  </div>
                </div>
              </div>

              {showOnboarding && onboardingStep === 0 && (
                <OnboardingTooltip position="bottom" step={1} total={3}
                  title={t("onboard3Title")} desc={t("onboard3Desc")}
                  onNext={() => setOnboardingStep(1)} onSkip={mainOnboardFinish} t={t}
                  className="absolute left-4 right-4 bottom-[-140px] z-30" />
              )}
            </div>
          </header>

          <div className="px-4 sm:px-6 py-2 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input type="text" placeholder={t("searchHistory")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl glass-input text-sm text-gray-800 dark:text-white placeholder-gray-500 outline-none" data-testid="input-search" />
            </div>
            <button onClick={handleClearAll} className="text-xs font-medium text-red-500 hover:bg-red-500/10 px-3 py-2 rounded-lg transition-colors" data-testid="button-clear-all">{t("clearAll")}</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 pt-2">
            <motion.div layout className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
              <AnimatePresence mode="popLayout">
                {filteredClips.map((clip) => (
                  <ClipCard key={clip.id} clip={clip} isStarred={starredIds.has(clip.id)}
                    onCopy={(burn) => handleCopy(clip.id, clip.content, burn)}
                    onDelete={() => handleDelete(clip.id)}
                    onToggleStar={() => handleToggleStar(clip.id)}
                    onOpenDetail={() => { setDetailClip(clip); setDetailEditContent(clip.content); }}
                    onPreviewAttachment={(att) => setPreviewAttachment(att)}
                    isCopied={copiedId === clip.id} t={t} />
                ))}
              </AnimatePresence>
            </motion.div>
            {filteredClips.length === 0 && (
              <div className="h-[40vh] flex flex-col items-center justify-center text-center opacity-50">
                <Search className="w-12 h-12 mb-4" />
                <p className="text-lg font-medium">{clips.length === 0 ? t("noClips") : t("noClipsFound")}</p>
                <p className="text-sm">{clips.length === 0 ? t("sendToStart") : t("tryDifferent")}</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Mobile Bottom Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 px-4 pt-3 bg-white/80 dark:bg-black/80 backdrop-blur-xl border-t border-white/20 z-40 flex justify-around items-center"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0.75rem))" }}>
        <button onClick={() => setIsIncognito(!isIncognito)}
          className={`p-3 rounded-xl transition-all ${isIncognito ? "bg-purple-500/20 text-purple-600 dark:text-purple-400" : "text-gray-600 dark:text-gray-300"}`}><Ghost className="w-5 h-5" /></button>
        <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-3 rounded-xl text-gray-600 dark:text-gray-300">
          {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</button>
        <button onClick={() => setShowSettings(true)} className="p-3 rounded-xl text-gray-600 dark:text-gray-300"><Settings className="w-5 h-5" /></button>
      </div>

      {/* Detail / Edit Modal */}
      <AnimatePresence>
        {detailClip && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setDetailClip(null); }}>
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-2xl border border-white/20 w-full max-w-2xl rounded-t-3xl md:rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
              <div className="p-5 border-b border-white/10 flex justify-between items-center">
                <h2 className="text-lg font-bold flex items-center gap-2"><Maximize2 className="w-5 h-5" /> {t("clipDetail")}</h2>
                <div className="flex items-center gap-2">
                  <button onClick={handleSaveEdit} className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg font-medium hover:bg-blue-700 transition-colors">{t("save")}</button>
                  <button onClick={() => setDetailClip(null)} className="p-2 rounded-full hover:bg-white/20 transition-colors"><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="p-5 overflow-y-auto flex-1 space-y-4">
                <div className="text-xs text-gray-500 flex items-center gap-4">
                  <span className="flex items-center gap-1"><Smartphone className="w-3 h-3" /> {detailClip.sourceDevice}</span>
                  <span>{new Date(detailClip.timestamp).toLocaleString()}</span>
                  <span className="capitalize bg-white/20 dark:bg-white/10 px-2 py-0.5 rounded">{detailClip.type}</span>
                </div>
                <textarea value={detailEditContent} onChange={(e) => setDetailEditContent(e.target.value)}
                  className={`w-full bg-black/5 dark:bg-black/30 rounded-xl p-4 text-sm outline-none resize-y ${detailClip.type === "code" ? "font-mono min-h-[300px]" : "min-h-[200px]"}`} />
                {detailClip.attachments && detailClip.attachments.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{t("attachments")}</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {detailClip.attachments.map((att, i) => (
                        <div key={i} className="glass-card rounded-xl p-3 flex flex-col items-center gap-2">
                          {att.mimeType.startsWith("image/") ? (
                            <img src={att.data} alt={att.name} className="w-full h-32 object-contain rounded-lg cursor-pointer" onClick={() => setPreviewAttachment(att)} />
                          ) : (
                            <div className="w-full h-32 flex items-center justify-center bg-white/5 rounded-lg cursor-pointer"
                              onClick={() => { if (att.mimeType.startsWith("text/") || att.name.match(/\.(json|csv|md|txt|js|ts|py|html|css)$/i)) setPreviewAttachment(att); }}>
                              <File className="w-10 h-10 text-gray-400" />
                            </div>
                          )}
                          <p className="text-xs font-medium truncate w-full text-center">{att.name}</p>
                          <p className="text-[10px] opacity-60">{formatFileSize(att.size)}</p>
                          <button onClick={() => downloadDataUrl(att.data, att.name)}
                            className="w-full text-xs bg-blue-600/20 text-blue-600 dark:text-blue-400 py-1.5 rounded-lg font-medium hover:bg-blue-600/30 flex items-center justify-center gap-1">
                            <Download className="w-3 h-3" /> {t("download")}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachment Preview Modal */}
      <AnimatePresence>
        {previewAttachment && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
            onClick={() => setPreviewAttachment(null)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-2xl border border-white/20 rounded-3xl overflow-hidden shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}>
              <div className="p-4 border-b border-white/10 flex justify-between items-center">
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold truncate">{previewAttachment.name}</h3>
                  <p className="text-xs text-gray-500">{formatFileSize(previewAttachment.size)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => downloadDataUrl(previewAttachment.data, previewAttachment.name)}
                    className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg font-medium hover:bg-blue-700 flex items-center gap-1">
                    <Download className="w-4 h-4" /> {t("download")}
                  </button>
                  <button onClick={() => setPreviewAttachment(null)} className="p-2 rounded-full hover:bg-white/20"><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4">
                {previewAttachment.mimeType.startsWith("image/") ? (
                  <img src={previewAttachment.data} alt={previewAttachment.name} className="max-w-full max-h-[70vh] mx-auto rounded-lg" />
                ) : (
                  <pre className="text-sm font-mono whitespace-pre-wrap p-4 bg-black/5 dark:bg-black/30 rounded-xl overflow-auto max-h-[70vh]">
                    {atob(previewAttachment.data.split(",")[1] || "")}
                  </pre>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <SettingsModal
            roomCode={roomCode}
            onlineCount={onlineCount}
            clips={clips}
            currentUser={currentUser}
            roomToken={roomTokenRef.current}
            onClose={() => setShowSettings(false)}
            onLeave={() => { handleLeaveRoom(); setShowSettings(false); }}
            lang={lang}
            setLang={setLang}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ==================== Onboarding Tooltip ====================
function OnboardingTooltip({ position, step, total, title, desc, onNext, onSkip, isLast, className, t }: {
  position: "top" | "bottom"; step: number; total: number;
  title: string; desc: string;
  onNext: () => void; onSkip: () => void; isLast?: boolean;
  className?: string;
  t: (key: any) => string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: position === "bottom" ? -8 : 8 }}
      animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      className={className || `absolute ${position === "bottom" ? "top-full mt-3" : "bottom-full mb-3"} left-0 right-0 z-50`}>
      <div className={`absolute ${position === "bottom" ? "-top-2 left-8" : "-bottom-2 left-8"} w-4 h-4 bg-blue-600 rotate-45 rounded-sm`} />
      <div className="bg-blue-600 text-white rounded-2xl p-4 shadow-2xl relative">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold opacity-70">{step} {t("stepOf")} {total}</span>
          <button onClick={onSkip} className="text-[10px] opacity-70 hover:opacity-100 transition-opacity">{t("skip")}</button>
        </div>
        <h4 className="font-bold text-sm mb-1">{title}</h4>
        <p className="text-xs opacity-90 leading-relaxed mb-3">{desc}</p>
        <button onClick={onNext}
          className="w-full py-2 rounded-xl bg-white text-blue-600 font-semibold text-sm hover:bg-blue-50 transition-colors flex items-center justify-center gap-1">
          {isLast ? t("gotIt") : t("next")} {!isLast && <ArrowRight className="w-3.5 h-3.5" />}
        </button>
      </div>
    </motion.div>
  );
}

// ==================== Settings Modal ====================
function SettingsModal({ roomCode, onlineCount, clips, currentUser, roomToken, onClose, onLeave, lang, setLang: setLangFn }: {
  roomCode: string; onlineCount: number; clips: Clip[]; currentUser: User | null; roomToken: string;
  onClose: () => void; onLeave: () => void;
  lang: Lang; setLang: (l: Lang) => void;
}) {
  const { t } = useT();
  const [roomPassword, setRoomPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);
  const [savingExpiry, setSavingExpiry] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  const isOwner = currentUser && ownerId && currentUser.id === ownerId;

  useEffect(() => {
    fetch(`/api/rooms/${encodeURIComponent(roomCode)}`).then((r) => r.json()).then((data) => {
      setHasPassword(data.hasPassword || false);
      setExpiresAt(data.expiresAt || null);
      setOwnerId(data.ownerId || null);
      if (!data.expiresAt) {
        setSelectedExpiry("permanent");
      } else {
        const remainH = (new Date(data.expiresAt).getTime() - Date.now()) / 3600000;
        const sorted = EXPIRY_OPTIONS_KEYS.filter((o) => o.value !== "permanent").map((o) => ({ ...o, h: Number(o.value) }));
        const closest = sorted.reduce<typeof sorted[0] | null>((best, o) => {
          if (!best) return o;
          return Math.abs(o.h - remainH) < Math.abs(best.h - remainH) ? o : best;
        }, null);
        setSelectedExpiry(closest?.value || null);
      }
    });
  }, [roomCode]);

  const handleSetPassword = async (pwd: string | null) => {
    setSavingPassword(true);
    await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/password`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pwd, token: roomToken, userId: currentUser?.id }),
    });
    setHasPassword(!!pwd);
    setRoomPassword("");
    setSavingPassword(false);
  };

  const handleSetExpiry = async (hours: string) => {
    setSavingExpiry(true);
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/expiry`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiryHours: hours, token: roomToken, userId: currentUser?.id }),
    });
    const data = await res.json();
    if (res.ok) {
      setExpiresAt(data.expiresAt || null);
      setSelectedExpiry(hours);
    }
    setSavingExpiry(false);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="bg-white/80 dark:bg-black/80 backdrop-blur-2xl border border-white/20 w-full max-w-2xl rounded-t-3xl md:rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
          <h2 className="text-xl font-bold flex items-center gap-2"><Settings className="w-5 h-5" /> {t("settings")}</h2>
          <div className="flex items-center gap-3">
            <LangToggle lang={lang} setLang={setLangFn} />
            <button onClick={onClose} className="p-2 rounded-full hover:bg-white/20"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          <section>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t("connection")}</h3>
            <div className="space-y-3">
              <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
                <div><div className="font-medium flex items-center gap-2"><Hash className="w-4 h-4 text-blue-500" /> {t("roomCode")}</div>
                  <div className="text-xs text-gray-500 mt-1">{t("shareDevices")}</div></div>
                <span className="text-lg font-mono font-bold tracking-wider bg-white/20 dark:bg-white/10 px-4 py-1.5 rounded-xl">{roomCode}</span>
              </div>
              <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
                <div><div className="font-medium flex items-center gap-2"><Users className="w-4 h-4 text-green-500" /> {t("online")}</div></div>
                <span className="text-lg font-bold">{onlineCount}</span>
              </div>
            </div>
          </section>

          {/* Password Section */}
          <section>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t("roomPassword")}</h3>
            <div className="glass-card p-4 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  {hasPassword ? (
                    <><Shield className="w-4 h-4 text-green-500" /><span className="font-medium">{t("passwordProtected")}</span></>
                  ) : (
                    <><Unlock className="w-4 h-4 text-gray-400" /><span className="font-medium text-gray-400">{t("noPassword")}</span></>
                  )}
                </div>
                {hasPassword && isOwner && (
                  <button onClick={() => handleSetPassword(null)} disabled={savingPassword}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors">{t("remove")}</button>
                )}
              </div>
              {!hasPassword && isOwner && (
                <div className="space-y-2">
                  <PinInput value={roomPassword} onChange={setRoomPassword} />
                  <button onClick={() => { if (roomPassword.length === 6) handleSetPassword(roomPassword); }}
                    disabled={roomPassword.length !== 6 || savingPassword}
                    className="w-full text-sm py-2 rounded-lg bg-blue-600/20 text-blue-600 dark:text-blue-400 font-medium disabled:opacity-50 hover:bg-blue-600/30 transition-colors flex items-center justify-center gap-1">
                    {savingPassword ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3" />}
                    {t("setPassword")}
                  </button>
                </div>
              )}
              {!isOwner && (
                <p className="text-xs text-gray-400 italic">{t("ownerOnly")}</p>
              )}
            </div>
          </section>

          {/* Expiry Section */}
          <section>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t("roomExpiry")}</h3>
            <div className="glass-card p-4 rounded-2xl space-y-3">
              <div className="text-sm text-gray-500">
                {expiresAt ? (
                  <span className="flex items-center gap-2"><Timer className="w-4 h-4 text-orange-400" /> {t("expires")}: {new Date(expiresAt).toLocaleString()}</span>
                ) : (
                  <span className="flex items-center gap-2"><Timer className="w-4 h-4 text-green-400" /> {t("permanentRoom")}</span>
                )}
              </div>
              {isOwner ? (
                <div className="flex flex-wrap gap-1.5">
                  {EXPIRY_OPTIONS_KEYS.map((opt) => {
                    const disabled = opt.value === "permanent" && !currentUser;
                    const isSelected = selectedExpiry === opt.value;
                    return (
                      <button key={opt.value}
                        onClick={() => !disabled && handleSetExpiry(opt.value)}
                        disabled={disabled || savingExpiry}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-all border font-medium
                          ${disabled
                            ? "bg-gray-200/20 dark:bg-white/5 border-gray-300/20 dark:border-white/5 text-gray-400 dark:text-gray-600 cursor-not-allowed"
                            : isSelected
                              ? "bg-blue-500/30 border-blue-400/50 text-blue-600 dark:text-blue-300 shadow-sm"
                              : "bg-gray-900/80 dark:bg-white/15 border-gray-700 dark:border-white/20 text-white dark:text-gray-200 hover:bg-gray-900 dark:hover:bg-white/25"}`}
                        title={disabled ? t("loginRequired") : ""}>
                        {t(opt.labelKey)}
                        {disabled && <Lock className="w-2.5 h-2.5 inline ml-1 opacity-50" />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">{t("ownerOnly")}</p>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t("stats")}</h3>
            <div className="glass-card p-4 rounded-2xl">
              <div className="grid grid-cols-4 gap-4 text-center">
                <div><div className="text-2xl font-bold">{clips.length}</div><div className="text-xs text-gray-500">{t("total")}</div></div>
                <div><div className="text-2xl font-bold">{clips.filter((c) => c.type === "text" || c.type === "code" || c.type === "link").length}</div><div className="text-xs text-gray-500">{t("texts")}</div></div>
                <div><div className="text-2xl font-bold">{clips.filter((c) => c.type === "image").length}</div><div className="text-xs text-gray-500">{t("images")}</div></div>
                <div><div className="text-2xl font-bold">{clips.filter((c) => c.type === "file" || c.type === "mixed").length}</div><div className="text-xs text-gray-500">{t("files")}</div></div>
              </div>
            </div>
          </section>

          <button onClick={onLeave}
            className="w-full py-3 rounded-xl bg-red-500/10 text-red-500 font-semibold hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2">
            <LogOut className="w-4 h-4" /> {t("leaveRoom")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ==================== Sub-Components ====================
function NavItem({ icon, label, active, onClick, count }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; count?: number }) {
  return (
    <button onClick={onClick}
      className={`whitespace-nowrap flex-none md:w-full flex items-center justify-center md:justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
        ${active ? "bg-white/40 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm" : "text-gray-600 dark:text-gray-400 hover:bg-white/20 dark:hover:bg-white/5"}`}>
      <div className="flex items-center gap-2 md:gap-3">
        <div className={`opacity-80 ${active ? "opacity-100 text-blue-600 dark:text-blue-400" : ""}`}>{icon}</div>
        <span>{label}</span>
      </div>
      {count !== undefined && (
        <span className={`hidden md:inline-block text-[10px] font-bold py-0.5 px-2 rounded-full ${active ? "bg-white/50 dark:bg-white/20" : "bg-black/5 dark:bg-white/5"}`}>{count}</span>
      )}
    </button>
  );
}

function ClipCard({ clip, isStarred, onCopy, onDelete, onToggleStar, onOpenDetail, onPreviewAttachment, isCopied, t }: {
  clip: Clip; isStarred: boolean; isCopied: boolean;
  onCopy: (burn?: boolean) => void; onDelete: () => void;
  onToggleStar: () => void; onOpenDetail: () => void;
  onPreviewAttachment: (att: Attachment) => void;
  t: (key: any) => string;
}) {
  const [showSensitive, setShowSensitive] = useState(!clip.isSensitive);

  const getIcon = (type: Clip["type"]) => {
    switch (type) {
      case "text": return <FileText className="w-4 h-4 text-blue-500" />;
      case "link": return <Link2 className="w-4 h-4 text-green-500" />;
      case "image": return <ImageIcon className="w-4 h-4 text-purple-500" />;
      case "code": return <Scissors className="w-4 h-4 text-orange-500" />;
      case "file": return <File className="w-4 h-4 text-gray-500" />;
      case "mixed": return <Paperclip className="w-4 h-4 text-cyan-500" />;
    }
  };

  const formattedTime = new Date(clip.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const hasAttachments = clip.attachments && clip.attachments.length > 0;
  const firstImageAtt = clip.attachments?.find((a) => a.mimeType.startsWith("image/"));
  const isImageOnly = clip.type === "image" && firstImageAtt && !clip.content;
  const isFileOnly = clip.type === "file" && hasAttachments && !clip.content;
  const hasTextContent = clip.content && clip.content.trim().length > 0;

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: "blur(10px)" }} transition={{ duration: 0.3 }}
      className={`glass-card rounded-2xl p-5 flex flex-col group relative overflow-hidden h-[220px] cursor-pointer ${clip.burnAfterRead ? "border-red-500/30" : ""}`}
      onClick={() => { isImageOnly && firstImageAtt ? onPreviewAttachment(firstImageAtt) : onOpenDetail(); }}
      data-testid={`card-clip-${clip.id}`}>

      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white/50 dark:bg-black/50 px-2.5 py-1 rounded-lg backdrop-blur-md shadow-sm">
            {getIcon(clip.type)}
            <span className="text-xs font-semibold capitalize opacity-80">{clip.type}</span>
          </div>
          {clip.isSensitive && <div className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 p-1 rounded-md"><Shield className="w-3 h-3" /></div>}
          {clip.burnAfterRead && <div className="bg-red-500/20 text-red-600 dark:text-red-400 p-1 rounded-md"><Flame className="w-3 h-3" /></div>}
          {hasAttachments && <div className="bg-blue-500/20 text-blue-600 dark:text-blue-400 p-1 rounded-md"><Paperclip className="w-3 h-3" /></div>}
        </div>
        <button onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
          className={`p-1.5 rounded-full transition-colors ${isStarred ? "text-yellow-500" : "text-gray-400 hover:bg-black/5 dark:hover:bg-white/10"}`}>
          <Star className="w-4 h-4" fill={isStarred ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative z-10 flex flex-col">
        {clip.isSensitive && !showSensitive ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <p className="text-2xl tracking-[0.3em] font-mono opacity-50">••••••••</p>
            <button onClick={(e) => { e.stopPropagation(); setShowSensitive(true); }}
              className="mt-2 text-xs flex items-center gap-1 text-blue-500 hover:underline"><Eye className="w-3 h-3" /> {t("tapToReveal")}</button>
          </div>
        ) : isImageOnly && firstImageAtt ? (
          <div className="absolute inset-0 -mx-5 -my-4 pt-14 pb-12">
            <img src={firstImageAtt.data} alt={firstImageAtt.name} className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-700" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" />
          </div>
        ) : isFileOnly && hasAttachments ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <File className="w-10 h-10 text-gray-400" />
            <p className="text-sm font-medium truncate max-w-full">{clip.attachments![0].name}</p>
            <p className="text-[10px] opacity-60">{formatFileSize(clip.attachments![0].size)}</p>
          </div>
        ) : clip.type === "code" ? (
          <pre className="text-xs font-mono p-2 bg-black/5 dark:bg-black/30 rounded-xl overflow-hidden h-full line-clamp-6"><code>{clip.content}</code></pre>
        ) : clip.type === "link" ? (
          <a href={clip.content} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline break-all line-clamp-3">{clip.content}</a>
        ) : (
          <div>
            <p className="text-sm leading-relaxed font-medium line-clamp-3 whitespace-pre-wrap">{clip.content}</p>
            {hasAttachments && (
              <div className="flex items-center gap-1 mt-2 text-[10px] opacity-60">
                <Paperclip className="w-3 h-3" />{clip.attachments!.map((a) => a.name).join(", ")}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={`mt-3 flex items-center justify-between relative z-10 ${isImageOnly ? "text-white" : "text-gray-500 dark:text-gray-400"}`}>
        <div className="flex flex-col">
          <span className="text-[10px] font-medium opacity-80">{formattedTime}</span>
          <span className="text-[10px] opacity-60 flex items-center gap-1"><Smartphone className="w-2.5 h-2.5" /> {clip.sourceDevice}</span>
        </div>
        <div className="flex items-center gap-1 bg-white/40 dark:bg-black/40 backdrop-blur-md rounded-xl p-1 shadow-sm opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
          {clip.isSensitive && showSensitive && (
            <button onClick={(e) => { e.stopPropagation(); setShowSensitive(false); }}
              className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10"><EyeOff className="w-4 h-4" /></button>
          )}
          {hasAttachments && (
            <button onClick={(e) => { e.stopPropagation(); downloadDataUrl(clip.attachments![0].data, clip.attachments![0].name); }}
              className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10"><Download className="w-4 h-4" /></button>
          )}
          {hasTextContent && (
            <button onClick={(e) => { e.stopPropagation(); onCopy(clip.burnAfterRead); }}
              className={`p-1.5 rounded-lg transition-colors ${isCopied ? "bg-green-500/20 text-green-600 dark:text-green-400" : "hover:bg-black/10 dark:hover:bg-white/10"}`}>
              {isCopied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-500"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
    </motion.div>
  );
}
