import { AxiosRequestConfig } from "axios";

enum FileHierarchyFileType {
  FILE = "FILE",
  FOLDER = "FOLDER",
}
type FileHierarchy = {
  path: string;
  type: FileHierarchyFileType;
  orignalWebkitPath: string;
  file?: File;
};
//
enum UploadType {
  FILES = "FILES",
  FILES_HIERARCHY = "FILES_HIERARCHY",
}
enum FileStatus {
  IN_QUEUE = "IN_QUEUE",
  IN_PROGRESS = "IN_PROGRESS",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
}
type FileObj = {
  file: File | null;
  fileHierarchy: FileHierarchy | null;
  status: FileStatus;
  uploadCount?: number;
  downloadCount?: number;
  cancel?: () => void;
  isCancelled?: boolean;
  id: string;
  lastProgressUpdated?: number;
};
type Constructor = {
  concurrency: number;
  onUpdate?: (event: EventType) => void;
  requestOptions?: {
    downloadProgress?: boolean;
    uploadProgress?: boolean;
  };
  requestArguments: (fileObj: FileObj) => AxiosRequestConfig;
  onUploadComplete?: () => void;
  lastProgressUpload?: number;
  uploadType?: UploadType;
};
type StandardFile<T = Partial<FileObj> | FileObj> = Map<string, T>;
type EventType = {
  IN_QUEUE: StandardFile<Partial<FileObj>>;
  IN_PROGRESS: StandardFile<Partial<FileObj>>;
  FAILED_UPLOADS: StandardFile<Partial<FileObj>>;
  COMPLETED_UPLOADS: number; //StandardFile<Partial<FileObj>>;
};
export {
  EventType,
  Constructor,
  FileHierarchy,
  FileObj,
  FileStatus,
  FileHierarchyFileType,
  StandardFile,
  UploadType,
};
