import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export function OnboardingTooltip({
  position,
  step,
  total,
  title,
  desc,
  onNext,
  onSkip,
  isLast,
  className,
  t,
}: {
  position: "top" | "bottom";
  step: number;
  total: number;
  title: string;
  desc: string;
  onNext: () => void;
  onSkip: () => void;
  isLast?: boolean;
  className?: string;
  t: (key: any) => string;
}) {
  const defaultClass = `absolute ${position === "bottom" ? "top-full mt-3" : "bottom-full mb-3"} left-0 right-0 z-50`;

  return (
    <motion.div
      initial={{ opacity: 0, y: position === "bottom" ? -8 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={className || defaultClass}
    >
      <div className={`absolute ${position === "bottom" ? "-top-2 left-8" : "-bottom-2 left-8"} w-4 h-4 bg-blue-600 rotate-45 rounded-sm`} />
      <div className="bg-blue-600 text-white rounded-2xl p-4 shadow-2xl relative">
        <div className="flex items-center justify-between mb-2">
          <div className="flex gap-1.5 items-center">
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                  i === step - 1 ? "bg-white scale-125" : "bg-white/40"
                }`}
              />
            ))}
          </div>
          <button
            onClick={onSkip}
            className="text-[10px] opacity-70 hover:opacity-100 transition-opacity ml-2"
          >
            {t("skip")}
          </button>
        </div>
        <h4 className="font-bold text-sm mb-1">{title}</h4>
        <p className="text-xs opacity-90 leading-relaxed mb-3">{desc}</p>
        <button
          onClick={onNext}
          className="w-full py-2 rounded-xl bg-white text-blue-600 font-semibold text-sm hover:bg-blue-50 transition-colors flex items-center justify-center gap-1"
        >
          {isLast ? t("gotIt") : t("next")}
          {!isLast && <ArrowRight className="w-3.5 h-3.5" />}
        </button>
      </div>
    </motion.div>
  );
}
