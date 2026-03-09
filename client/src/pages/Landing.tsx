import { useState } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { Cloud, Shield, Zap, Smartphone, ArrowRight, Lock, Eye, Flame, Ghost, QrCode, ClipboardPaste, Type, Star, Clock } from "lucide-react";

export default function Landing() {
  const [, setLocation] = useLocation();
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div className="min-h-screen min-h-[100dvh] relative flex flex-col font-sans text-gray-900 dark:text-white transition-colors duration-500 overflow-hidden">
      {/* Background with blur */}
      <div className="absolute inset-0 z-0 bg-black/10 dark:bg-black/40 backdrop-blur-sm pointer-events-none" />
      
      {/* Navigation */}
      <nav className="relative z-10 w-full p-4 sm:p-6 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-500 to-cyan-400 flex items-center justify-center shadow-lg">
            <Cloud className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight text-white drop-shadow-md">CloudClip</span>
        </div>
        <div className="flex gap-2 sm:gap-4 items-center">
          <button 
            onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            className="text-sm font-medium text-white/80 hover:text-white transition-colors hidden sm:block px-2 sm:px-4 py-2"
          >
            Features
          </button>
          <button 
            onClick={() => document.getElementById('security')?.scrollIntoView({ behavior: 'smooth' })}
            className="text-sm font-medium text-white/80 hover:text-white transition-colors hidden sm:block px-2 sm:px-4 py-2"
          >
            Security
          </button>
          <button 
            onClick={() => setLocation("/app")}
            className="text-sm font-medium bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-4 sm:px-5 py-2 rounded-xl transition-all border border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.1)] whitespace-nowrap"
          >
            Launch App
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-4 sm:px-6 mt-[-40px] md:mt-[-60px]">
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
          
          <h1 className="text-4xl sm:text-6xl md:text-8xl font-extrabold tracking-tight text-white mb-6 drop-shadow-xl leading-tight">
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

      </main>

      <section id="features" className="relative z-10 py-24 px-4 sm:px-6 max-w-7xl mx-auto w-full">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">Powerful Features</h2>
          <p className="text-white/70 max-w-2xl mx-auto text-lg">Everything you need to move data seamlessly between your devices.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-5xl mx-auto">
          <FeatureCard 
            icon={<Zap className="w-6 h-6 text-yellow-400" />}
            title="Real-time Sync"
            description="Type, drag, drop, or paste. Instantly broadcast texts, links, and images to all your connected screens."
          />
          <FeatureCard 
            icon={<ClipboardPaste className="w-6 h-6 text-blue-400" />}
            title="One-Click Extraction"
            description="Native API integration allows you to read from or write to your local system clipboard with a single click."
          />
          <FeatureCard 
            icon={<QrCode className="w-6 h-6 text-green-400" />}
            title="QR Code Handoff"
            description="Quickly generate dynamic QR codes for any snippet to let nearby devices scan and extract instantly."
          />
          <FeatureCard 
            icon={<Type className="w-6 h-6 text-purple-400" />}
            title="Smart Formatting"
            description="Auto-detects code, links, and text. Includes an option to extract rich content as pure plain text."
          />
          <FeatureCard 
            icon={<Smartphone className="w-6 h-6 text-cyan-400" />}
            title="Targeted Delivery"
            description="Don't want to broadcast? Select a specific device (e.g., 'Only send to my iPhone') to route content privately."
          />
          <FeatureCard 
            icon={<Star className="w-6 h-6 text-yellow-500" />}
            title="Pinned Snippets"
            description="Star your frequently used addresses, templates, and invoice headers to keep them at the top of your feed."
          />
        </div>
      </section>

      <section id="security" className="relative z-10 py-24 px-4 sm:px-6 max-w-7xl mx-auto w-full">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">Bank-level Security</h2>
          <p className="text-white/70 max-w-2xl mx-auto text-lg">Your clipboard often contains sensitive data. We make sure it stays yours.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-5xl mx-auto">
          <FeatureCard 
            icon={<Lock className="w-6 h-6 text-white" />}
            title="App Lock"
            description="Secure your clipboard with a PIN or password. Perfect for shared computers or office environments."
          />
          <FeatureCard 
            icon={<Eye className="w-6 h-6 text-blue-400" />}
            title="Sensitive Masking"
            description="Passwords and keys are marked as sensitive and hidden by default until you click to reveal them."
          />
          <FeatureCard 
            icon={<Flame className="w-6 h-6 text-red-400" />}
            title="Burn After Read"
            description="Send one-time secrets that self-destruct everywhere immediately after being copied once."
          />
          <FeatureCard 
            icon={<Shield className="w-6 h-6 text-green-400" />}
            title="E2E Encryption"
            description="All data is encrypted in your browser using your custom master key before hitting the network."
          />
          <FeatureCard 
            icon={<Ghost className="w-6 h-6 text-purple-400" />}
            title="Incognito Mode"
            description="Operate without a trace. Data lives only in memory and vanishes completely when you close the tab."
          />
          <FeatureCard 
            icon={<Clock className="w-6 h-6 text-orange-400" />}
            title="Auto Expiration"
            description="Set strict retention policies (e.g., 24 hours) to ensure old data is automatically swept away."
          />
        </div>
      </section>
      
      {/* Decorative elements */}
      <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-black/80 to-transparent pointer-events-none z-0" />
    </div>
  );
}

function FeatureCard({ icon, title, description, id }: { icon: React.ReactNode, title: string, description: string, id?: string }) {
  return (
    <div id={id} className="glass-panel p-6 rounded-3xl border-white/20 bg-white/5 hover:bg-white/10 transition-all duration-300 text-left text-white transform hover:-translate-y-2 cursor-default">
      <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center mb-4 shadow-inner">
        {icon}
      </div>
      <h3 className="text-lg font-bold mb-2">{title}</h3>
      <p className="text-white/70 text-sm leading-relaxed">{description}</p>
    </div>
  );
}