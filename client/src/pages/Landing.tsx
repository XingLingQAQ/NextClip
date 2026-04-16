import { useState } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import {
  Cloud, Shield, Zap, Smartphone, ArrowRight, Lock,
  Eye, Flame, Ghost, QrCode, ClipboardPaste, Type, Star, Clock, Globe, Menu, X,
} from "lucide-react";
import { useT } from "../i18n";

export default function Landing() {
  const [, setLocation] = useLocation();
  const [isHovered, setIsHovered] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { t, lang, setLang } = useT();

  return (
    <div className="min-h-screen min-h-[100dvh] relative flex flex-col font-sans text-gray-900 dark:text-white transition-colors duration-500 overflow-hidden">
      <div className="absolute inset-0 z-0 bg-black/10 dark:bg-black/40 backdrop-blur-sm pointer-events-none" />

      {/* ===== Navbar ===== */}
      <nav className="relative z-20 w-full px-4 sm:px-6 py-4 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-blue-500 to-cyan-400 flex items-center justify-center shadow-lg">
            <Cloud className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <span className="font-bold text-lg sm:text-xl tracking-tight text-white drop-shadow-md">CloudClip</span>
        </div>

        <div className="hidden sm:flex gap-2 sm:gap-3 items-center">
          <button
            onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })}
            className="text-sm font-medium text-white/80 hover:text-white transition-colors px-3 py-2"
          >
            {t("features")}
          </button>
          <button
            onClick={() => document.getElementById("security")?.scrollIntoView({ behavior: "smooth" })}
            className="text-sm font-medium text-white/80 hover:text-white transition-colors px-3 py-2"
          >
            {t("security")}
          </button>
          <button
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            className="text-sm font-medium text-white/70 hover:text-white transition-colors px-2 py-2 flex items-center gap-1"
            data-testid="button-lang-toggle-landing"
          >
            <Globe className="w-4 h-4" />
            <span>{lang === "zh" ? "EN" : "中文"}</span>
          </button>
          <button
            onClick={() => setLocation("/login")}
            className="text-sm font-medium text-white/80 hover:text-white transition-colors px-3 py-2"
            data-testid="link-landing-login"
          >
            {t("logIn")}
          </button>
          <button
            onClick={() => setLocation("/app")}
            className="text-sm font-medium bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-4 sm:px-5 py-2 rounded-xl transition-all border border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.1)] whitespace-nowrap"
          >
            {t("launchApp")}
          </button>
        </div>

        <div className="flex sm:hidden items-center gap-2">
          <button
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            className="p-2 text-white/70 hover:text-white"
            data-testid="button-lang-toggle-landing-mobile"
          >
            <Globe className="w-4 h-4" />
          </button>
          <button
            onClick={() => setLocation("/app")}
            className="text-xs font-medium bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-3 py-1.5 rounded-lg transition-all border border-white/20"
          >
            {t("launchApp")}
          </button>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-white/80 hover:text-white"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </nav>

      {mobileMenuOpen && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="relative z-20 sm:hidden mx-4 mb-2 glass-panel rounded-2xl p-4 space-y-2 border border-white/20"
        >
          <button
            onClick={() => { document.getElementById("features")?.scrollIntoView({ behavior: "smooth" }); setMobileMenuOpen(false); }}
            className="w-full text-left text-sm font-medium text-white/80 hover:text-white py-2 px-3 rounded-xl hover:bg-white/10 transition-colors"
          >
            {t("features")}
          </button>
          <button
            onClick={() => { document.getElementById("security")?.scrollIntoView({ behavior: "smooth" }); setMobileMenuOpen(false); }}
            className="w-full text-left text-sm font-medium text-white/80 hover:text-white py-2 px-3 rounded-xl hover:bg-white/10 transition-colors"
          >
            {t("security")}
          </button>
          <button
            onClick={() => setLocation("/login")}
            className="w-full text-left text-sm font-medium text-white/80 hover:text-white py-2 px-3 rounded-xl hover:bg-white/10 transition-colors"
          >
            {t("logIn")}
          </button>
        </motion.div>
      )}

      {/* ===== Hero ===== */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-4 sm:px-6 py-8 sm:py-0 mt-0 sm:mt-[-40px] md:mt-[-60px]">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-4xl mx-auto flex flex-col items-center"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass-panel border-white/30 text-white text-xs font-medium mb-6 sm:mb-8 shadow-xl">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            {t("e2eLabel")}
          </div>

          <h1 className="text-3xl xs:text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-extrabold tracking-tight text-white mb-4 sm:mb-6 drop-shadow-xl leading-tight">
            {t("heroTitle1")} <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-300 to-purple-400">
              {t("heroTitle2")}
            </span>
          </h1>

          <p className="text-base sm:text-lg md:text-xl text-white/80 max-w-2xl mb-8 sm:mb-10 font-medium drop-shadow-md leading-relaxed px-2">
            {t("heroDesc")}
          </p>

          <div className="flex flex-col xs:flex-row items-center gap-3 w-full xs:w-auto">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onHoverStart={() => setIsHovered(true)}
              onHoverEnd={() => setIsHovered(false)}
              onClick={() => setLocation("/app")}
              className="group relative w-full xs:w-auto px-7 py-3.5 sm:px-8 sm:py-4 bg-white text-black rounded-2xl font-bold text-base sm:text-lg shadow-[0_0_40px_rgba(255,255,255,0.3)] hover:shadow-[0_0_60px_rgba(255,255,255,0.5)] transition-all flex items-center justify-center gap-3 overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              <span>{t("openClipboard")}</span>
              <ArrowRight className={`w-5 h-5 transition-transform duration-300 ${isHovered ? "translate-x-1" : ""}`} />
            </motion.button>
            <button
              onClick={() => setLocation("/login")}
              className="text-sm font-medium text-white/70 hover:text-white underline underline-offset-4 transition-colors py-2 sm:hidden"
            >
              {t("logIn")}
            </button>
          </div>
        </motion.div>
      </main>

      {/* ===== Features ===== */}
      <section id="features" className="relative z-10 py-16 sm:py-24 px-4 sm:px-6 max-w-7xl mx-auto w-full">
        <div className="text-center mb-10 sm:mb-16">
          <h2 className="text-2xl sm:text-3xl md:text-5xl font-bold text-white mb-3 sm:mb-4">
            {t("powerfulFeatures")}
          </h2>
          <p className="text-white/70 max-w-2xl mx-auto text-base sm:text-lg">
            {t("featureSubtitle")}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 w-full max-w-5xl mx-auto">
          <FeatureCard icon={<Zap className="w-6 h-6 text-yellow-400" />} title={t("realTimeSync")} description={t("realTimeSyncDesc")} />
          <FeatureCard icon={<ClipboardPaste className="w-6 h-6 text-blue-400" />} title={t("oneClickExtraction")} description={t("oneClickExtractionDesc")} />
          <FeatureCard icon={<QrCode className="w-6 h-6 text-green-400" />} title={t("qrHandoff")} description={t("qrHandoffDesc")} />
          <FeatureCard icon={<Type className="w-6 h-6 text-purple-400" />} title={t("smartFormatting")} description={t("smartFormattingDesc")} />
          <FeatureCard icon={<Smartphone className="w-6 h-6 text-cyan-400" />} title={t("targetedDelivery")} description={t("targetedDeliveryDesc")} />
          <FeatureCard icon={<Star className="w-6 h-6 text-yellow-500" />} title={t("pinnedSnippets")} description={t("pinnedSnippetsDesc")} />
        </div>
      </section>

      {/* ===== Security ===== */}
      <section id="security" className="relative z-10 py-16 sm:py-24 px-4 sm:px-6 max-w-7xl mx-auto w-full">
        <div className="text-center mb-10 sm:mb-16">
          <h2 className="text-2xl sm:text-3xl md:text-5xl font-bold text-white mb-3 sm:mb-4">
            {t("bankSecurity")}
          </h2>
          <p className="text-white/70 max-w-2xl mx-auto text-base sm:text-lg">
            {t("securitySubtitle")}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 w-full max-w-5xl mx-auto">
          <FeatureCard icon={<Lock className="w-6 h-6 text-white" />} title={t("appLockFeature")} description={t("appLockDesc")} />
          <FeatureCard icon={<Eye className="w-6 h-6 text-blue-400" />} title={t("sensitiveMasking")} description={t("sensitiveMaskingDesc")} />
          <FeatureCard icon={<Flame className="w-6 h-6 text-red-400" />} title={t("burnAfterReadFeature")} description={t("burnAfterReadDesc")} />
          <FeatureCard icon={<Shield className="w-6 h-6 text-green-400" />} title={t("e2eEncryption")} description={t("e2eEncryptionDesc")} />
          <FeatureCard icon={<Ghost className="w-6 h-6 text-purple-400" />} title={t("incognitoFeature")} description={t("incognitoDesc")} />
          <FeatureCard icon={<Clock className="w-6 h-6 text-orange-400" />} title={t("autoExpiration")} description={t("autoExpirationDesc")} />
        </div>
      </section>

      <div className="absolute bottom-0 left-0 w-full h-1/3 bg-gradient-to-t from-black/80 to-transparent pointer-events-none z-0" />
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  id,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className="glass-panel p-5 sm:p-6 rounded-2xl sm:rounded-3xl border-white/20 bg-white/5 hover:bg-white/10 transition-all duration-300 text-left text-white hover:-translate-y-1 cursor-default"
    >
      <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-white/10 flex items-center justify-center mb-3 sm:mb-4 shadow-inner">
        {icon}
      </div>
      <h3 className="text-base sm:text-lg font-bold mb-1 sm:mb-2">{title}</h3>
      <p className="text-white/70 text-sm leading-relaxed">{description}</p>
    </div>
  );
}
