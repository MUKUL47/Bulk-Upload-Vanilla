import { AxiosRequestConfig } from 'axios';

declare enum FileHierarchyFileType {
    FILE = "FILE",
    FOLDER = "FOLDER"
}
type FileHierarchy = {
    path: string;
    type: FileHierarchyFileType;
    orignalWebkitPath: string;
    file?: File;
};
declare enum FileStatus {
    IN_QUEUE = "IN_QUEUE",
    IN_PROGRESS = "IN_PROGRESS",
    SUCCESS = "SUCCESS",
    FAILED = "FAILED"
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
    isFileHierarchy?: boolean;
};
type StandardFile<T = Partial<FileObj> | FileObj> = Map<string, T>;
type EventType = {
    IN_QUEUE: StandardFile<Partial<FileObj>>;
    IN_PROGRESS: StandardFile<Partial<FileObj>>;
    FAILED_UPLOADS: StandardFile<Partial<FileObj>>;
    COMPLETED_UPLOADS: number;
};

declare class BulkUpload {
    private _concurrency;
    private _onUpdate?;
    private _uploadProgress;
    private _downloadProgress;
    private _requestArguments;
    private _onUploadComplete?;
    private _isFileHierarchy;
    private _lastProgressUpload?;
    private inQueue;
    private inProgress;
    private failedUploads;
    private completedUploads;
    private destroyed;
    private uploadCompleted;
    private initiated;
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
    constructor({ concurrency, onUpdate, requestOptions, requestArguments, onUploadComplete, lastProgressUpload, isFileHierarchy, }: Constructor);
    /**
     * getControls to override upload flow
     * @returns {Object} {cancel, retry, destroy, updateQueue}
     */
    getControls(): {
        cancel: (file: FileObj) => void;
        retry: (fileObjs: FileObj[]) => void;
        updateQueue: (files: (File | FileHierarchy)[]) => void;
        destroy: () => void;
    };
    /**
     * @param {Array} File or FileHierarchy objects
     * start the queue progress
     */
    start(files: File[] | FileHierarchy[]): void;
    private startInitialProgress;
    private updateProgressEvent;
    private uploadFile;
    /**
     * inform queue to remove items and push to progress Pool
     */
    private freeQueue;
    private uploadFailed;
    /** */
    private sendUpdateEvent;
    private cancelOperation;
    private destroy;
    private retryFailedOperation;
    private updateQueue;
    private getTargetValue;
    private getFileTargetVal;
    private isFileType;
}

export { Constructor, EventType, FileHierarchy, FileHierarchyFileType, FileObj, FileStatus, StandardFile, BulkUpload as default };
