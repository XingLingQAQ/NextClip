import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Search, Settings, Star, Clock,
  Scissors, Lock, Moon, Sun, Ghost, Send, X,
  RefreshCw, ClipboardPaste, FileText, Link2, Image as ImageIcon,
  Shield, Flame,
  LogIn, Hash, Download, Maximize2,
  File, User as UserIcon, Unlock,
  Users, Smartphone, Shuffle,
} from "lucide-react";

import { io, Socket } from "socket.io-client";
import type { Clip, RoomMessage, Attachment, User } from "@shared/schema";
import { useT } from "../i18n";
import { PinInput } from "../components/PinInput";
import { LangToggle } from "../components/LangToggle";
import { OnboardingTooltip } from "../components/OnboardingTooltip";
import { ClipCard } from "../components/ClipCard";
import { SettingsModal } from "../components/SettingsModal";
import { detectType, getDeviceName, formatFileSize, downloadDataUrl } from "../lib/clipUtils";
import {
  STORAGE_KEYS,
  clearDeprecatedSensitiveStorage,
  getSessionStorageWithTTL,
  setSessionStorageWithTTL,
} from "../lib/storagePolicy";

const ROOM_PASSWORD_SESSION_TTL_MS = 30 * 60 * 1000;

function generateRoomCode() {
  const consonants = "bcdfghjklmnpqrstvwxz";
  const vowels = "aeiou";
  const digits = "2456789";
  return [consonants, vowels, consonants, vowels, digits, digits]
    .map((s) => s[Math.floor(Math.random() * s.length)])
    .join("");
}

