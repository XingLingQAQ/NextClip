import { useState } from "react";
import { motion } from "framer-motion";
import {
  Copy, Trash2, Star, FileText, Link2, Image as ImageIcon,
  Scissors, File, Paperclip, Shield, Flame, CheckCircle2,
  Eye, EyeOff, Download, Smartphone,
} from "lucide-react";
import type { Clip, Attachment } from "../lib/types";
import { formatFileSize, downloadDataUrl, getDeviceName, formatRelativeTime } from "../lib/clipUtils";

export function ClipCard({
  clip,
  isStarred,
  onCopy,
  onDelete,
  onToggleStar,
  onOpenDetail,
  onPreviewAttachment,
  isCopied,
  t,
}: {
  clip: Clip;
  isStarred: boolean;
  isCopied: boolean;
  onCopy: (burn?: boolean) => void;
  onDelete: () => void;
  onToggleStar: () => void;
  onOpenDetail: () => void;
  onPreviewAttachment: (att: Attachment) => void;
  t: (key: any) => string;
}) {
  const [showSensitive, setShowSensitive] = useState(!(clip.isSensitive || clip.burnAfterRead));

  const getIcon = (type: Clip["type"]) => {
    switch (type) {
      case "text": return <FileText className="w-3.5 h-3.5 text-blue-500" />;
      case "link": return <Link2 className="w-3.5 h-3.5 text-green-500" />;
      case "image": return <ImageIcon className="w-3.5 h-3.5 text-purple-500" />;
      case "code": return <Scissors className="w-3.5 h-3.5 text-orange-500" />;
      case "file": return <File className="w-3.5 h-3.5 text-gray-500" />;
      case "mixed": return <Paperclip className="w-3.5 h-3.5 text-cyan-500" />;
    }
  };

  const formattedTime = formatRelativeTime(clip.timestamp);

  const currentDevice = getDeviceName();
  const isCurrentDevice = clip.sourceDevice === currentDevice;

  const hasAttachments = clip.attachments && clip.attachments.length > 0;
  const firstImageAtt = clip.attachments?.find((a) => a.mimeType.startsWith("image/"));
  const isImageOnly = clip.type === "image" && firstImageAtt && !clip.content;
  const isFileOnly = clip.type === "file" && hasAttachments && !clip.content;
  const hasTextContent = clip.content && clip.content.trim().length > 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={`glass-card rounded-2xl flex flex-col group relative overflow-hidden cursor-pointer border border-white/40 dark:border-white/10 hover:border-white/60 hover:shadow-md transition-all duration-200 ${
        isImageOnly ? "h-[200px]" : "min-h-[148px]"
      } ${clip.burnAfterRead ? "border-red-400/30 dark:border-red-500/20" : ""}`}
      onClick={() => {
        if ((clip.isSensitive || clip.burnAfterRead) && !showSensitive) return;
        isImageOnly && firstImageAtt ? onPreviewAttachment(firstImageAtt) : onOpenDetail();
      }}
      data-testid={`card-clip-${clip.id}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 bg-black/5 dark:bg-white/10 px-2 py-0.5 rounded-md">
            {getIcon(clip.type)}
            <span className="text-[10px] font-semibold capitalize opacity-70 tracking-wide">{clip.type}</span>
          </div>
          {clip.isSensitive && (
            <div className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
              <Shield className="w-2.5 h-2.5" />
              <span className="text-[9px] font-semibold">SENSITIVE</span>
            </div>
          )}
          {clip.burnAfterRead && (
            <div className="bg-red-500/15 text-red-500 dark:text-red-400 px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
              <Flame className="w-2.5 h-2.5" />
              <span className="text-[9px] font-semibold">BURN</span>
            </div>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
          className={`p-1.5 rounded-full transition-all flex-shrink-0 hover:scale-110 active:scale-95 ${
            isStarred ? "text-yellow-500" : "text-gray-300 dark:text-gray-600 hover:text-yellow-400"
          }`}
          data-testid={`button-star-${clip.id}`}
        >
          <Star className="w-3.5 h-3.5" fill={isStarred ? "currentColor" : "none"} />
        </button>
      </div>

      {/* Content */}
      <div className={`px-4 flex-1 relative ${isImageOnly ? "overflow-hidden pb-10" : "pb-2"}`}>
        {(clip.isSensitive || clip.burnAfterRead) && !showSensitive ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-2">
            <p className="text-xl tracking-[0.4em] font-mono opacity-30">•••••••</p>
            {clip.burnAfterRead ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSensitive(true);
                  onCopy(true);
                  setTimeout(() => setShowSensitive(false), 4000);
                }}
                className="mt-2 text-xs flex items-center gap-1 text-red-500 hover:text-red-400 transition-colors font-medium"
              >
                <Flame className="w-3 h-3" /> {t("readAndBurn")}
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setShowSensitive(true); }}
                className="mt-2 text-xs flex items-center gap-1 text-blue-500 hover:text-blue-400 transition-colors"
              >
                <Eye className="w-3 h-3" /> {t("tapToReveal")}
              </button>
            )}
          </div>
        ) : isImageOnly && firstImageAtt ? (
          <div className="absolute inset-0 -mx-4 -mt-2">
            <img
              src={firstImageAtt.data}
              alt={firstImageAtt.name}
              className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-700"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/70" />
          </div>
        ) : isFileOnly && hasAttachments ? (
          <div className="flex flex-col items-center justify-center h-full gap-1.5 py-2">
            <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-white/10 flex items-center justify-center">
              <File className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-xs font-medium truncate max-w-full text-center">{clip.attachments![0].name}</p>
            <p className="text-[10px] opacity-50">{formatFileSize(clip.attachments![0].size)}</p>
          </div>
        ) : clip.type === "code" ? (
          <pre className="text-[11px] font-mono p-2.5 bg-black/5 dark:bg-black/40 rounded-xl overflow-hidden max-h-[100px] line-clamp-5 text-gray-800 dark:text-gray-200">
            <code>{clip.content}</code>
          </pre>
        ) : clip.type === "link" ? (
          <a
            href={clip.content}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline break-all line-clamp-3 block"
          >
            {clip.content}
          </a>
        ) : (
          <div>
            <p className="text-sm leading-relaxed line-clamp-4 whitespace-pre-wrap text-gray-800 dark:text-gray-200">{clip.content}</p>
            {hasAttachments && (
              <div className="flex items-center gap-1 mt-1.5 text-[10px] opacity-50">
                <Paperclip className="w-2.5 h-2.5" />
                <span className="truncate">{clip.attachments!.map((a) => a.name).join(", ")}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className={`flex items-center justify-between px-4 pb-3 pt-1.5 border-t border-black/5 dark:border-white/5 flex-shrink-0 ${
          isImageOnly ? "absolute bottom-0 left-0 right-0 border-transparent" : ""
        } ${isImageOnly ? "text-white/90" : "text-gray-500 dark:text-gray-400"}`}
      >
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[10px] opacity-60">{formattedTime}</span>
          <span
            className={`text-[10px] flex items-center gap-0.5 min-w-0 mt-0.5 ${
              isCurrentDevice
                ? "text-blue-500 dark:text-blue-400 font-semibold"
                : "opacity-50"
            }`}
            data-testid={`label-device-${clip.id}`}
          >
            <Smartphone className="w-2.5 h-2.5 flex-shrink-0" />
            <span className="truncate">{clip.sourceDevice}</span>
          </span>
        </div>

        {/* Action buttons — always visible on mobile, hover-revealed on desktop */}
        <div
          className={`flex items-center gap-0.5 ml-2 flex-shrink-0
            md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0
            transition-all duration-200
            ${isImageOnly ? "bg-black/30" : "bg-black/5 dark:bg-white/10"}
            backdrop-blur-md rounded-xl p-0.5`}
          onClick={(e) => e.stopPropagation()}
        >
          {clip.isSensitive && showSensitive && (
            <button
              onClick={() => setShowSensitive(false)}
              className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              title={t("sensitive")}
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          )}
          {hasAttachments && (
            <button
              onClick={() => downloadDataUrl(clip.attachments![0].data, clip.attachments![0].name)}
              className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              title={t("download")}
              data-testid={`button-download-${clip.id}`}
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
          {hasTextContent && (
            <button
              onClick={() => onCopy(clip.burnAfterRead)}
              className={`p-1.5 rounded-lg transition-all ${
                isCopied
                  ? "bg-green-500/20 text-green-600 dark:text-green-400"
                  : "hover:bg-black/10 dark:hover:bg-white/10"
              }`}
              title={t("copy")}
              data-testid={`button-copy-${clip.id}`}
            >
              {isCopied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            onClick={() => onDelete()}
            className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-500 transition-colors"
            title={t("clearAll")}
            data-testid={`button-delete-${clip.id}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
