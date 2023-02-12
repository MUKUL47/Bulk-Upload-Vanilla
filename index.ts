import axios, { AxiosRequestConfig, AxiosProgressEvent } from "axios";
export enum FileStatus {
  IN_QUEUE = "IN_QUEUE",
  IN_PROGRESS = "IN_PROGRESS",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
}
export type FileObj = {
  file: File;
  status: FileStatus;
  uploadCount?: number;
  downloadCount?: number;
  cancel?: () => void;
  isCancelled?: boolean;
};
export type Constructor = {
  concurrency: number;
  files: File[];
  onUpdate?: (event: Event) => void;
  requestOptions?: {
    downloadProgress?: boolean;
    uploadProgress?: boolean;
  };
  requestArguments: (fileObj: FileObj) => AxiosRequestConfig;
  onUploadComplete?: () => void;
  lastProgressUpload?: number;
};
export type StandardFile<T = Partial<FileObj> | FileObj> = Map<string, T>;
export type Event = {
  IN_QUEUE: StandardFile<Partial<FileObj>>;
  IN_PROGRESS: StandardFile<Partial<FileObj>>;
  FAILED_UPLOADS: StandardFile<Partial<FileObj>>;
  COMPLETED_UPLOADS: StandardFile<Partial<FileObj>>;
};
export default class BulkUpload {
  private _concurrency: number = 1;
  private _files: File[] = [];
  private _onUpdate?: (event: Event) => void;
  private _uploadProgress: boolean = false;
  private _downloadProgress: boolean = false;
  private _requestArguments: (fileObj: FileObj) => any = () => null;
  private _onUploadComplete?: () => void = () => {};
  private _lastProgressUpload?: number | null = 100;
  //
  private inQueue: StandardFile = new Map<string, {}>();
  private inProgress: StandardFile = new Map<string, {}>();
  private failedUploads: StandardFile = new Map<string, {}>();
  private completedUploads: StandardFile = new Map<string, {}>();
  private destroyed: boolean = false;
  private lastProgressUpload: number = 0;
  /**
   * @param {number} concurrency - The number of concurrent file uploads allowed.
   * @param {File[]} files - The array of File objects to be uploaded.
   * @param {function} onUpdate - A callback function that is called whenever there is an update in the upload status.
   * @param {boolean} [requestOptions.downloadProgress=false] - Whether to report download progress
   * @param {boolean} [requestOptions.uploadProgress=false] - Whether to report upload progress
   * @param {function} requestArguments - callback function which returns payload for axios request along side fileObject as an argument
   * @param {function} onUploadComplete - callback function when pending and queue is finished
   * @param {function} lastProgressUpload - how frequest onUpdate callback should be invoked, whenever upload/download progress is updated
   */
  constructor({
    concurrency,
    files,
    onUpdate,
    requestOptions,
    requestArguments,
    onUploadComplete,
    lastProgressUpload,
  }: Constructor) {
    this._concurrency = concurrency;
    this._files = files;
    this._onUpdate = onUpdate;
    this._uploadProgress = !!requestOptions?.uploadProgress;
    this._downloadProgress = !!requestOptions?.downloadProgress;
    this._requestArguments = requestArguments;
    this._onUploadComplete = onUploadComplete;
    this._lastProgressUpload = lastProgressUpload;
  }
  /**
   * getControls to override upload flow
   * @returns {Object} {cancel, retry, destroy}
   */
  public getControls() {
    return {
      cancel: this.cancelOperation,
      retry: this.retryFailedOperation,
      destroy: this.destroy,
    };
  }
  /**
   * start the queue progress
   */
  public start() {
    for (let i = 0; i < this._files.length; i++) {
      const file = this._files[i]!;
      const value = {
        file,
        status: FileStatus.IN_PROGRESS,
        isCancelled: false,
      };
      if (i < this._concurrency) {
        value.status = FileStatus.IN_PROGRESS;
        this.inProgress.set(file.name, value);
      } else {
        value.status = FileStatus.IN_QUEUE;
        this.inQueue.set(file.name, value);
      }
    }
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
        if (typeof this._lastProgressUpload === "number") {
          if (Date.now() - this.lastProgressUpload < this.lastProgressUpload) {
            this.sendUpdateEvent();
          }
          this.lastProgressUpload = Date.now();
        }
      };
    } catch (e) {}
  }

  private uploadFile(fileObj: FileObj) {
    try {
      const { file } = fileObj;
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
          this.inProgress.delete(file.name);
          fileObj.status = FileStatus.SUCCESS;
          this.completedUploads.set(file.name, fileObj);
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
      this._onUploadComplete?.();
      return;
    }
    for (let [fileName, file] of this.inQueue) {
      file.status = FileStatus.IN_PROGRESS;
      this.inProgress.set(fileName, file);
      this.uploadFile(file as FileObj);
      this.inQueue.delete(fileName);
      this.sendUpdateEvent();
      break;
    }
  }

  private uploadFailed(fileObj: FileObj): void {
    const { file } = fileObj;
    fileObj.status = FileStatus.FAILED;
    this.inProgress.delete(file.name);
    this.failedUploads.set(file.name, fileObj);
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
    for (let [, file] of this.inProgress as Map<string, FileObj>) {
      if (file.status === FileStatus.IN_PROGRESS) {
        this.cancelOperation(file);
        file = {
          file: file.file,
          status: FileStatus.FAILED,
          isCancelled: false,
        };
        this.inProgress.delete(file.file.name);
        this.failedUploads.set(file.file.name, file);
      }
    }
    this.sendUpdateEvent();
  };

  private retryFailedOperation = (fileObjs: FileObj[]) => {
    if (!Array.isArray(fileObjs))
      throw new Error("Retry Argument must be an array");
    this.destroyed = false;
    const retries: FileObj[] = [];
    for (let file of fileObjs) {
      if (file.status === FileStatus.FAILED) {
        file = {
          file: file.file,
          status: FileStatus.IN_PROGRESS,
          isCancelled: false,
        };
        this.failedUploads.delete(file.file.name);
        this.inProgress.set(file.file.name, file);
        retries.push(file);
      }
    }
    this.sendUpdateEvent();
    for (const retryFile of retries) {
      this.uploadFile(retryFile as FileObj);
    }
  };
}
