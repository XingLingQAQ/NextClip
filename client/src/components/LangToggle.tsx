import { Globe } from "lucide-react";
import type { Lang } from "../i18n";

export function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <button
      onClick={() => setLang(lang === "zh" ? "en" : "zh")}
      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
      data-testid="button-lang-toggle"
    >
      <Globe className="w-3.5 h-3.5" />
      <span>{lang === "zh" ? "EN" : "中文"}</span>
    </button>
  );
}
