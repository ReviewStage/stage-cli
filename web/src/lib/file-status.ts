import { File, FileInput, FilePlus, FileType, FileX } from "lucide-react";
import type { ElementType } from "react";
import { FILE_STATUS, type FileStatus } from "./diff-types";

export const FILE_STATUS_ICONS: Record<FileStatus, ElementType> = {
  [FILE_STATUS.ADDED]: FilePlus,
  [FILE_STATUS.MODIFIED]: File,
  [FILE_STATUS.DELETED]: FileX,
  [FILE_STATUS.RENAMED]: FileType,
  [FILE_STATUS.MOVED]: FileInput,
};

export const FILE_STATUS_TEXT_COLORS: Record<FileStatus, string> = {
  [FILE_STATUS.ADDED]: "text-green-500",
  [FILE_STATUS.MODIFIED]: "text-muted-foreground",
  [FILE_STATUS.DELETED]: "text-red-500",
  [FILE_STATUS.RENAMED]: "text-yellow-500",
  [FILE_STATUS.MOVED]: "text-yellow-500",
};

export const FILE_STATUS_LABELS: Record<FileStatus, string> = {
  [FILE_STATUS.ADDED]: "Added",
  [FILE_STATUS.MODIFIED]: "Modified",
  [FILE_STATUS.DELETED]: "Deleted",
  [FILE_STATUS.RENAMED]: "Renamed",
  [FILE_STATUS.MOVED]: "Moved",
};
