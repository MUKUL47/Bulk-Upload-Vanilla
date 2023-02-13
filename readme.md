# BulkUpload

### BulkUpload is a class for handling bulk file uploads with a customizable concurrency rate and multiple events for tracking the progress, upload, download of each individual request, cancel, retry, destroy request(s) etc and also BFS file-hierarchy upload payload similar to google drive for more references please visit : https://www.npmjs.com/package/files-hierarchy.

### Features

```
Ability to set the number of concurrent file uploads allowed.
Support for tracking the upload progress of individual files.
Support for tracking the download progress of individual files.
Customizable Axios request payload.
Callback functions for tracking the progress of the upload queue.
A set of controls for cancelling, retrying, or destroying the upload queue.
```

## Usage

```js
const bulkUpload = new BulkUpload({
  concurrency: 2,
  requestArguments: ({ file, fileHierarchy }: any) => {
    //fileHierarchy -> please refer isFileHierarchy flag comment below
    const formData = new FormData();
    formData.append("file", file);
    return {
      url: "http://localhost:3000/upload",
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data",
      },
      data: formData,
    };
  },
  lastProgressUpload: 100, //for every 100ms download/upload progress will be updated and onUpdate callback will be invoked
  onUpdate: ({
    COMPLETED_UPLOADS /**Number */,
    FAILED_UPLOADS /**MAP -> [(name) => FileObj]**/,
    IN_QUEUE /**MAP -> [(name) => FileObj]**/,
    IN_PROGRESS /**MAP -> [(name) => FileObj]**/,
  }) => {
    //on complete, failed, inQueue & inProgress structure update callback is invoked
    onUploadUpdate({
      COMPLETED_UPLOADS,
      FAILED_UPLOADS,
      IN_QUEUE,
      IN_PROGRESS,
    });
  },
  onUploadComplete: () => {
    console.log("request completed");
  },
  requestOptions: {
    uploadProgress: true, //send request upload percentage
    // downloadProgress: true, send request download percentage
  },
  isFileHierarchy: false /**enable this flag if you have a requirement of sending folders as a BFS like Google-Drive folder upload to fetch all folder path(s), 
  please use this library : https://www.npmjs.com/package/files-hierarchy 
  **/,
});
const { cancel, destroy, retry, updateQueue } = bulkUpload.getControls();
/**
 * cancel -> cancel failed request -> cancel(FileObj)
 * destroy -> cancel all inprogress and remove all inqueue request(s) -> destroy()
 * retry -> retry only failed request -> retry([FileObj])
 * updateQueue -> update existing queue upload. Please note if you start upload again internally updateQueue is been called
 */
function onUploadUpdate({
  COMPLETED_UPLOADS, //number
  FAILED_UPLOADS,
  IN_QUEUE,
  IN_PROGRESS,
}: EventType) {
  /**FAILED|IN_QUEUE, IN_PROGRESS -> 
   * MAP{ FILE_NAME_ID -> 
   * FileObj = {
      file: File | null;
      fileHierarchy: FileHierarchy | null;
      status: FileStatus;
      uploadCount?: number;
      downloadCount?: number;
      isCancelled?: boolean; //if cancelled by user else request failed
      id: string;
      lastProgressUpdated?: number;
    };
   *  }**/
  //cancel(FileObj)
  //retry([FileObj, FileObj])
  //updateQueue(FileObj.file || FileObj.fileHierarchy)
}
//start the upload
document.querySelector("input")?.addEventListener("change", (e) => {
  bulkUpload.start(e.target.files);
});
```
