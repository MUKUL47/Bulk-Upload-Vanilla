import axios, { AxiosProgressEvent, AxiosRequestConfig } from "axios";
import {
  EventType,
  Constructor,
  FileObj,
  FileStatus,
  StandardFile,
  FileHierarchy,
  FileHierarchyFileType,
} from "./types";
export default class BulkUpload {
  private _concurrency: number = 1;
  private _onUpdate?: (event: EventType) => void;
  private _uploadProgress: boolean = false;
  private _downloadProgress: boolean = false;
  private _requestArguments: (fileObj: FileObj) => any = () => null;
  private _onUploadComplete?: () => void = () => {};
  private _isFileHierarchy: boolean = false;
  private _lastProgressUpload?: number | null = 100;
  //
  private inQueue: StandardFile = new Map<string, {}>();
  private inProgress: StandardFile = new Map<string, {}>();
  private failedUploads: StandardFile = new Map<string, {}>();
  private completedUploads: number = 0; // StandardFile = new Map<string, {}>();
  private destroyed: boolean = false;
  private uploadCompleted: boolean = false;
  private initiated: boolean = false;
  /**
   * @param {number} concurrency - The number of concurrent file uploads allowed.
   * @param {File[]} files - The array of File objects to be uploaded.
   * @param {function} onUpdate - A callback function that is called whenever there is an update in the upload status.
   * @param {boolean} [requestOptions.downloadProgress=false] - Whether to report download progress
   * @param {boolean} [requestOptions.uploadProgress=false] - Whether to report upload progress
   * @param {function} requestArguments - callback function which returns payload for axios request along side fileObject as an argument
   * @param {function} onUploadComplete - callback function when pending and queue is finished
   * @param {number} lastProgressUpload - how frequest onUpdate callback should be invoked, whenever upload/download progress is updated
   * @param {boolean} isFileHierarchy - For fetching & uploading folder-hierarchy please use this package : https://www.npmjs.com/package/files-hierarchy
   */
  constructor({
    concurrency,
    // files,
    onUpdate,
    requestOptions,
    requestArguments,
    onUploadComplete,
    lastProgressUpload,
    isFileHierarchy,
  }: Constructor) {
    this._concurrency = concurrency;
    this._onUpdate = onUpdate;
    this._uploadProgress = !!requestOptions?.uploadProgress;
    this._downloadProgress = !!requestOptions?.downloadProgress;
    this._requestArguments = requestArguments;
    this._onUploadComplete = onUploadComplete;
    this._lastProgressUpload = lastProgressUpload;
    this._isFileHierarchy = !!isFileHierarchy;
  }
  /**
   * getControls to override upload flow
   * @returns {Object} {cancel, retry, destroy, updateQueue}
   */
  public getControls() {
    return {
      cancel: this.cancelOperation,
      retry: this.retryFailedOperation,
      updateQueue: this.updateQueue,
      destroy: this.destroy,
    };
  }
  /**
   * @param {Array} File or FileHierarchy objects
   * start the queue progress
   */
  public start(files: File[] | FileHierarchy[]) {
    if (!this.initiated) {
      return this.updateQueue(files);
    }
    this.initiated = true;
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const value = {
        status: FileStatus.IN_PROGRESS,
        id: this.getTargetValue(file),
        ...this.getFileTargetVal(file),
      };
      if (i < this._concurrency) {
        value.status = FileStatus.IN_PROGRESS;
        this.inProgress.set(value.id, value);
      } else {
        value.status = FileStatus.IN_QUEUE;
        this.inQueue.set(value.id, value);
      }
    }
    this.sendUpdateEvent();
    this.startInitialProgress();
  }
  private startInitialProgress() {
    for (const [_, fileObj] of this.inProgress) {
      this.uploadFile(fileObj as FileObj);
    }
  }

  private updateProgressEvent({
    fileObj,
    axiosRequestArgs,
    type,
  }: {
    type: "DOWNLOAD" | "UPLOAD";
    fileObj: FileObj;
    axiosRequestArgs: any;
  }) {
    try {
      const isDownload = type === "DOWNLOAD";
      const progressType = isDownload
        ? "onDownloadProgress"
        : "onUploadProgress";
      axiosRequestArgs[progressType] = ({
        loaded,
        total,
      }: AxiosProgressEvent) => {
        loaded = isNaN(Number(loaded)) ? 0 : Number(loaded);
        total = isNaN(Number(total)) ? 0 : Number(total);
        fileObj[isDownload ? "downloadCount" : "uploadCount"] = Math.floor(
          (loaded / total) * 100
        );
        if (typeof fileObj?.lastProgressUpdated !== "number") {
          fileObj.lastProgressUpdated = Date.now();
        }
        if (
          typeof this._lastProgressUpload === "number" &&
          Date.now() - fileObj?.lastProgressUpdated >= this._lastProgressUpload
        ) {
          this.sendUpdateEvent();
          fileObj.lastProgressUpdated = Date.now();
        }
      };
    } catch (e) {
      console.error(e);
    }
  }

  private uploadFile(fileObj: FileObj) {
    try {
      const axiosRequestArgs: AxiosRequestConfig =
        this._requestArguments(fileObj);
      if (this._downloadProgress) {
        this.updateProgressEvent({
          fileObj,
          type: "DOWNLOAD",
          axiosRequestArgs,
        });
      }
      if (this._uploadProgress) {
        this.updateProgressEvent({ fileObj, type: "UPLOAD", axiosRequestArgs });
      }
      axiosRequestArgs.cancelToken = new axios.CancelToken((cancel) => {
        fileObj.cancel = cancel;
      });
      axios(axiosRequestArgs)
        .then(() => {
          if (this.destroyed) return;
          this.inProgress.delete(fileObj.id);
          fileObj.status = FileStatus.SUCCESS;
          this.completedUploads += 1; //.set(fileObj.id, fileObj);
          this.sendUpdateEvent();
          this.freeQueue();
        })
        .catch((requestError) => {
          if (this.destroyed) return;
          fileObj.isCancelled = !!axios.isCancel(requestError);
          this.uploadFailed(fileObj);
        });
    } catch (e) {
      if (this.destroyed) return;
      this.uploadFailed(fileObj);
    }
  }

  /**
   * inform queue to remove items and push to progress Pool
   */
  private freeQueue(): void {
    if (this.inQueue.size === 0 || this.destroyed) {
      this.sendUpdateEvent();
      if (!this.uploadCompleted) {
        this._onUploadComplete?.();
        this.uploadCompleted = true;
      }
      return;
    }
    if (this.inProgress.size === this._concurrency) {
      return this.sendUpdateEvent();
    }
    for (let [_, file] of this.inQueue) {
      file.status = FileStatus.IN_PROGRESS;
      this.inQueue.delete(file.id!);
      this.inProgress.set(file.id!, file);
      this.sendUpdateEvent();
      this.uploadFile(file as FileObj);
      break;
    }
  }

  private uploadFailed(fileObj: FileObj): void {
    fileObj.status = FileStatus.FAILED;
    this.inProgress.delete(fileObj.id);
    this.failedUploads.set(fileObj.id, fileObj);
    this.sendUpdateEvent();
    this.freeQueue();
  }

  /** */

  private sendUpdateEvent(): void {
    this._onUpdate?.({
      IN_PROGRESS: this.inProgress,
      IN_QUEUE: this.inQueue,
      COMPLETED_UPLOADS: this.completedUploads,
      FAILED_UPLOADS: this.failedUploads,
    });
  }

  private cancelOperation = (file: FileObj) => {
    if (file.status === FileStatus.IN_PROGRESS) {
      file.cancel?.();
    }
  };

  private destroy = () => {
    this.destroyed = true;
    const now = Date.now();
    for (let [, file] of this.inProgress as Map<string, FileObj>) {
      if (file.status === FileStatus.IN_PROGRESS) {
        this.cancelOperation(file);
        file = {
          status: FileStatus.FAILED,
          id: `${this.getTargetValue(
            file.fileHierarchy || (file.file as File)
          )}-${now}`,
          ...this.getFileTargetVal(file.fileHierarchy || (file.file as File)),
        };
        this.inProgress.delete(file.id);
        this.failedUploads.set(file.id, file);
      }
    }
    this.sendUpdateEvent();
  };

  private retryFailedOperation = (fileObjs: FileObj[]) => {
    if (!Array.isArray(fileObjs))
      throw new Error("Retry Argument must be an array");
    const retries: (File | FileHierarchy)[] = [];
    const isFile = this.isFileType();
    for (let file of fileObjs) {
      if (file.status === FileStatus.FAILED) {
        this.failedUploads.delete(file.id);
        retries.push(isFile ? file.file! : file.fileHierarchy!);
      }
    }
    this.updateQueue(retries);
  };
  private updateQueue = (files: (File | FileHierarchy)[]) => {
    this.uploadCompleted = false;
    this.destroyed = false;
    const now = Date.now();
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const value = {
        status: FileStatus.IN_QUEUE,
        id: `${this.getTargetValue(file)}-${now}`,
        ...this.getFileTargetVal(file),
      };
      value.status = FileStatus.IN_QUEUE;
      this.inQueue.set(value.id, value);
      this.freeQueue();
    }
    this.sendUpdateEvent();
  };

  private getTargetValue(fileObj: File | FileHierarchy) {
    if (fileObj instanceof File) {
      return fileObj.name;
    }
    return fileObj.path;
  }

  private getFileTargetVal(file: File | FileHierarchy): {
    file: File | null;
    fileHierarchy: FileHierarchy | null;
    isCancelled: boolean;
  } {
    const isFile = this.isFileType();
    return {
      file: isFile ? (file as File) : null,
      fileHierarchy: !isFile ? (file as FileHierarchy) : null,
      isCancelled: false,
    };
  }

  private isFileType(): boolean {
    return !!!this._isFileHierarchy;
  }
}
export {
  EventType,
  Constructor,
  FileObj,
  FileStatus,
  StandardFile,
  FileHierarchy,
  FileHierarchyFileType,
};
