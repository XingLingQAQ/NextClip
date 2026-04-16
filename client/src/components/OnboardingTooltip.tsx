import { motion } from "framer-motion";
import { ArrowRight, X } from "lucide-react";

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
  const defaultClass = `absolute ${position === "bottom" ? "top-full mt-4" : "bottom-full mb-4"} left-0 right-0 z-50`;

  return (
    <motion.div
      initial={{ opacity: 0, y: position === "bottom" ? -6 : 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={className || defaultClass}
    >
      {/* Arrow caret */}
      <div
        className={`absolute ${
          position === "bottom" ? "-top-1.5 left-6" : "-bottom-1.5 left-6"
        } w-3 h-3 bg-slate-900 dark:bg-slate-800 rotate-45 rounded-[2px] border-l border-t border-white/10`}
      />

      <div className="bg-slate-900 dark:bg-slate-800 text-white rounded-2xl px-4 py-3.5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] relative border border-white/10">
        {/* Top row: dots + step + skip */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-3">
            <div className="flex gap-1 items-center">
              {Array.from({ length: total }).map((_, i) => (
                <span
                  key={i}
                  className={`rounded-full transition-all duration-300 ${
                    i === step - 1
                      ? "bg-blue-400 w-4 h-1.5"
                      : "bg-white/25 w-1.5 h-1.5"
                  }`}
                />
              ))}
            </div>
            <span className="text-[10px] text-white/40 font-medium tabular-nums">
              {step}/{total}
            </span>
          </div>
          <button
            onClick={onSkip}
            className="p-1 rounded-full hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
            aria-label="Skip onboarding"
          >
            <X className="w-3 h-3" />
          </button>
        </div>

        <h4 className="font-semibold text-sm leading-snug mb-1">{title}</h4>
        <p className="text-xs text-white/65 leading-relaxed mb-3">{desc}</p>

        <button
          onClick={onNext}
          className="w-full py-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm"
        >
          {isLast ? (
            t("gotIt")
          ) : (
            <>
              {t("next")}
              <ArrowRight className="w-3 h-3" />
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}