export default function Home() {
  const { t, lang, setLang } = useT();

  const [isLocked, setIsLocked] = useState(false);
  const [lockPin, setLockPin] = useState("");

  const { savedRoom, initialRoomInput } = (() => {
    const urlRoom = new URLSearchParams(window.location.search).get("room") || "";
    const stored = localStorage.getItem(STORAGE_KEYS.room) || "";
    if (urlRoom) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (urlRoom && urlRoom !== stored) {
      return { savedRoom: "", initialRoomInput: urlRoom };
    }
    return { savedRoom: stored, initialRoomInput: urlRoom };
  })();

  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem(STORAGE_KEYS.onboarded));
  const [onboardingStep, setOnboardingStep] = useState(() => savedRoom ? 2 : 0);

  const finishOnboarding = useCallback(() => {
    localStorage.setItem(STORAGE_KEYS.onboarded, "1");
    setShowOnboarding(false);
  }, []);

  const advanceOnboarding = useCallback(() => {
    setOnboardingStep((s) => s + 1);
  }, []);

  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const [isRoomCreator, setIsRoomCreator] = useState<boolean>(() => {
    if (!savedRoom) return false;
    return localStorage.getItem(`${STORAGE_KEYS.roomCreatorPrefix}${savedRoom}`) === "1";
  });

  const [roomCode, setRoomCode] = useState(savedRoom);
  const [roomInput, setRoomInput] = useState(initialRoomInput);
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);
  const [needPassword, setNeedPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [pendingRoomCode, setPendingRoomCode] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  const [clips, setClips] = useState<Clip[]>([]);
  const [starredIds, setStarredIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.favorites);
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
    localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(Array.from(starredIds)));
  }, [starredIds]);

  useEffect(() => {
    clearDeprecatedSensitiveStorage();
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) setCurrentUser(data.user);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!showOnboarding) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") finishOnboarding();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) advanceOnboarding();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showOnboarding, finishOnboarding, advanceOnboarding]);

  useEffect(() => {
    if (roomCode && showOnboarding && onboardingStep < 2) {
      setOnboardingStep(2);
    }
  }, [roomCode, showOnboarding, onboardingStep]);

  const connectSocket = useCallback((code: string) => {
    if (socketRef.current) socketRef.current.disconnect();
    const socket = io(window.location.origin, { transports: ["websocket", "polling"], path: "/socket.io" });
    socket.on("connect", () => {
      setIsConnected(true);
      socket.emit("join-room", { roomCode: code });
    });
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
      localStorage.setItem(STORAGE_KEYS.room, code);
      sessionStorage.removeItem(STORAGE_KEYS.roomPwdSession);
      if (data.created) {
        setIsRoomCreator(true);
        localStorage.setItem(`${STORAGE_KEYS.roomCreatorPrefix}${code}`, "1");
      }
      connectSocket(code);
      if (showOnboarding && onboardingStep < 2) setOnboardingStep(2);
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
      localStorage.setItem(STORAGE_KEYS.room, pendingRoomCode);
      setSessionStorageWithTTL(STORAGE_KEYS.roomPwdSession, passwordInput, ROOM_PASSWORD_SESSION_TTL_MS);
      setNeedPassword(false);
      setPendingRoomCode("");
      connectSocket(pendingRoomCode);
      if (showOnboarding && onboardingStep < 2) setOnboardingStep(2);
    } catch {
      setPasswordError(t("networkError"));
    }
    setJoining(false);
  };

  useEffect(() => {
    if (roomCode) {
      const savedPwd = getSessionStorageWithTTL(STORAGE_KEYS.roomPwdSession);
      fetch(`/api/rooms/${encodeURIComponent(roomCode)}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: savedPwd || undefined }),
      }).then(async (res) => {
        if (res.ok) {
          connectSocket(roomCode);
        } else {
          const data = await res.json();
          if (data.needPassword) {
            setPendingRoomCode(roomCode);
            setNeedPassword(true);
            setRoomCode("");
            localStorage.removeItem(STORAGE_KEYS.room);
          } else {
            setRoomCode("");
            localStorage.removeItem(STORAGE_KEYS.room);
            sessionStorage.removeItem(STORAGE_KEYS.roomPwdSession);
          }
        }
      }).catch(() => {});
    }
    return () => { socketRef.current?.disconnect(); };
  }, []);

  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [isDarkMode]);

  const handleReadClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setComposeText(text);
    } catch { alert(t("clipboardDenied")); }
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
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            data: ev.target!.result as string,
            size: file.size,
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
    if (roomCode) localStorage.removeItem(`${STORAGE_KEYS.roomCreatorPrefix}${roomCode}`);
    setRoomCode("");
    setIsRoomCreator(false);
    setClips([]);
    setIsConnected(false);
    setOnlineCount(0);
    localStorage.removeItem(STORAGE_KEYS.room);
    sessionStorage.removeItem(STORAGE_KEYS.roomPwdSession);
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
    socketRef.current.emit("update-clip", {
      clipId: detailClip.id,
      content: detailEditContent,
      type: detectType(detailEditContent),
    });
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
    const matchesFilter = activeFilter === "all" ? true
      : activeFilter === "starred" ? starredIds.has(clip.id)
      : clip.type === activeFilter;
    return matchesSearch && matchesFilter;
  });

  const onboardHighlight = (step: number) =>
    showOnboarding && onboardingStep === step
      ? "ring-2 ring-blue-400 ring-offset-1 ring-offset-transparent rounded-xl"
      : "";

  // ==================== LOCK SCREEN ====================
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
          <h2 className="text-2xl font-bold text-white mb-2">{t("appLocked")}</h2>
          <p className="text-gray-300 text-sm mb-8 text-center">{t("enterPin")}</p>
          <input
            type="password"
            value={lockPin}
            onChange={(e) => setLockPin(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setIsLocked(false); }}
            className="w-full bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/20 rounded-xl px-4 py-3 text-center text-gray-900 dark:text-white tracking-[0.5em] text-xl outline-none focus:bg-black/10 dark:focus:bg-white/20 transition-colors mb-6"
            placeholder="••••"
            data-testid="input-lock-pin"
          />
          <button
            onClick={() => setIsLocked(false)}
            className="w-full py-3 rounded-xl bg-white text-black font-semibold shadow-lg hover:bg-gray-100 transition-colors"
            data-testid="button-unlock"
          >
            {t("unlock")}
          </button>
        </motion.div>
      </div>
    );
  }

  // ==================== PASSWORD PROMPT ====================
  if (needPassword) {
    return (
      <div className="min-h-screen min-h-[100dvh] p-4 flex items-center justify-center font-sans relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-panel p-8 rounded-3xl w-full max-w-sm z-10 flex flex-col items-center shadow-2xl border border-white/20"
        >
          <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-yellow-500 to-orange-400 flex items-center justify-center mb-6 shadow-lg">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2" data-testid="text-password-title">
            {t("roomPassword")}
          </h2>
          <p className="text-gray-300 text-sm mb-2 text-center">
            <span className="font-mono font-bold text-white">{pendingRoomCode}</span>{" "}
            {t("roomProtected")}
          </p>
          <p className="text-gray-400 text-xs mb-2 text-center">{t("enter6Digit")}</p>
          <p className="text-amber-300/90 text-[11px] mb-4 text-center">
            临时记忆（30 分钟）：使用 sessionStorage（非安全存储）
          </p>
          <div className="mb-4">
            <PinInput value={passwordInput} onChange={(v) => {
              setPasswordInput(v);
              setPasswordError("");
            }} />
          </div>
          {passwordError && (
            <p className="text-red-400 text-xs text-center mb-4">{passwordError}</p>
          )}
          <button
            onClick={handlePasswordSubmit}
            disabled={passwordInput.length !== 6 || joining}
            className="w-full py-3 rounded-xl bg-white text-black font-semibold shadow-lg hover:bg-gray-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 mb-3"
            data-testid="button-submit-password"
          >
            {joining ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Unlock className="w-5 h-5" />}
            {joining ? t("verifying") : t("unlockRoom")}
          </button>
          <button
            onClick={() => { setNeedPassword(false); setPendingRoomCode(""); setPasswordInput(""); }}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            {t("back")}
          </button>
          <div className="mt-4">
            <LangToggle lang={lang} setLang={setLang} />
          </div>
        </motion.div>
      </div>
    );
  }

  // ==================== ROOM JOIN SCREEN ====================
  if (!roomCode) {
    return (
      <div className="min-h-screen min-h-[100dvh] p-4 flex items-center justify-center font-sans relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="glass-panel p-6 sm:p-8 rounded-3xl w-full max-w-sm z-10 flex flex-col items-center shadow-2xl border border-white/30 relative"
        >
          {/* Logo */}
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-500 to-cyan-400 flex items-center justify-center mb-4 shadow-lg shadow-blue-500/20">
            <Scissors className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-0.5" data-testid="text-app-title">
            CloudClip
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-xs mb-5 text-center">
            {t("enterRoomCode")}
          </p>

          <div className="w-full space-y-2.5">
            {/* Room code input */}
            <div
              className={`relative transition-all duration-300 ${onboardHighlight(0)}`}
              data-testid="onboard-target-input"
            >
              <Hash className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") handleJoinRoom(); }}
                className="w-full bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/20 rounded-xl pl-9 pr-20 py-3 text-gray-900 dark:text-white font-mono font-semibold tracking-wider outline-none focus:bg-black/10 dark:focus:bg-white/20 focus:border-blue-400/50 transition-all placeholder-gray-400 placeholder:font-sans placeholder:font-normal placeholder:tracking-normal"
                placeholder={t("roomCode")}
                maxLength={12}
                data-testid="input-room-code"
              />
              {/* Generate random code button */}
              <button
                onClick={() => setRoomInput(generateRoomCode())}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] font-semibold text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 bg-black/5 dark:bg-white/10 hover:bg-blue-500/10 px-2 py-1 rounded-lg transition-all"
                title={t("generateRoom")}
                data-testid="button-generate-room"
              >
                <Shuffle className="w-3 h-3" />
                <span>{t("generateRoom")}</span>
              </button>
              {showOnboarding && onboardingStep === 0 && (
                <OnboardingTooltip
                  position="bottom"
                  step={1}
                  total={5}
                  title={t("onboard1Title")}
                  desc={t("onboard1Desc")}
                  onNext={() => setOnboardingStep(1)}
                  onSkip={finishOnboarding}
                  t={t}
                />
              )}
            </div>

            {joinError && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-red-400 text-xs text-center bg-red-500/10 rounded-lg px-3 py-1.5"
              >
                {joinError}
              </motion.p>
            )}

            {/* Join button */}
            <div
              className={`relative transition-all duration-300 ${onboardHighlight(1)}`}
              data-testid="onboard-target-join"
            >
              <button
                onClick={handleJoinRoom}
                disabled={!roomInput.trim() || joining}
                className="w-full py-3 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-semibold shadow-lg hover:bg-gray-800 dark:hover:bg-gray-100 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="button-join-room"
              >
                {joining
                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : <LogIn className="w-4 h-4" />
                }
                <span>{joining ? t("joining") : t("joinRoom")}</span>
              </button>

              {showOnboarding && onboardingStep === 1 && (
                <OnboardingTooltip
                  position="bottom"
                  step={2}
                  total={5}
                  title={t("onboard2Title")}
                  desc={t("onboard2Desc")}
                  onNext={() => setOnboardingStep(2)}
                  onSkip={finishOnboarding}
                  t={t}
                />
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="mt-5 pt-4 border-t border-black/5 dark:border-white/10 w-full">
            {currentUser ? (
              <div className="flex items-center justify-center gap-2 text-sm">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <UserIcon className="w-3.5 h-3.5 text-blue-500" />
                </div>
                <span className="font-medium text-gray-800 dark:text-white text-sm">{currentUser.username}</span>
                <button
                  onClick={async () => {
                    await fetch("/api/auth/logout", { method: "POST" });
                    setCurrentUser(null);
                  }}
                  className="text-xs text-gray-400 hover:text-red-400 transition-colors ml-0.5"
                >
                  ({t("logOut")})
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3 text-xs text-gray-500">
                <a href="/login" className="text-blue-500 hover:text-blue-400 font-medium transition-colors" data-testid="link-login">
                  {t("logIn")}
                </a>
                <span className="opacity-40">·</span>
                <a href="/register" className="text-blue-500 hover:text-blue-400 font-medium transition-colors" data-testid="link-register">
                  {t("signUp")}
                </a>
                <span className="opacity-40">·</span>
                <LangToggle lang={lang} setLang={setLang} />
              </div>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  // ==================== MAIN APP ====================
  const FILTER_TABS: Array<{ key: "all" | "starred" | Clip["type"]; icon: React.ReactNode; label: string }> = [
    { key: "all", icon: <Clock className="w-4 h-4" />, label: t("recent") },
    { key: "starred", icon: <Star className="w-4 h-4" />, label: t("favorites") },
    { key: "text", icon: <FileText className="w-4 h-4" />, label: t("texts") },
    { key: "link", icon: <Link2 className="w-4 h-4" />, label: t("links") },
    { key: "image", icon: <ImageIcon className="w-4 h-4" />, label: t("images") },
    { key: "file", icon: <File className="w-4 h-4" />, label: t("files") },
    { key: "mixed", icon: <Scissors className="w-4 h-4" />, label: t("mixed") },
  ];

  return (
    <div className="min-h-screen p-0 md:p-4 lg:p-12 flex items-center justify-center font-sans text-gray-900 dark:text-white transition-colors duration-500 overflow-hidden">
      <AnimatePresence>
        {isIncognito && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 pointer-events-none z-0 border-[8px] border-purple-500/30"
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-7xl h-[100dvh] md:h-[90vh] md:rounded-3xl overflow-hidden flex flex-col md:flex-row glass-panel shadow-2xl relative z-10"
      >
        {/* ===== Sidebar ===== */}
        <div className="w-full md:w-64 md:flex-shrink-0 border-b md:border-b-0 md:border-r border-white/20 p-3 md:p-5 flex flex-col bg-white/10 dark:bg-black/20 backdrop-blur-xl">
          <div className="flex items-center justify-between mb-1 md:mb-8 px-1">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-xl bg-gradient-to-tr ${isIncognito ? "from-purple-500 to-indigo-600" : "from-blue-500 to-cyan-400"} flex items-center justify-center shadow-lg flex-shrink-0`}>
                {isIncognito ? <Ghost className="w-4 h-4 text-white" /> : <Scissors className="w-4 h-4 text-white" />}
              </div>
              <div>
                <h1 className="font-bold text-base md:text-lg tracking-tight leading-tight">CloudClip</h1>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
                  <span className="opacity-60">{t("room")}: {roomCode}</span>
                  {onlineCount > 0 && (
                    <span className="opacity-60 flex items-center gap-0.5">
                      <Users className="w-2.5 h-2.5" /> {onlineCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <nav className="hidden md:block md:space-y-1 md:flex-1 md:overflow-y-auto md:pb-4 scrollbar-hide">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-3 mt-4">
              {t("library")}
            </div>
            <NavItem icon={<Clock />} label={t("recent")} active={activeFilter === "all"} onClick={() => setActiveFilter("all")} />
            <NavItem icon={<Star />} label={t("favorites")} active={activeFilter === "starred"} onClick={() => setActiveFilter("starred")} />
            <div className="h-px w-full bg-white/20 my-3" />
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-3">
              {t("types")}
            </div>
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
              <button
                onClick={() => setIsIncognito(!isIncognito)}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-xl transition-all ${isIncognito ? "bg-purple-500/20 text-purple-600 dark:text-purple-400" : "bg-white/10 hover:bg-white/20 text-gray-600 dark:text-gray-300"}`}
                title={t("incognitoMode")}
              >
                <Ghost className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="flex-1 flex items-center justify-center py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-600 dark:text-gray-300 transition-all"
                title={t("toggleTheme")}
              >
                {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
            <div
              className={`relative transition-all duration-300 ${onboardHighlight(4)}`}
              data-testid="onboard-target-settings"
            >
              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center justify-center md:justify-start gap-3 px-4 py-3 rounded-xl w-full text-sm font-medium bg-white/10 hover:bg-white/20 text-gray-700 dark:text-gray-200 transition-colors"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden md:inline">{t("settingsRoom")}</span>
              </button>
              {showOnboarding && onboardingStep === 4 && (
                <OnboardingTooltip
                  position="top"
                  step={5}
                  total={5}
                  title={t("onboard5Title")}
                  desc={t("onboard5Desc")}
                  onNext={finishOnboarding}
                  onSkip={finishOnboarding}
                  isLast
                  t={t}
                />
              )}
            </div>
          </div>
        </div>

        {/* ===== Main Content ===== */}
        <div className="flex-1 flex flex-col min-w-0 bg-white/5 dark:bg-black/5 pb-[144px] md:pb-0 h-full overflow-hidden">
          <header className="p-3 sm:p-5 pb-2 flex-shrink-0">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative rounded-2xl glass-input overflow-visible transition-all duration-300 ${isDragging ? "ring-2 ring-blue-500 bg-blue-500/10" : ""} ${onboardHighlight(2)}`}
              data-testid="onboard-target-compose"
            >
              {isDragging && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-blue-500/20 backdrop-blur-sm text-blue-600 dark:text-blue-400 font-medium rounded-2xl">
                  {t("dropHere")}
                </div>
              )}
              <div className="p-3">
                <textarea
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(); }}
                  placeholder={t("composeHint")}
                  className="w-full bg-transparent resize-none outline-none min-h-[48px] text-sm placeholder-gray-500"
                  data-testid="input-compose"
                />

                {composeAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-white/10">
                    {composeAttachments.map((att, i) => (
                      <div key={i} className="relative group/att flex items-center gap-2 bg-white/10 rounded-lg p-2 pr-8">
                        {att.mimeType.startsWith("image/") ? (
                          <img src={att.data} alt={att.name} className="w-10 h-10 rounded object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded bg-white/10 flex items-center justify-center">
                            <File className="w-5 h-5 text-gray-400" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate max-w-[100px]">{att.name}</p>
                          <p className="text-[10px] opacity-60">{formatFileSize(att.size)}</p>
                        </div>
                        <button
                          onClick={() => setComposeAttachments((prev) => prev.filter((_, j) => j !== i))}
                          className="absolute top-1 right-1 p-0.5 rounded-full bg-black/20 hover:bg-red-500/30 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 p-2 px-3 bg-black/5 dark:bg-white/5 border-t border-white/10">
                <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink overflow-hidden min-w-0">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-lg hover:bg-white/20 text-gray-500 dark:text-gray-400 transition-colors"
                    title={t("uploadFile")}
                    data-testid="button-upload-file"
                  >
                    <Plus className="w-4 h-4" />
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      multiple
                      onChange={(e) => { handleFileSelect(e.target.files); e.target.value = ""; }}
                    />
                  </button>
                  <button
                    onClick={handleReadClipboard}
                    className="p-2 rounded-lg hover:bg-white/20 text-gray-500 dark:text-gray-400 transition-colors"
                    title={t("readClipboard")}
                    data-testid="button-read-clipboard"
                  >
                    <ClipboardPaste className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setComposeSettings((s) => ({ ...s, sensitive: !s.sensitive }))}
                    className={`p-2 rounded-lg transition-colors ${composeSettings.sensitive ? "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400" : "hover:bg-white/20 text-gray-500 dark:text-gray-400"}`}
                    title={t("sensitive")}
                    data-testid="button-sensitive"
                  >
                    <Shield className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setComposeSettings((s) => ({ burn: !s.burn, sensitive: !s.burn ? true : s.sensitive }))}
                    className={`p-2 rounded-lg transition-colors ${composeSettings.burn ? "bg-red-500/20 text-red-600 dark:text-red-400" : "hover:bg-white/20 text-gray-500 dark:text-gray-400"}`}
                    title={t("burnAfterRead")}
                    data-testid="button-burn"
                  >
                    <Flame className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!isConnected && (
                    <span className="text-xs text-red-400 flex items-center gap-1 hidden sm:flex">
                      <RefreshCw className="w-3 h-3 animate-spin" /> {t("reconnecting")}
                    </span>
                  )}
                  <div
                    className={`relative transition-all duration-300 ${onboardHighlight(3)}`}
                    data-testid="onboard-target-send"
                  >
                    <button
                      onClick={handleSend}
                      disabled={(!composeText.trim() && composeAttachments.length === 0) || !isConnected}
                      className="bg-blue-600 text-white dark:bg-blue-500 p-1.5 px-4 rounded-lg text-sm font-medium shadow-lg hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                      data-testid="button-send"
                    >
                      <Send className="w-4 h-4" />
                      <span className="hidden sm:inline">{t("send")}</span>
                    </button>
                    {showOnboarding && onboardingStep === 3 && (
                      <OnboardingTooltip
                        position="bottom"
                        step={4}
                        total={5}
                        title={t("onboard4Title")}
                        desc={t("onboard4Desc")}
                        onNext={() => setOnboardingStep(4)}
                        onSkip={finishOnboarding}
                        t={t}
                      />
                    )}
                  </div>
                </div>
              </div>

              {showOnboarding && onboardingStep === 2 && (
                <OnboardingTooltip
                  position="bottom"
                  step={3}
                  total={5}
                  title={t("onboard3Title")}
                  desc={t("onboard3Desc")}
                  onNext={() => setOnboardingStep(3)}
                  onSkip={finishOnboarding}
                  t={t}
                  className="absolute left-4 right-4 bottom-[-150px] z-30"
                />
              )}
            </div>
          </header>

          <div className="px-3 sm:px-5 py-2 flex items-center gap-3 flex-shrink-0">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder={t("searchHistory")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl glass-input text-sm text-gray-800 dark:text-white placeholder-gray-500 outline-none"
                data-testid="input-search"
              />
            </div>
            <button
              onClick={handleClearAll}
              className="text-xs font-medium text-red-500 hover:bg-red-500/10 px-3 py-2 rounded-lg transition-colors whitespace-nowrap flex-shrink-0"
              data-testid="button-clear-all"
            >
              {t("clearAll")}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 sm:p-5 pt-2">
            <motion.div
              layout
              className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-5"
            >
              <AnimatePresence mode="popLayout">
                {filteredClips.map((clip) => (
                  <ClipCard
                    key={clip.id}
                    clip={clip}
                    isStarred={starredIds.has(clip.id)}
                    onCopy={(burn) => handleCopy(clip.id, clip.content, burn)}
                    onDelete={() => handleDelete(clip.id)}
                    onToggleStar={() => handleToggleStar(clip.id)}
                    onOpenDetail={() => { setDetailClip(clip); setDetailEditContent(clip.content); }}
                    onPreviewAttachment={(att) => setPreviewAttachment(att)}
                    isCopied={copiedId === clip.id}
                    t={t}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
            {filteredClips.length === 0 && (
              <div className="h-[40vh] flex flex-col items-center justify-center text-center opacity-50">
                <Search className="w-12 h-12 mb-4" />
                <p className="text-lg font-medium">
                  {clips.length === 0 ? t("noClips") : t("noClipsFound")}
                </p>
                <p className="text-sm">
                  {clips.length === 0 ? t("sendToStart") : t("tryDifferent")}
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* ===== Mobile Bottom Bar ===== */}
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-black/90 backdrop-blur-xl border-t border-white/20 z-40 flex flex-col"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0.5rem))" }}
      >
        <div className="flex overflow-x-auto scrollbar-hide px-3 pt-2 pb-1 gap-2">
          {FILTER_TABS.map((tab) => {
            const isActive = activeFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveFilter(tab.key)}
                className={`flex-none flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-white/20 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-white/30"
                }`}
                data-testid={`filter-tab-${tab.key}`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-around items-center px-4 pb-1 pt-1">
          <button
            onClick={() => setIsIncognito(!isIncognito)}
            className={`p-2.5 rounded-xl transition-all ${isIncognito ? "bg-purple-500/20 text-purple-600 dark:text-purple-400" : "text-gray-600 dark:text-gray-300"}`}
            title={t("incognitoMode")}
          >
            <Ghost className="w-5 h-5" />
          </button>
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2.5 rounded-xl text-gray-600 dark:text-gray-300"
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <div
            className={`relative transition-all duration-300 ${onboardHighlight(4)}`}
            data-testid="onboard-target-settings-mobile"
          >
            <button
              onClick={() => setShowSettings(true)}
              className="p-2.5 rounded-xl text-gray-600 dark:text-gray-300"
            >
              <Settings className="w-5 h-5" />
            </button>
            {showOnboarding && onboardingStep === 4 && (
              <OnboardingTooltip
                position="top"
                step={5}
                total={5}
                title={t("onboard5Title")}
                desc={t("onboard5Desc")}
                onNext={finishOnboarding}
                onSkip={finishOnboarding}
                isLast
                t={t}
              />
            )}
          </div>
        </div>
      </div>

      {/* ===== Detail / Edit Modal ===== */}
      <AnimatePresence>
        {detailClip && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setDetailClip(null); }}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-2xl border border-white/20 w-full max-w-2xl rounded-t-3xl md:rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="p-5 border-b border-white/10 flex justify-between items-center">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Maximize2 className="w-5 h-5" /> {t("clipDetail")}
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveEdit}
                    className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                  >
                    {t("save")}
                  </button>
                  <button
                    onClick={() => setDetailClip(null)}
                    className="p-2 rounded-full hover:bg-white/20 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="p-5 overflow-y-auto flex-1 space-y-4">
                <div className="text-xs text-gray-500 flex items-center gap-4 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Smartphone className="w-3 h-3" /> {detailClip.sourceDevice}
                  </span>
                  <span>{new Date(detailClip.timestamp).toLocaleString()}</span>
                  <span className="capitalize bg-white/20 dark:bg-white/10 px-2 py-0.5 rounded">
                    {detailClip.type}
                  </span>
                </div>
                <textarea
                  value={detailEditContent}
                  onChange={(e) => setDetailEditContent(e.target.value)}
                  className={`w-full bg-black/5 dark:bg-black/30 rounded-xl p-4 text-sm outline-none resize-y ${
                    detailClip.type === "code" ? "font-mono min-h-[300px]" : "min-h-[200px]"
                  }`}
                />
                {detailClip.attachments && detailClip.attachments.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                      {t("attachments")}
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {detailClip.attachments.map((att, i) => (
                        <div key={i} className="glass-card rounded-xl p-3 flex flex-col items-center gap-2">
                          {att.mimeType.startsWith("image/") ? (
                            <img
                              src={att.data}
                              alt={att.name}
                              className="w-full h-32 object-contain rounded-lg cursor-pointer"
                              onClick={() => setPreviewAttachment(att)}
                            />
                          ) : (
                            <div
                              className="w-full h-32 flex items-center justify-center bg-white/5 rounded-lg cursor-pointer"
                              onClick={() => {
                                if (att.mimeType.startsWith("text/") || att.name.match(/\.(json|csv|md|txt|js|ts|py|html|css)$/i)) {
                                  setPreviewAttachment(att);
                                }
                              }}
                            >
                              <File className="w-10 h-10 text-gray-400" />
                            </div>
                          )}
                          <p className="text-xs font-medium truncate w-full text-center">{att.name}</p>
                          <p className="text-[10px] opacity-60">{formatFileSize(att.size)}</p>
                          <button
                            onClick={() => downloadDataUrl(att.data, att.name)}
                            className="w-full text-xs bg-blue-600/20 text-blue-600 dark:text-blue-400 py-1.5 rounded-lg font-medium hover:bg-blue-600/30 flex items-center justify-center gap-1"
                          >
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

      {/* ===== Attachment Preview Modal ===== */}
      <AnimatePresence>
        {previewAttachment && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
            onClick={() => setPreviewAttachment(null)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-2xl border border-white/20 rounded-3xl overflow-hidden shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-white/10 flex justify-between items-center">
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold truncate">{previewAttachment.name}</h3>
                  <p className="text-xs text-gray-500">{formatFileSize(previewAttachment.size)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => downloadDataUrl(previewAttachment.data, previewAttachment.name)}
                    className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg font-medium hover:bg-blue-700 flex items-center gap-1"
                  >
                    <Download className="w-4 h-4" /> {t("download")}
                  </button>
                  <button
                    onClick={() => setPreviewAttachment(null)}
                    className="p-2 rounded-full hover:bg-white/20"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4">
                {previewAttachment.mimeType.startsWith("image/") ? (
                  <img
                    src={previewAttachment.data}
                    alt={previewAttachment.name}
                    className="max-w-full max-h-[70vh] mx-auto rounded-lg"
                  />
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

      {/* ===== Settings Modal ===== */}
      <AnimatePresence>
        {showSettings && (
          <SettingsModal
            roomCode={roomCode}
            onlineCount={onlineCount}
            clips={clips}
            currentUser={currentUser}
            isRoomCreator={isRoomCreator}
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

function NavItem({
  icon,
  label,
  active,
  onClick,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap flex-none md:w-full flex items-center justify-center md:justify-between px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200
        ${active
          ? "bg-white/40 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm"
          : "text-gray-600 dark:text-gray-400 hover:bg-white/20 dark:hover:bg-white/5"
        }`}
    >
      <div className="flex items-center gap-2">
        <div className={`opacity-80 ${active ? "opacity-100 text-blue-600 dark:text-blue-400" : ""}`}>
          {icon}
        </div>
        <span>{label}</span>
      </div>
      {count !== undefined && (
        <span className={`hidden md:inline-block text-[10px] font-bold py-0.5 px-2 rounded-full ${active ? "bg-white/50 dark:bg-white/20" : "bg-black/5 dark:bg-white/5"}`}>
          {count}
        </span>
      )}
    </button>
  );
}
