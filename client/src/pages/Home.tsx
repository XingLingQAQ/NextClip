import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Search, Settings, Star, Clock,
  Scissors, Lock, Moon, Sun, Ghost, Send, X,
  RefreshCw, ClipboardPaste, FileText, Link2, Image as ImageIcon,
  Shield, Flame, Code,
  LogIn, Hash, Download, Maximize2,
  File, User as UserIcon, Unlock,
  Users, Smartphone, Shuffle, Crosshair,
  Bell, BellOff, Trash2, RotateCcw, Keyboard,
} from "lucide-react";

import { io, Socket } from "socket.io-client";
import type { Clip, RoomMessage, Attachment, User, RoomDevice } from "@shared/schema";
import { useT } from "../i18n";
import { PinInput } from "../components/PinInput";
import { LangToggle } from "../components/LangToggle";
import { OnboardingTooltip } from "../components/OnboardingTooltip";
import { ClipCard } from "../components/ClipCard";
import { SettingsModal } from "../components/SettingsModal";
import { detectType, getDeviceName, formatFileSize, downloadDataUrl, normalizeDeviceName, saveDeviceName } from "../lib/clipUtils";
import { fetchWithCsrf, setCsrfToken } from "../lib/http";

function generateRoomCode() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const randomValues = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(randomValues)
    .map((v) => chars[v % chars.length])
    .join("");
}

