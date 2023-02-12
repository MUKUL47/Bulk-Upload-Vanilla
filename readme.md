# BulkUpload

### BulkUpload is a class for handling bulk file uploads with a customizable concurrency rate and multiple events for tracking the progress of each individual upload.

### Features

#### Ability to set the number of concurrent file uploads allowed.

#### Support for tracking the upload progress of individual files.

#### Support for tracking the download progress of individual files.

#### Customizable Axios request payload.

#### Callback functions for tracking the progress of the upload queue.

#### A set of controls for cancelling, retrying, or destroying the upload queue.

## Usage

```js
const bulkUpload = new BulkUpload({
  concurrency: 5,
  files: [file1, file2, file3],
  onUpdate: (event) => {
    /* do something */
  },
  requestOptions: {
    uploadProgress: true,
    downloadProgress: true,
  },
  requestArguments: (fileObj) => {
    /* return axios request payload */
  },
  onUploadComplete: () => {
    /* do something */
  },
  lastProgressUpload: 100,
});
const { cancel, retry, destroy } = bulkUpload.getControls();
bulkUpload.start();
```
