import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings, X, Hash, Users, Shield, Unlock, Lock,
  RefreshCw, Timer, LogOut, QrCode,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { Clip, User } from "@shared/schema";
import { useT, type Lang } from "../i18n";
import { PinInput } from "./PinInput";
import { LangToggle } from "./LangToggle";

const EXPIRY_OPTIONS_KEYS: Array<{
  labelKey: "hour1" | "hours24" | "days7" | "days30" | "permanent";
  value: string;
}> = [
  { labelKey: "hour1", value: "1" },
  { labelKey: "hours24", value: "24" },
  { labelKey: "days7", value: "168" },
  { labelKey: "days30", value: "720" },
  { labelKey: "permanent", value: "permanent" },
];

export function SettingsModal({
  roomCode,
  onlineCount,
  clips,
  currentUser,
  roomToken,
  onClose,
  onLeave,
  lang,
  setLang: setLangFn,
}: {
  roomCode: string;
  onlineCount: number;
  clips: Clip[];
  currentUser: User | null;
  roomToken: string;
  onClose: () => void;
  onLeave: () => void;
  lang: Lang;
  setLang: (l: Lang) => void;
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
    fetch(`/api/rooms/${encodeURIComponent(roomCode)}`)
      .then((r) => r.json())
      .then((data) => {
        setHasPassword(data.hasPassword || false);
        setExpiresAt(data.expiresAt || null);
        setOwnerId(data.ownerId || null);
        if (!data.expiresAt) {
          setSelectedExpiry("permanent");
        } else {
          const remainH =
            (new Date(data.expiresAt).getTime() - Date.now()) / 3600000;
          const sorted = EXPIRY_OPTIONS_KEYS.filter(
            (o) => o.value !== "permanent"
          ).map((o) => ({ ...o, h: Number(o.value) }));
          const closest = sorted.reduce<(typeof sorted)[0] | null>(
            (best, o) => {
              if (!best) return o;
              return Math.abs(o.h - remainH) < Math.abs(best.h - remainH)
                ? o
                : best;
            },
            null
          );
          setSelectedExpiry(closest?.value || null);
        }
      });
  }, [roomCode]);

  const handleSetPassword = async (pwd: string | null) => {
    setSavingPassword(true);
    await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: pwd,
        token: roomToken,
        userId: currentUser?.id,
      }),
    });
    setHasPassword(!!pwd);
    setRoomPassword("");
    setSavingPassword(false);
  };

  const handleSetExpiry = async (hours: string) => {
    setSavingExpiry(true);
    const res = await fetch(
      `/api/rooms/${encodeURIComponent(roomCode)}/expiry`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expiryHours: hours,
          token: roomToken,
          userId: currentUser?.id,
        }),
      }
    );
    const data = await res.json();
    if (res.ok) {
      setExpiresAt(data.expiresAt || null);
      setSelectedExpiry(hours);
    }
    setSavingExpiry(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="bg-white/80 dark:bg-black/80 backdrop-blur-2xl border border-white/20 w-full max-w-2xl rounded-t-3xl md:rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Settings className="w-5 h-5" /> {t("settings")}
          </h2>
          <div className="flex items-center gap-3">
            <LangToggle lang={lang} setLang={setLangFn} />
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-white/20"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          <section>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              {t("connection")}
            </h3>
            <div className="space-y-3">
              <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
                <div>
                  <div className="font-medium flex items-center gap-2">
                    <Hash className="w-4 h-4 text-blue-500" /> {t("roomCode")}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {t("shareDevices")}
                  </div>
                </div>
                <span className="text-lg font-mono font-bold tracking-wider bg-white/20 dark:bg-white/10 px-4 py-1.5 rounded-xl">
                  {roomCode}
                </span>
              </div>
              <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
                <div className="font-medium flex items-center gap-2">
                  <Users className="w-4 h-4 text-green-500" /> {t("online")}
                </div>
                <span className="text-lg font-bold">{onlineCount}</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              {t("qrCodeSection")}
            </h3>
            <div className="glass-card p-4 rounded-2xl flex flex-col items-center gap-3" data-testid="section-qr-code">
              <div className="bg-white p-3 rounded-xl shadow-sm" data-testid="qr-code-image">
                <QRCodeSVG
                  value={`${window.location.origin}?room=${encodeURIComponent(roomCode)}`}
                  size={160}
                  bgColor="#ffffff"
                  fgColor="#000000"
                  level="M"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center flex items-center gap-1.5">
                <QrCode className="w-3.5 h-3.5 shrink-0" />
                {t("scanToJoin")}
              </p>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              {t("roomPassword")}
            </h3>
            <div className="glass-card p-4 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  {hasPassword ? (
                    <>
                      <Shield className="w-4 h-4 text-green-500" />
                      <span className="font-medium">{t("passwordProtected")}</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-4 h-4 text-gray-400" />
                      <span className="font-medium text-gray-400">{t("noPassword")}</span>
                    </>
                  )}
                </div>
                {hasPassword && isOwner && (
                  <button
                    data-testid="button-remove-password"
                    onClick={() => handleSetPassword(null)}
                    disabled={savingPassword}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    {t("remove")}
                  </button>
                )}
              </div>
              {!hasPassword && isOwner && (
                <div className="space-y-2">
                  <PinInput value={roomPassword} onChange={setRoomPassword} />
                  <button
                    data-testid="button-set-password"
                    onClick={() => {
                      if (roomPassword.length === 6) handleSetPassword(roomPassword);
                    }}
                    disabled={roomPassword.length !== 6 || savingPassword}
                    className="w-full text-sm py-2 rounded-lg bg-blue-600/20 text-blue-600 dark:text-blue-400 font-medium disabled:opacity-50 hover:bg-blue-600/30 transition-colors flex items-center justify-center gap-1"
                  >
                    {savingPassword ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Lock className="w-3 h-3" />
                    )}
                    {t("setPassword")}
                  </button>
                </div>
              )}
              {!isOwner && (
                <p className="text-xs text-gray-400 italic">{t("ownerOnly")}</p>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              {t("roomExpiry")}
            </h3>
            <div className="glass-card p-4 rounded-2xl space-y-3">
              <div className="text-sm text-gray-500">
                {expiresAt ? (
                  <span className="flex items-center gap-2">
                    <Timer className="w-4 h-4 text-orange-400" /> {t("expires")}:{" "}
                    {new Date(expiresAt).toLocaleString()}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Timer className="w-4 h-4 text-green-400" /> {t("permanentRoom")}
                  </span>
                )}
              </div>
              {isOwner ? (
                <div className="flex flex-wrap gap-1.5">
                  {EXPIRY_OPTIONS_KEYS.map((opt) => {
                    const disabled = opt.value === "permanent" && !currentUser;
                    const isSelected = selectedExpiry === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => !disabled && handleSetExpiry(opt.value)}
                        disabled={disabled || savingExpiry}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-all border font-medium
                          ${
                            disabled
                              ? "bg-gray-200/20 dark:bg-white/5 border-gray-300/20 dark:border-white/5 text-gray-400 dark:text-gray-600 cursor-not-allowed"
                              : isSelected
                              ? "bg-blue-500/30 border-blue-400/50 text-blue-600 dark:text-blue-300 shadow-sm"
                              : "bg-gray-900/80 dark:bg-white/15 border-gray-700 dark:border-white/20 text-white dark:text-gray-200 hover:bg-gray-900 dark:hover:bg-white/25"
                          }`}
                        title={disabled ? t("loginRequired") : ""}
                      >
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
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              {t("stats")}
            </h3>
            <div className="glass-card p-4 rounded-2xl">
              <div className="grid grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold">{clips.length}</div>
                  <div className="text-xs text-gray-500">{t("total")}</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">
                    {clips.filter((c) =>
                      ["text", "code", "link"].includes(c.type)
                    ).length}
                  </div>
                  <div className="text-xs text-gray-500">{t("texts")}</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">
                    {clips.filter((c) => c.type === "image").length}
                  </div>
                  <div className="text-xs text-gray-500">{t("images")}</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">
                    {
                      clips.filter((c) =>
                        ["file", "mixed"].includes(c.type)
                      ).length
                    }
                  </div>
                  <div className="text-xs text-gray-500">{t("files")}</div>
                </div>
              </div>
            </div>
          </section>

          <button
            onClick={onLeave}
            className="w-full py-3 rounded-xl bg-red-500/10 text-red-500 font-semibold hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" /> {t("leaveRoom")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
