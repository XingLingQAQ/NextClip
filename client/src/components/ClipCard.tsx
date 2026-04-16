import { useState } from "react";
import { motion } from "framer-motion";
import {
  Copy, Trash2, Star, FileText, Link2, Image as ImageIcon,
  Scissors, File, Paperclip, Shield, Flame, CheckCircle2,
  Eye, EyeOff, Download, Smartphone,
} from "lucide-react";
import type { Clip, Attachment } from "@shared/schema";
import { formatFileSize, downloadDataUrl, getDeviceName } from "../lib/clipUtils";

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
  const [showSensitive, setShowSensitive] = useState(!clip.isSensitive);

  const getIcon = (type: Clip["type"]) => {
    switch (type) {
      case "text": return <FileText className="w-4 h-4 text-blue-500" />;
      case "link": return <Link2 className="w-4 h-4 text-green-500" />;
      case "image": return <ImageIcon className="w-4 h-4 text-purple-500" />;
      case "code": return <Scissors className="w-4 h-4 text-orange-500" />;
      case "file": return <File className="w-4 h-4 text-gray-500" />;
      case "mixed": return <Paperclip className="w-4 h-4 text-cyan-500" />;
    }
  };

  const formattedTime = new Date(clip.timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

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
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: "blur(10px)" }}
      transition={{ duration: 0.3 }}
      className={`glass-card rounded-2xl p-5 flex flex-col group relative overflow-hidden cursor-pointer ${
        isImageOnly ? "h-[220px]" : "min-h-[160px]"
      } ${clip.burnAfterRead ? "border-red-500/30" : ""}`}
      onClick={() => {
        isImageOnly && firstImageAtt ? onPreviewAttachment(firstImageAtt) : onOpenDetail();
      }}
      data-testid={`card-clip-${clip.id}`}
    >
      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white/50 dark:bg-black/50 px-2.5 py-1 rounded-lg backdrop-blur-md shadow-sm">
            {getIcon(clip.type)}
            <span className="text-xs font-semibold capitalize opacity-80">{clip.type}</span>
          </div>
          {clip.isSensitive && (
            <div className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 p-1 rounded-md">
              <Shield className="w-3 h-3" />
            </div>
          )}
          {clip.burnAfterRead && (
            <div className="bg-red-500/20 text-red-600 dark:text-red-400 p-1 rounded-md">
              <Flame className="w-3 h-3" />
            </div>
          )}
          {hasAttachments && (
            <div className="bg-blue-500/20 text-blue-600 dark:text-blue-400 p-1 rounded-md">
              <Paperclip className="w-3 h-3" />
            </div>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
          className={`p-1.5 rounded-full transition-colors flex-shrink-0 ${
            isStarred ? "text-yellow-500" : "text-gray-400 hover:bg-black/5 dark:hover:bg-white/10"
          }`}
        >
          <Star className="w-4 h-4" fill={isStarred ? "currentColor" : "none"} />
        </button>
      </div>

      <div className={`relative z-10 flex flex-col flex-1 ${isImageOnly ? "overflow-hidden" : ""}`}>
        {clip.isSensitive && !showSensitive ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
            <p className="text-2xl tracking-[0.3em] font-mono opacity-50">••••••••</p>
            <button
              onClick={(e) => { e.stopPropagation(); setShowSensitive(true); }}
              className="mt-2 text-xs flex items-center gap-1 text-blue-500 hover:underline"
            >
              <Eye className="w-3 h-3" /> {t("tapToReveal")}
            </button>
          </div>
        ) : isImageOnly && firstImageAtt ? (
          <div className="absolute inset-0 -mx-5 -my-4 pt-14 pb-12">
            <img
              src={firstImageAtt.data}
              alt={firstImageAtt.name}
              className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-700"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" />
          </div>
        ) : isFileOnly && hasAttachments ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 py-4">
            <File className="w-10 h-10 text-gray-400" />
            <p className="text-sm font-medium truncate max-w-full">{clip.attachments![0].name}</p>
            <p className="text-[10px] opacity-60">{formatFileSize(clip.attachments![0].size)}</p>
          </div>
        ) : clip.type === "code" ? (
          <pre className="text-xs font-mono p-2 bg-black/5 dark:bg-black/30 rounded-xl overflow-hidden max-h-[120px] line-clamp-6">
            <code>{clip.content}</code>
          </pre>
        ) : clip.type === "link" ? (
          <a
            href={clip.content}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline break-all line-clamp-3"
          >
            {clip.content}
          </a>
        ) : (
          <div>
            <p className="text-sm leading-relaxed font-medium line-clamp-4 whitespace-pre-wrap">{clip.content}</p>
            {hasAttachments && (
              <div className="flex items-center gap-1 mt-2 text-[10px] opacity-60">
                <Paperclip className="w-3 h-3" />
                {clip.attachments!.map((a) => a.name).join(", ")}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className={`mt-3 flex items-center justify-between relative z-10 flex-shrink-0 ${
          isImageOnly ? "text-white" : "text-gray-500 dark:text-gray-400"
        }`}
      >
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] font-medium opacity-80">{formattedTime}</span>
          <span
            className={`text-[10px] flex items-center gap-1 min-w-0 ${
              isCurrentDevice
                ? "text-blue-500 dark:text-blue-400 font-semibold opacity-90"
                : "opacity-60"
            }`}
            data-testid={`label-device-${clip.id}`}
          >
            <Smartphone className="w-2.5 h-2.5 flex-shrink-0" />
            <span className="truncate">{clip.sourceDevice}</span>
          </span>
        </div>
        <div className="flex items-center gap-1 bg-white/40 dark:bg-black/40 backdrop-blur-md rounded-xl p-1 shadow-sm opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
          {clip.isSensitive && showSensitive && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowSensitive(false); }}
              className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10"
            >
              <EyeOff className="w-4 h-4" />
            </button>
          )}
          {hasAttachments && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                downloadDataUrl(clip.attachments![0].data, clip.attachments![0].name);
              }}
              className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10"
            >
              <Download className="w-4 h-4" />
            </button>
          )}
          {hasTextContent && (
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(clip.burnAfterRead); }}
              className={`p-1.5 rounded-lg transition-colors ${
                isCopied
                  ? "bg-green-500/20 text-green-600 dark:text-green-400"
                  : "hover:bg-black/10 dark:hover:bg-white/10"
              }`}
            >
              {isCopied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-500"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
