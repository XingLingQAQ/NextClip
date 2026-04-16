import { useRef } from "react";

export function PinInput({ value, onChange, length = 6 }: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (i: number, raw: string) => {
    const char = raw.replace(/\D/g, "").slice(-1);
    const arr = value.split("");
    while (arr.length < length) arr.push("");
    arr[i] = char;
    const newVal = arr.join("").slice(0, length);
    onChange(newVal);
    if (char && i < length - 1) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !value[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    onChange(pasted);
    const nextIdx = Math.min(pasted.length, length - 1);
    refs.current[nextIdx]?.focus();
  };

  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={value[i] || ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className="w-11 h-13 bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/20 rounded-xl text-center text-gray-900 dark:text-white text-xl font-bold outline-none focus:bg-black/10 dark:focus:bg-white/20 focus:border-blue-400 transition-all"
          data-testid={`input-pin-${i}`}
        />
      ))}
    </div>
  );
}
