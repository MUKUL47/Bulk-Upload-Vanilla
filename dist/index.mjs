// index.ts
import axios from "axios";

// types.ts
var FileHierarchyFileType = /* @__PURE__ */ ((FileHierarchyFileType2) => {
  FileHierarchyFileType2["FILE"] = "FILE";
  FileHierarchyFileType2["FOLDER"] = "FOLDER";
  return FileHierarchyFileType2;
})(FileHierarchyFileType || {});
var UploadType = /* @__PURE__ */ ((UploadType2) => {
  UploadType2["FILES"] = "FILES";
  UploadType2["FILES_HIERARCHY"] = "FILES_HIERARCHY";
  return UploadType2;
})(UploadType || {});
var FileStatus = /* @__PURE__ */ ((FileStatus2) => {
  FileStatus2["IN_QUEUE"] = "IN_QUEUE";
  FileStatus2["IN_PROGRESS"] = "IN_PROGRESS";
  FileStatus2["SUCCESS"] = "SUCCESS";
  FileStatus2["FAILED"] = "FAILED";
  return FileStatus2;
})(FileStatus || {});

// index.ts
var BulkUpload = class {
  /**
   * @param {number} concurrency - The number of concurrent file uploads allowed.
   * @param {File[]} files - The array of File objects to be uploaded.
   * @param {function} onUpdate - A callback function that is called whenever there is an update in the upload status.
   * @param {boolean} [requestOptions.downloadProgress=false] - Whether to report download progress
   * @param {boolean} [requestOptions.uploadProgress=false] - Whether to report upload progress
   * @param {function} requestArguments - callback function which returns payload for axios request along side fileObject as an argument
   * @param {function} onUploadComplete - callback function when pending and queue is finished
   * @param {number} lastProgressUpload - how frequest onUpdate callback should be invoked, whenever upload/download progress is updated
   * @param {string} uploadType (FILE|FILES_HIERARCHY)- this library supports both folder hierarchy and direct files upload for fetching folder-hierarchy please use this package : https://www.npmjs.com/package/files-hierarchy
   */
  constructor({
    concurrency,
    // files,
    onUpdate,
    requestOptions,
    requestArguments,
    onUploadComplete,
    lastProgressUpload,
    uploadType
  }) {
    this._concurrency = 1;
    this._uploadProgress = false;
    this._downloadProgress = false;
    this._requestArguments = () => null;
    this._onUploadComplete = () => {
    };
    this._uploadType = "FILES" /* FILES */;
    this._lastProgressUpload = 100;
    //
    this.inQueue = /* @__PURE__ */ new Map();
    this.inProgress = /* @__PURE__ */ new Map();
    this.failedUploads = /* @__PURE__ */ new Map();
    this.completedUploads = 0;
    // StandardFile = new Map<string, {}>();
    this.destroyed = false;
    this.uploadCompleted = false;
    this.cancelOperation = (file) => {
      var _a;
      if (file.status === "IN_PROGRESS" /* IN_PROGRESS */) {
        (_a = file.cancel) == null ? void 0 : _a.call(file);
      }
    };
    this.destroy = () => {
      this.destroyed = true;
      const now = Date.now();
      const isFile = this.isFileType();
      for (let [, file] of this.inProgress) {
        if (file.status === "IN_PROGRESS" /* IN_PROGRESS */) {
          this.cancelOperation(file);
          file = {
            file: file.file,
            fileHierarchy: isFile ? file.fileHierarchy : null,
            status: "FAILED" /* FAILED */,
            isCancelled: false,
            id: `${this.getTargetValue(
              file.fileHierarchy || file.file
            )}-${now}`
          };
          this.inProgress.delete(file.id);
          this.failedUploads.set(file.id, file);
        }
      }
      this.sendUpdateEvent();
    };
    this.retryFailedOperation = (fileObjs) => {
      if (!Array.isArray(fileObjs))
        throw new Error("Retry Argument must be an array");
      const retries = [];
      const isFile = this.isFileType();
      for (let file of fileObjs) {
        if (file.status === "FAILED" /* FAILED */) {
          this.failedUploads.delete(file.id);
          retries.push(isFile ? file.file : file.fileHierarchy);
        }
      }
      this.updateQueue(retries);
    };
    this.updateQueue = (files) => {
      this.uploadCompleted = false;
      this.destroyed = false;
      const now = Date.now();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isFile = this.isFileType();
        const value = {
          file: isFile ? file : null,
          fileHierarchy: isFile ? file : null,
          status: "IN_QUEUE" /* IN_QUEUE */,
          isCancelled: false,
          id: `${this.getTargetValue(file)}-${now}`
        };
        value.status = "IN_QUEUE" /* IN_QUEUE */;
        this.inQueue.set(value.id, value);
        this.freeQueue();
      }
      this.sendUpdateEvent();
    };
    this._concurrency = concurrency;
    this._onUpdate = onUpdate;
    this._uploadProgress = !!(requestOptions == null ? void 0 : requestOptions.uploadProgress);
    this._downloadProgress = !!(requestOptions == null ? void 0 : requestOptions.downloadProgress);
    this._requestArguments = requestArguments;
    this._onUploadComplete = onUploadComplete;
    this._lastProgressUpload = lastProgressUpload;
    this._uploadType = uploadType || "FILES" /* FILES */;
  }
  /**
   * getControls to override upload flow
   * @returns {Object} {cancel, retry, destroy, updateQueue}
   */
  getControls() {
    return {
      cancel: this.cancelOperation,
      retry: this.retryFailedOperation,
      updateQueue: this.updateQueue,
      destroy: this.destroy
    };
  }
  /**
   * @param {Array} File or FileHierarchy objects
   * start the queue progress
   */
  start(files) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isFile = this.isFileType();
      const value = {
        file: isFile ? file : null,
        fileHierarchy: isFile ? file : null,
        status: "IN_PROGRESS" /* IN_PROGRESS */,
        isCancelled: false,
        id: this.getTargetValue(file)
      };
      if (i < this._concurrency) {
        value.status = "IN_PROGRESS" /* IN_PROGRESS */;
        this.inProgress.set(value.id, value);
      } else {
        value.status = "IN_QUEUE" /* IN_QUEUE */;
        this.inQueue.set(value.id, value);
      }
    }
    this.sendUpdateEvent();
    this.startInitialProgress();
  }
  startInitialProgress() {
    for (const [_, fileObj] of this.inProgress) {
      this.uploadFile(fileObj);
    }
  }
  updateProgressEvent({
    fileObj,
    axiosRequestArgs,
    type
  }) {
    try {
      const isDownload = type === "DOWNLOAD";
      const progressType = isDownload ? "onDownloadProgress" : "onUploadProgress";
      axiosRequestArgs[progressType] = ({
        loaded,
        total
      }) => {
        loaded = isNaN(Number(loaded)) ? 0 : Number(loaded);
        total = isNaN(Number(total)) ? 0 : Number(total);
        fileObj[isDownload ? "downloadCount" : "uploadCount"] = Math.floor(
          loaded / total * 100
        );
        if (typeof (fileObj == null ? void 0 : fileObj.lastProgressUpdated) !== "number") {
          fileObj.lastProgressUpdated = Date.now();
        }
        if (typeof this._lastProgressUpload === "number" && Date.now() - (fileObj == null ? void 0 : fileObj.lastProgressUpdated) >= this._lastProgressUpload) {
          this.sendUpdateEvent();
          fileObj.lastProgressUpdated = Date.now();
        }
      };
    } catch (e) {
      console.error(e);
    }
  }
  uploadFile(fileObj) {
    try {
      const axiosRequestArgs = this._requestArguments(fileObj);
      if (this._downloadProgress) {
        this.updateProgressEvent({
          fileObj,
          type: "DOWNLOAD",
          axiosRequestArgs
        });
      }
      if (this._uploadProgress) {
        this.updateProgressEvent({ fileObj, type: "UPLOAD", axiosRequestArgs });
      }
      axiosRequestArgs.cancelToken = new axios.CancelToken((cancel) => {
        fileObj.cancel = cancel;
      });
      axios(axiosRequestArgs).then(() => {
        if (this.destroyed)
          return;
        this.inProgress.delete(fileObj.id);
        fileObj.status = "SUCCESS" /* SUCCESS */;
        this.completedUploads += 1;
        this.sendUpdateEvent();
        this.freeQueue();
      }).catch((requestError) => {
        if (this.destroyed)
          return;
        fileObj.isCancelled = !!axios.isCancel(requestError);
        this.uploadFailed(fileObj);
      });
    } catch (e) {
      if (this.destroyed)
        return;
      this.uploadFailed(fileObj);
    }
  }
  /**
   * inform queue to remove items and push to progress Pool
   */
  freeQueue() {
    var _a;
    if (this.inQueue.size === 0 || this.destroyed) {
      this.sendUpdateEvent();
      if (!this.uploadCompleted) {
        (_a = this._onUploadComplete) == null ? void 0 : _a.call(this);
        this.uploadCompleted = true;
      }
      return;
    }
    if (this.inProgress.size === this._concurrency) {
      return this.sendUpdateEvent();
    }
    for (let [_, file] of this.inQueue) {
      file.status = "IN_PROGRESS" /* IN_PROGRESS */;
      this.inQueue.delete(file.id);
      this.inProgress.set(file.id, file);
      this.sendUpdateEvent();
      this.uploadFile(file);
      break;
    }
  }
  uploadFailed(fileObj) {
    fileObj.status = "FAILED" /* FAILED */;
    this.inProgress.delete(fileObj.id);
    this.failedUploads.set(fileObj.id, fileObj);
    this.sendUpdateEvent();
    this.freeQueue();
  }
  /** */
  sendUpdateEvent() {
    var _a;
    (_a = this._onUpdate) == null ? void 0 : _a.call(this, {
      IN_PROGRESS: this.inProgress,
      IN_QUEUE: this.inQueue,
      COMPLETED_UPLOADS: this.completedUploads,
      FAILED_UPLOADS: this.failedUploads
    });
  }
  getTargetValue(fileObj) {
    if (fileObj instanceof File) {
      return fileObj.name;
    }
    return fileObj.path;
  }
  isFileType() {
    return this._uploadType === "FILES" /* FILES */;
  }
};
export {
  FileHierarchyFileType,
  FileStatus,
  UploadType,
  BulkUpload as default
};