import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  Lock, LogIn, UserPlus, User as UserIcon,
  RefreshCw, ArrowLeft, Globe
} from "lucide-react";
import type { User } from "../lib/types";
import { useT } from "../i18n";
import { fetchWithCsrf } from "../lib/http";

export default function Auth({ mode }: { mode: "login" | "register" }) {
  const [, navigate] = useLocation();
  const { t, lang, setLang } = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isLogin = mode === "login";

  const handleSubmit = async () => {
    if (!username.trim() || !password) {
      setError(t("fillAllFields"));
      return;
    }
    if (!isLogin && password !== confirmPassword) {
      setError(t("passwordsNoMatch"));
      return;
    }
    if (!isLogin && password.length < 4) {
      setError(t("passwordMinLen"));
      return;
    }
    if (username.trim().length < 2) {
      setError(t("usernameMinLen"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";
      const res = await fetchWithCsrf(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Failed");
        setLoading(false);
        return;
      }
      navigate("/app");
    } catch {
      setError(t("networkError"));
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen min-h-[100dvh] p-4 flex items-center justify-center font-sans relative overflow-hidden">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="glass-panel p-8 rounded-3xl w-full max-w-sm z-10 flex flex-col items-center shadow-2xl border border-white/20">

        <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-500 to-cyan-400 flex items-center justify-center mb-6 shadow-lg">
          {isLogin ? <LogIn className="w-8 h-8 text-white" /> : <UserPlus className="w-8 h-8 text-white" />}
        </div>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1" data-testid="text-auth-title">
          {isLogin ? t("welcomeBack") : t("createAccount")}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6 text-center">
          {isLogin ? t("loginDesc") : t("registerDesc")}
        </p>

        <div className="w-full space-y-3">
          <div className="relative">
            <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/20 rounded-xl pl-10 pr-4 py-3 text-gray-900 dark:text-white outline-none focus:bg-black/10 dark:focus:bg-white/20 transition-colors placeholder-gray-400"
              placeholder={t("username")} data-testid="input-auth-username" />
          </div>

          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && isLogin) handleSubmit(); }}
              className="w-full bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/20 rounded-xl pl-10 pr-4 py-3 text-gray-900 dark:text-white outline-none focus:bg-black/10 dark:focus:bg-white/20 transition-colors placeholder-gray-400"
              placeholder={t("password")} data-testid="input-auth-password" />
          </div>

          {!isLogin && (
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                className="w-full bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/20 rounded-xl pl-10 pr-4 py-3 text-gray-900 dark:text-white outline-none focus:bg-black/10 dark:focus:bg-white/20 transition-colors placeholder-gray-400"
                placeholder={t("confirmPassword")} data-testid="input-auth-confirm" />
            </div>
          )}

          {error && <p className="text-red-400 text-xs text-center">{error}</p>}

          <button onClick={handleSubmit} disabled={loading}
            className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold shadow-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            data-testid="button-auth-submit">
            {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
            {isLogin ? t("logIn") : t("createAccount")}
          </button>
        </div>

        <div className="mt-6 flex flex-col items-center gap-3 w-full">
          <div className="h-px w-full bg-white/10" />

          {isLogin ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("noAccount")}{" "}
              <button onClick={() => navigate("/register")} className="text-blue-400 hover:text-blue-300 font-medium transition-colors" data-testid="link-register">
                {t("signUp")}
              </button>
            </p>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("hasAccount")}{" "}
              <button onClick={() => navigate("/login")} className="text-blue-400 hover:text-blue-300 font-medium transition-colors" data-testid="link-login">
                {t("logIn")}
              </button>
            </p>
          )}

          <button onClick={() => navigate("/app")}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors"
            data-testid="link-back-app">
            <ArrowLeft className="w-4 h-4" /> {t("continueWithout")}
          </button>

          <button onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors mt-1"
            data-testid="button-lang-toggle-auth">
            <Globe className="w-3.5 h-3.5" />
            <span>{lang === "zh" ? "EN" : "中文"}</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
