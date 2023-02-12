import axios, { AxiosProgressEvent, AxiosRequestConfig } from "axios";
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
  id: string;
  lastProgressUpdated?: number;
};
export type Constructor = {
  concurrency: number;
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
  COMPLETED_UPLOADS: number; //StandardFile<Partial<FileObj>>;
};
export default class BulkUpload {
  private _concurrency: number = 1;
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
  private completedUploads: number = 0; // StandardFile = new Map<string, {}>();
  private destroyed: boolean = false;
  private uploadCompleted: boolean = false;
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
    // files,
    onUpdate,
    requestOptions,
    requestArguments,
    onUploadComplete,
    lastProgressUpload,
  }: Constructor) {
    this._concurrency = concurrency;
    // this._files = files;
    this._onUpdate = onUpdate;
    this._uploadProgress = !!requestOptions?.uploadProgress;
    this._downloadProgress = !!requestOptions?.downloadProgress;
    this._requestArguments = requestArguments;
    this._onUploadComplete = onUploadComplete;
    this._lastProgressUpload = lastProgressUpload;
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
   * start the queue progress
   */
  public start(files: File[]) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const value = {
        file,
        status: FileStatus.IN_PROGRESS,
        isCancelled: false,
        id: file.name,
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
      //   const { file } = fileObj;
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
          file: file.file,
          status: FileStatus.FAILED,
          isCancelled: false,
          id: `${file.file.name}-${now}`,
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
    const retries: File[] = [];
    for (let file of fileObjs) {
      if (file.status === FileStatus.FAILED) {
        this.failedUploads.delete(file.id);
        retries.push(file.file);
      }
    }
    this.updateQueue(retries);
  };
  private updateQueue = (files: File[]) => {
    this.uploadCompleted = false;
    this.destroyed = false;
    const now = Date.now();
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const value = {
        file,
        status: FileStatus.IN_QUEUE,
        isCancelled: false,
        id: `${file.name}-${now}`,
      };
      value.status = FileStatus.IN_QUEUE;
      this.inQueue.set(value.id, value);
      this.freeQueue();
    }
    this.sendUpdateEvent();
  };
}
