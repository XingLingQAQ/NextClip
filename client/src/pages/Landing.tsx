import { useState } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { Cloud, Shield, Zap, Smartphone, ArrowRight, Lock, Eye } from "lucide-react";

export default function Landing() {
  const [, setLocation] = useLocation();
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div className="min-h-screen relative flex flex-col font-sans text-gray-900 dark:text-white transition-colors duration-500 overflow-hidden">
      {/* Background with blur */}
      <div className="absolute inset-0 z-0 bg-black/10 dark:bg-black/40 backdrop-blur-sm pointer-events-none" />
      
      {/* Navigation */}
      <nav className="relative z-10 w-full p-6 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-500 to-cyan-400 flex items-center justify-center shadow-lg">
            <Cloud className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight text-white drop-shadow-md">CloudClip</span>
        </div>
        <div className="flex gap-4">
          <button className="text-sm font-medium text-white/80 hover:text-white transition-colors hidden sm:block px-4 py-2">Features</button>
          <button className="text-sm font-medium text-white/80 hover:text-white transition-colors hidden sm:block px-4 py-2">Security</button>
          <button 
            onClick={() => setLocation("/app")}
            className="text-sm font-medium bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-5 py-2 rounded-xl transition-all border border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.1)]"
          >
            Launch App
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-4 sm:px-6 mt-[-60px]">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-4xl mx-auto flex flex-col items-center"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass-panel border-white/30 text-white text-xs font-medium mb-8 shadow-xl">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
            End-to-End Encrypted Clipboard
          </div>
          
          <h1 className="text-5xl sm:text-6xl md:text-8xl font-extrabold tracking-tight text-white mb-6 drop-shadow-xl leading-tight">
            Sync across <br/> <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-300 to-purple-400">every device.</span>
          </h1>
          
          <p className="text-lg sm:text-xl text-white/80 max-w-2xl mb-10 font-medium drop-shadow-md leading-relaxed">
            A beautiful, fluid workspace that instantly beams your text, links, code, and images everywhere. Secured with military-grade encryption and app locks.
          </p>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onHoverStart={() => setIsHovered(true)}
            onHoverEnd={() => setIsHovered(false)}
            onClick={() => setLocation("/app")}
            className="group relative px-8 py-4 bg-white text-black rounded-2xl font-bold text-lg shadow-[0_0_40px_rgba(255,255,255,0.3)] hover:shadow-[0_0_60px_rgba(255,255,255,0.5)] transition-all flex items-center gap-3 overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            <span>Open Clipboard</span>
            <ArrowRight className={`w-5 h-5 transition-transform duration-300 ${isHovered ? 'translate-x-1' : ''}`} />
          </motion.button>
        </motion.div>

        {/* Feature Cards */}
        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl mt-24"
        >
          <FeatureCard 
            icon={<Zap className="w-6 h-6 text-yellow-400" />}
            title="Real-time Sync"
            description="Drag, drop, paste. Instantly available on your Mac, iPhone, and PC."
          />
          <FeatureCard 
            icon={<Lock className="w-6 h-6 text-blue-400" />}
            title="Privacy First"
            description="Incognito mode, App Lock, and Burn-after-read for your sensitive data."
          />
          <FeatureCard 
            icon={<Smartphone className="w-6 h-6 text-purple-400" />}
            title="PWA Ready"
            description="Install it as a native app on any device. Completely responsive."
          />
        </motion.div>
      </main>
      
      {/* Decorative elements */}
      <div className="fixed bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-black/60 to-transparent pointer-events-none z-0" />
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="glass-panel p-6 rounded-3xl border-white/20 bg-white/10 hover:bg-white/20 transition-all duration-300 text-left text-white transform hover:-translate-y-2 cursor-default">
      <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center mb-4 shadow-inner">
        {icon}
      </div>
      <h3 className="text-lg font-bold mb-2">{title}</h3>
      <p className="text-white/70 text-sm leading-relaxed">{description}</p>
    </div>
  );
}