export default function Home() {
  const { t, lang, setLang } = useT();

  const [isLocked, setIsLocked] = useState(false);
  const [lockPin, setLockPin] = useState("");
  const [lockError, setLockError] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinSetupValue, setPinSetupValue] = useState("");
  const [pinSetupError, setPinSetupError] = useState("");
  const appLockPinHashRef = useRef(localStorage.getItem("cloudclip-app-lock-pin-hash") || "");

  const { savedRoom, initialRoomInput } = (() => {
    const urlRoom = new URLSearchParams(window.location.search).get("room") || "";
    const stored = localStorage.getItem("cloudclip-room") || "";
    if (urlRoom) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (urlRoom && urlRoom !== stored) {
      return { savedRoom: "", initialRoomInput: urlRoom };
    }
    return { savedRoom: stored, initialRoomInput: urlRoom };
  })();

  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem("cloudclip-onboarded"));
  const [onboardingStep, setOnboardingStep] = useState(() => savedRoom ? 2 : 0);

  const finishOnboarding = useCallback(() => {
    localStorage.setItem("cloudclip-onboarded", "1");
    setShowOnboarding(false);
  }, []);

  const advanceOnboarding = useCallback(() => {
    setOnboardingStep((s) => s + 1);
  }, []);

  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const [isRoomCreator, setIsRoomCreator] = useState<boolean>(() => {
    if (!savedRoom) return false;
    return localStorage.getItem(`cloudclip-creator-${savedRoom}`) === "1";
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
  const [roomDevices, setRoomDevices] = useState<RoomDevice[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const roomTokenRef = useRef<string>("");
  const csrfBootstrapRef = useRef<Promise<void> | null>(null);

  const [clips, setClips] = useState<Clip[]>([]);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "starred" | Clip["type"]>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isIncognito, setIsIncognito] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [deletedClips, setDeletedClips] = useState<Clip[]>([]);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>("default");
  const [showTrash, setShowTrash] = useState(false);
  const clipsRef = useRef<Clip[]>([]);

  const [composeText, setComposeText] = useState("");
  const [composeAttachments, setComposeAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [composeSettings, setComposeSettings] = useState({ sensitive: false, burn: false });
  const [targetDeviceId, setTargetDeviceId] = useState<string>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deviceName, setDeviceName] = useState(getDeviceName());
  const deviceNameRef = useRef(deviceName);
  const deviceIdRef = useRef<string>(localStorage.getItem("cloudclip-device-id") || "");
  if (!deviceIdRef.current) {
    deviceIdRef.current = crypto.randomUUID();
    localStorage.setItem("cloudclip-device-id", deviceIdRef.current);
  }

  const [detailClip, setDetailClip] = useState<Clip | null>(null);
  const [detailEditContent, setDetailEditContent] = useState("");
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    deviceNameRef.current = deviceName;
  }, [deviceName]);

  useEffect(() => { clipsRef.current = clips; }, [clips]);

  useEffect(() => {
    if (!roomCode || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      const enabled = localStorage.getItem("cloudclip-notif-enabled");
      setNotifPerm(enabled === "0" ? "default" : "granted");
    } else {
      setNotifPerm(Notification.permission);
    }
  }, [roomCode]);

  const bootstrapCsrf = useCallback(async () => {
    if (!csrfBootstrapRef.current) {
      csrfBootstrapRef.current = fetch("/api/auth/csrf")
        .then((res) => res.json())
        .then((data) => {
          if (typeof data?.csrfToken === "string") {
            setCsrfToken(data.csrfToken);
          }
        })
        .catch(() => {});
    }

    await csrfBootstrapRef.current;
  }, []);

  useEffect(() => {
    void bootstrapCsrf();
  }, [bootstrapCsrf]);

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
    if (!roomCode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (previewAttachment) { setPreviewAttachment(null); return; }
        if (detailClip) { setDetailClip(null); return; }
        if (showClearConfirm) { setShowClearConfirm(false); return; }
        if (showPinSetup) { setShowPinSetup(false); return; }
        if (showTrash) { setShowTrash(false); return; }
        if (showSettings) { setShowSettings(false); return; }
        if (showShortcutsHelp) { setShowShortcutsHelp(false); return; }
      }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        const active = document.activeElement;
        const isInput = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
        if (!isInput) { setShowShortcutsHelp((v) => !v); return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [roomCode, previewAttachment, detailClip, showClearConfirm, showPinSetup, showTrash, showSettings, showShortcutsHelp]);

  useEffect(() => {
    if (roomCode && showOnboarding && onboardingStep < 2) {
      setOnboardingStep(2);
    }
  }, [roomCode, showOnboarding, onboardingStep]);

  const connectSocket = useCallback((code: string, token?: string) => {
    if (token) roomTokenRef.current = token;
    if (socketRef.current) socketRef.current.disconnect();
    const socket = io(window.location.origin, { transports: ["websocket", "polling"], path: "/socket.io" });
    socket.on("connect", () => {
      setIsConnected(true);
      socket.emit("join-room", {
        roomCode: code,
        token: roomTokenRef.current,
        deviceId: deviceIdRef.current,
        deviceName: deviceNameRef.current,
      });
    });
    socket.on("disconnect", () => setIsConnected(false));
    socket.on("room-error", () => { handleLeaveRoom(); });
    socket.on("room-message", (msg: RoomMessage) => {
      switch (msg.type) {
        case "clip:history":
          setClips(msg.clips || []);
          setStarredIds(new Set(msg.pinnedClipIds || []));
          break;
        case "clip:new":
          if (msg.clip) {
            setClips((p) => [msg.clip!, ...p]);
            if (
              msg.clip.sourceDevice !== deviceNameRef.current &&
              document.visibilityState === "hidden" &&
              !msg.clip.isSensitive &&
              !msg.clip.burnAfterRead &&
              "Notification" in window &&
              Notification.permission === "granted"
            ) {
              new Notification(`CloudClip · ${msg.clip.sourceDevice}`, {
                body: msg.clip.type === "image" ? "[Image]" : msg.clip.content.slice(0, 100),
                icon: "/favicon.ico",
                tag: "cloudclip-new",
                renotify: true,
              });
            }
          }
          break;
        case "clip:delete":
          if (msg.clipId) {
            const toDelete = clipsRef.current.find((c) => c.id === msg.clipId);
            if (toDelete && !toDelete.burnAfterRead) {
              setDeletedClips((d) => [toDelete, ...d].slice(0, 30));
            }
            setClips((p) => p.filter((c) => c.id !== msg.clipId));
          }
          break;
        case "clip:clear": setClips([]); break;
        case "clip:update": if (msg.clip) setClips((p) => p.map((c) => c.id === msg.clip!.id ? msg.clip! : c)); break;
        case "clip:pin":
          if (!msg.clipId) break;
          setStarredIds(new Set(msg.pinnedClipIds || []));
          break;
      }
    });
    socket.on("room-users", (count: number) => setOnlineCount(count));
    socket.on("room-devices", (devices: RoomDevice[]) => setRoomDevices(devices || []));
    socketRef.current = socket;
  }, []);

  const handleJoinRoom = async () => {
    const code = roomInput.trim();
    if (!code) return;
    setJoining(true);
    setJoinError("");

    try {
      await bootstrapCsrf();
      const res = await fetchWithCsrf(`/api/rooms/${encodeURIComponent(code)}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
      sessionStorage.setItem("cloudclip-room-token", data.token);
      if (data.created) {
        setIsRoomCreator(true);
        localStorage.setItem(`cloudclip-creator-${code}`, "1");
      }
      connectSocket(code, data.token);
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
      await bootstrapCsrf();
      const res = await fetchWithCsrf(`/api/rooms/${encodeURIComponent(pendingRoomCode)}/join`, {
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
      sessionStorage.setItem("cloudclip-room-token", data.token);
      setNeedPassword(false);
      setPendingRoomCode("");
      connectSocket(pendingRoomCode, data.token);
      if (showOnboarding && onboardingStep < 2) setOnboardingStep(2);
    } catch {
      setPasswordError(t("networkError"));
    }
    setJoining(false);
  };

  useEffect(() => {
    if (roomCode) {
      const savedToken = sessionStorage.getItem("cloudclip-room-token") || "";
      if (savedToken) {
        roomTokenRef.current = savedToken;
        connectSocket(roomCode, savedToken);
      } else {
        void (async () => {
          await bootstrapCsrf();

          fetchWithCsrf(`/api/rooms/${encodeURIComponent(roomCode)}/join`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }).then(async (res) => {
            if (res.ok) {
              const data = await res.json();
              sessionStorage.setItem("cloudclip-room-token", data.token);
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
              }
            }
          }).catch(() => {});
        })();
      }
    }
    return () => { socketRef.current?.disconnect(); };
  }, [bootstrapCsrf, connectSocket, roomCode]);

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
      content: composeText.trim(), type, sourceDevice: deviceName,
      isSensitive: composeSettings.sensitive, burnAfterRead: composeSettings.burn,
      attachments: composeAttachments.length > 0 ? composeAttachments : undefined,
      targetDeviceId,
    });
    setComposeText("");
    setComposeAttachments([]);
    setComposeSettings({ sensitive: false, burn: false });
    setTargetDeviceId("all");
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
  const doClearAll = () => { socketRef.current?.emit("clear-room"); setShowClearConfirm(false); };
  const handleClearAll = () => { if (clips.length > 0) setShowClearConfirm(true); };

  const handleRestore = async (clip: Clip) => {
    const res = await fetchWithCsrf(
      `/api/rooms/${encodeURIComponent(roomCode)}/clips/${clip.id}/restore`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-room-token": roomTokenRef.current },
        body: JSON.stringify({}),
      }
    );
    if (res.ok) {
      setDeletedClips((d) => {
        const next = d.filter((c) => c.id !== clip.id);
        if (next.length === 0) setShowTrash(false);
        return next;
      });
    }
  };

  const handleToggleNotifications = () => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "denied") {
      alert(t("notificationsBlocked"));
      return;
    }
    if (Notification.permission === "granted") {
      const next = notifPerm === "granted" ? "default" : "granted";
      setNotifPerm(next as NotificationPermission);
      localStorage.setItem("cloudclip-notif-enabled", next === "granted" ? "1" : "0");
      return;
    }
    Notification.requestPermission().then((p) => {
      setNotifPerm(p);
      if (p === "granted") localStorage.setItem("cloudclip-notif-enabled", "1");
    });
  };

  const handleLeaveRoom = () => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    if (roomCode) localStorage.removeItem(`cloudclip-creator-${roomCode}`);
    setRoomCode("");
    setIsRoomCreator(false);
    setClips([]);
    setDeletedClips([]);
    setIsConnected(false);
    setOnlineCount(0);
    setRoomDevices([]);
    localStorage.removeItem("cloudclip-room");
    sessionStorage.removeItem("cloudclip-room-token");
    roomTokenRef.current = "";
  };

  const hashPin = async (pin: string): Promise<string> => {
    const bytes = new TextEncoder().encode(pin);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const handleLockApp = () => {
    if (!appLockPinHashRef.current) {
      setPinSetupValue("");
      setPinSetupError("");
      setShowPinSetup(true);
      return;
    }
    setLockPin("");
    setLockError(false);
    setIsLocked(true);
  };

  const handleConfirmPinSetup = async () => {
    const pin = pinSetupValue.trim();
    if (!/^\d{4,8}$/.test(pin)) {
      setPinSetupError(t("pinSetupError"));
      return;
    }
    appLockPinHashRef.current = await hashPin(pin);
    localStorage.setItem("cloudclip-app-lock-pin-hash", appLockPinHashRef.current);
    setShowPinSetup(false);
    setPinSetupValue("");
    setPinSetupError("");
    setLockPin("");
    setLockError(false);
    setIsLocked(true);
  };

  const handleUnlockApp = async () => {
    if (!appLockPinHashRef.current) {
      setIsLocked(false);
      return;
    }
    const current = await hashPin(lockPin);
    if (current === appLockPinHashRef.current) {
      setLockPin("");
      setLockError(false);
      setIsLocked(false);
      return;
    }
    setLockPin("");
    setLockError(true);
  };

  const handleToggleStar = (id: string) => {
    const nextPinned = !starredIds.has(id);
    socketRef.current?.emit("pin-clip", { clipId: id, pinned: nextPinned });
  };

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        return data.user as User;
      })
      .then((user) => setCurrentUser(user || null))
      .catch(() => setCurrentUser(null));
  }, []);

  useEffect(() => {
    const onBlurLock = () => {
      if (appLockPinHashRef.current && roomCode) {
        setIsLocked(true);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") onBlurLock();
    };
    window.addEventListener("blur", onBlurLock);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", onBlurLock);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [roomCode]);

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
  }).sort((a, b) => {
    const aPinned = starredIds.has(a.id);
    const bPinned = starredIds.has(b.id);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
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
            onChange={(e) => { setLockPin(e.target.value); setLockError(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleUnlockApp(); }}
            className={`w-full bg-black/5 dark:bg-white/10 border rounded-xl px-4 py-3 text-center text-gray-900 dark:text-white tracking-[0.5em] text-xl outline-none focus:bg-black/10 dark:focus:bg-white/20 transition-colors mb-2 ${lockError ? "border-red-500 bg-red-500/10" : "border-black/10 dark:border-white/20"}`}
            placeholder="••••"
            data-testid="input-lock-pin"
          />
          {lockError && (
            <p className="text-red-400 text-sm text-center mb-4">{t("lockError")}</p>
          )}
          {!lockError && <div className="mb-4" />}
          <button
            onClick={handleUnlockApp}
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
          <p className="text-gray-400 text-xs mb-6 text-center">{t("enter6Digit")}</p>
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
                    try {
                      await fetchWithCsrf("/api/auth/logout", { method: "POST" });
                    } catch {
                      // ignore network errors on client-side logout
                    }
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
    { key: "code", icon: <Code className="w-4 h-4" />, label: t("codes") },
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
            <NavItem icon={<Code />} label={t("codes")} active={activeFilter === "code"} onClick={() => setActiveFilter("code")} count={clips.filter((c) => c.type === "code").length} />
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
                onClick={handleLockApp}
                className="flex-1 flex items-center justify-center py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-600 dark:text-gray-300 transition-all"
                title={t("appLockFeature")}
              >
                <Lock className="w-4 h-4" />
              </button>
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
              <button
                onClick={handleToggleNotifications}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-xl transition-all ${notifPerm === "granted" ? "bg-green-500/20 text-green-600 dark:text-green-400" : "bg-white/10 hover:bg-white/20 text-gray-600 dark:text-gray-300"}`}
                title={notifPerm === "granted" ? t("notificationsOn") : t("notificationsOff")}
              >
                {notifPerm === "granted" ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              </button>
            </div>
            {deletedClips.length > 0 && (
              <button
                onClick={() => setShowTrash(true)}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                data-testid="button-open-trash"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deletedClips.length} {t("deletedClipsCount")}
              </button>
            )}
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
                  <div className="hidden sm:flex items-center gap-1.5">
                    <Crosshair className="w-3.5 h-3.5 text-gray-400" />
                    <select
                      value={targetDeviceId}
                      onChange={(e) => setTargetDeviceId(e.target.value)}
                      className="text-xs bg-white/10 border border-white/20 rounded-lg px-2 py-1.5 max-w-[170px]"
                      title={t("targetedDelivery")}
                    >
                      <option value="all">{t("allDevices")}</option>
                      {roomDevices
                        .filter((device) => device.deviceId !== deviceIdRef.current)
                        .map((device) => (
                          <option key={`${device.deviceId}-${device.socketId}`} value={device.deviceId}>
                            {device.deviceName}
                          </option>
                        ))}
                    </select>
                  </div>
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

          {!isIncognito && (
            <div className="px-3 sm:px-5 py-2 flex items-center gap-3 flex-shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  ref={searchInputRef}
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
              <button
                onClick={() => setShowShortcutsHelp(true)}
                className="p-2 rounded-lg text-gray-400 hover:bg-white/20 hover:text-gray-600 dark:hover:text-gray-200 transition-colors flex-shrink-0"
                title="Keyboard shortcuts (?)"
                data-testid="button-shortcuts-help"
              >
                <Keyboard className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 sm:p-5 pt-2">
            {isIncognito ? (
              <div className="h-[50vh] flex flex-col items-center justify-center text-center">
                <Ghost className="w-14 h-14 mb-4 text-purple-400 opacity-60" />
                <p className="text-base font-semibold text-purple-500 dark:text-purple-400">{t("incognitoActive")}</p>
                <p className="text-xs mt-2 text-gray-500 dark:text-gray-400 max-w-xs">{t("incognitoDesc")}</p>
              </div>
            ) : (
              <>
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
              </>
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

      {/* ===== Trash / Restore Modal ===== */}
      <AnimatePresence>
        {showTrash && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/40 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setShowTrash(false); }}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-2xl border border-white/20 w-full max-w-2xl rounded-t-3xl md:rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]"
            >
              <div className="p-5 border-b border-white/10 flex justify-between items-center">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Trash2 className="w-5 h-5 text-red-400" /> {t("recentlyDeleted")}
                </h2>
                <button onClick={() => setShowTrash(false)} className="p-2 rounded-full hover:bg-white/20 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="overflow-y-auto flex-1 p-4 space-y-2">
                {deletedClips.length === 0 ? (
                  <div className="h-40 flex flex-col items-center justify-center text-center opacity-50">
                    <Trash2 className="w-8 h-8 mb-2" />
                    <p className="text-sm">{t("noDeleted")}</p>
                  </div>
                ) : (
                  deletedClips.map((clip) => (
                    <div key={clip.id} className="flex items-center gap-3 p-3 rounded-xl glass-card">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-500 mb-0.5">{clip.sourceDevice} · {new Date(clip.timestamp).toLocaleString()}</p>
                        <p className="text-sm truncate opacity-70">{clip.content || `[${clip.type}]`}</p>
                      </div>
                      <button
                        onClick={() => handleRestore(clip)}
                        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                        data-testid={`button-restore-${clip.id}`}
                      >
                        <RotateCcw className="w-3 h-3" /> {t("restore")}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* ===== PIN Setup Modal ===== */}
      <AnimatePresence>
        {showPinSetup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
            onClick={() => setShowPinSetup(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-panel p-8 rounded-3xl w-full max-w-sm shadow-2xl border border-white/20 flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-14 h-14 rounded-full bg-blue-500/20 flex items-center justify-center mb-5">
                <Lock className="w-7 h-7 text-blue-500" />
              </div>
              <h2 className="text-xl font-bold mb-1 text-gray-900 dark:text-white">{t("pinSetupTitle")}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">4–8 digits</p>
              <input
                autoFocus
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={pinSetupValue}
                onChange={(e) => { setPinSetupValue(e.target.value.replace(/\D/g, "")); setPinSetupError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirmPinSetup(); }}
                placeholder={t("pinSetupPlaceholder")}
                className={`w-full text-center tracking-[0.4em] text-xl px-4 py-3 rounded-xl glass-input text-gray-900 dark:text-white outline-none mb-2 ${pinSetupError ? "border border-red-500" : ""}`}
                data-testid="input-pin-setup"
              />
              {pinSetupError && <p className="text-red-400 text-sm mb-3">{pinSetupError}</p>}
              {!pinSetupError && <div className="mb-3" />}
              <div className="flex gap-3 w-full mt-1">
                <button
                  onClick={() => setShowPinSetup(false)}
                  className="flex-1 py-2.5 rounded-xl border border-white/20 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-white/10 transition-colors"
                  data-testid="button-pin-cancel"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={handleConfirmPinSetup}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
                  data-testid="button-pin-confirm"
                >
                  {t("pinSetupConfirm")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== Clear All Confirmation ===== */}
      <AnimatePresence>
        {showClearConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
            onClick={() => setShowClearConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-panel p-7 rounded-3xl w-full max-w-sm shadow-2xl border border-white/20"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-5 h-5 text-red-500" />
                </div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t("confirmClearAll")}</h2>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t("confirmClearAllDesc")}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl border border-white/20 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-white/10 transition-colors"
                  data-testid="button-clear-cancel"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={doClearAll}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
                  data-testid="button-clear-confirm"
                >
                  {t("clearAll")}
                </button>
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
            roomToken={roomTokenRef.current}
            isRoomCreator={isRoomCreator}
            deviceName={deviceName}
            onDeviceNameSave={(value) => {
              const normalized = normalizeDeviceName(value);
              const persisted = saveDeviceName(normalized);
              const nextDeviceName = persisted || getDeviceName();
              setDeviceName(nextDeviceName);
              if (socketRef.current?.connected && roomCode) {
                socketRef.current.emit("join-room", {
                  roomCode,
                  token: roomTokenRef.current,
                  deviceId: deviceIdRef.current,
                  deviceName: nextDeviceName,
                });
              }
            }}
            onClose={() => setShowSettings(false)}
            onLeave={() => { handleLeaveRoom(); setShowSettings(false); }}
            lang={lang}
            setLang={setLang}
          />
        )}
      </AnimatePresence>

      {/* ===== Keyboard Shortcuts Help Modal ===== */}
      <AnimatePresence>
        {showShortcutsHelp && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
            onClick={() => setShowShortcutsHelp(false)}
            data-testid="modal-shortcuts"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-panel p-6 rounded-3xl w-full max-w-sm shadow-2xl border border-white/20"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Keyboard className="w-5 h-5 text-blue-500" />
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Keyboard Shortcuts</h2>
                </div>
                <button
                  onClick={() => setShowShortcutsHelp(false)}
                  className="p-1.5 rounded-full hover:bg-white/20 transition-colors"
                  data-testid="button-shortcuts-close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                {(() => {
                  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
                  return [
                    { keys: ["Esc"], desc: "Close any open modal" },
                    { keys: isMac ? ["⌘", "Enter"] : ["Ctrl", "Enter"], desc: "Send compose message" },
                    { keys: isMac ? ["⌘", "K"] : ["Ctrl", "K"], desc: "Focus search" },
                    { keys: ["?"], desc: "Toggle this help panel" },
                  ].map(({ keys, desc }) => (
                    <div key={desc} className="flex items-center justify-between py-2 border-b border-white/10 last:border-0">
                      <span className="text-sm text-gray-600 dark:text-gray-300">{desc}</span>
                      <div className="flex items-center gap-1">
                        {keys.map((k) => (
                          <kbd
                            key={k}
                            className="px-2 py-0.5 rounded-md bg-black/10 dark:bg-white/10 border border-black/10 dark:border-white/20 text-xs font-mono font-semibold text-gray-700 dark:text-gray-200"
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </motion.div>
          </motion.div>
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
