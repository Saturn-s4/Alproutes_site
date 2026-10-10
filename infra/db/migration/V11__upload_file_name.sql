-- Original file name of an upload, as the client reported it (contract: UploadRequest.fileName).
-- Tracks expose it as originalFilename; it is informational and never used as a storage key.
ALTER TABLE uploads ADD COLUMN file_name text CHECK (length(file_name) <= 255);
